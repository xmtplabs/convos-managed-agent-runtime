import { eq, sql } from "drizzle-orm";
import { db } from "../../db/connection";
import { phoneNumberPool } from "../../db/schema";
import { config } from "../../config";

const TELNYX_API = "https://api.telnyx.com/v2";

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.telnyxApiKey}`,
    "Content-Type": "application/json",
  };
}

/** Search for an available US SMS-capable phone number. Fetches a batch and picks randomly to reduce collisions. */
async function searchAvailableNumber(): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `${TELNYX_API}/available_phone_numbers?filter[country_code]=US&filter[features][]=sms&filter[limit]=20`,
      { headers: headers() },
    );
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 3) {
        console.warn(`[telnyx] Search attempt ${attempt}/3 failed (${res.status}), retrying in ${attempt * 2}s...`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
    }
    const body = await res.json() as any;
    const numbers: string[] = (body?.data ?? []).map((d: any) => d.phone_number).filter(Boolean);
    if (!numbers.length) throw new Error("No available Telnyx phone numbers found");
    // Pick a random number from the batch to reduce collisions with concurrent provisioners
    return numbers[Math.floor(Math.random() * numbers.length)];
  }
  throw new Error("Telnyx search failed: max retries exceeded");
}

/**
 * Purchase a phone number. On 409/422 (number already taken by concurrent caller),
 * re-searches for a new number. Retries on 429/5xx.
 */
async function purchaseNumber(phoneNumber: string): Promise<string> {
  let currentNumber = phoneNumber;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${TELNYX_API}/number_orders`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        phone_numbers: [{ phone_number: currentNumber }],
      }),
    });
    const body = await res.json() as any;
    const purchased = body?.data?.phone_numbers?.[0]?.phone_number;
    if (purchased) return purchased;

    // Number already taken by another concurrent provisioner — search for a new one
    if (res.status === 409 || res.status === 422) {
      console.warn(`[telnyx] Number ${currentNumber} already taken (${res.status}), searching for a new one...`);
      currentNumber = await searchAvailableNumber();
      console.log(`[telnyx] Found replacement: ${currentNumber}`);
      continue;
    }

    // Rate-limited or server error — retry same number after backoff
    const isRetryable = res.status === 429 || res.status >= 500;
    if (isRetryable && attempt < 5) {
      console.warn(`[telnyx] Purchase attempt ${attempt}/5 failed (${res.status}), retrying in ${attempt * 3}s...`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
      continue;
    }

    console.error(`[telnyx] Purchase failed after ${attempt} attempt(s):`, res.status, body);
    throw new Error(`Telnyx number purchase failed: ${res.status}`);
  }
  throw new Error("Telnyx purchase failed: max retries exceeded");
}

/** Get or create a messaging profile. Returns profile ID. */
async function getOrCreateMessagingProfile(): Promise<string> {
  // Check env var first
  if (config.telnyxMessagingProfileId) {
    return config.telnyxMessagingProfileId;
  }

  // Try to find an existing profile
  const listRes = await fetch(`${TELNYX_API}/messaging_profiles?page[size]=1`, {
    headers: headers(),
  });
  const listBody = await listRes.json() as any;
  const existing = listBody?.data?.[0]?.id;
  if (existing) return existing;

  // Create a new profile
  const createRes = await fetch(`${TELNYX_API}/messaging_profiles`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: "convos-sms",
      whitelisted_destinations: ["US"],
    }),
  });
  const createBody = await createRes.json() as any;
  const profileId = createBody?.data?.id;
  if (!profileId) {
    console.error("[telnyx] Create messaging profile failed:", createRes.status, createBody);
    throw new Error(`Telnyx messaging profile creation failed: ${createRes.status}`);
  }
  console.log(`[telnyx] Created messaging profile ${profileId}`);
  return profileId;
}

/** Assign a phone number to a messaging profile (retries for post-purchase propagation). */
async function assignToProfile(phoneNumber: string, profileId: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${TELNYX_API}/phone_numbers/${encodeURIComponent(phoneNumber)}/messaging`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ messaging_profile_id: profileId }),
    });
    if (res.ok) return;
    const body = await res.text();
    if (res.status === 404 && attempt < 5) {
      console.warn(`[telnyx] Assign attempt ${attempt}/5: number not ready yet, retrying in ${attempt * 2}s...`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }
    console.error("[telnyx] Assign to messaging profile failed:", res.status, body);
    throw new Error(`Telnyx messaging profile assignment failed: ${res.status}`);
  }
}

export interface ProvisionedPhone {
  phoneNumber: string;
  messagingProfileId: string;
}

/**
 * Provision a phone number for an instance.
 * First checks the pool for an available number; if none, purchases a new one.
 */
export async function provisionPhone(instanceId?: string): Promise<ProvisionedPhone> {
  if (!config.telnyxApiKey) throw new Error("TELNYX_API_KEY not set");

  // 1. Atomically claim one available number from the pool (LIMIT 1)
  const claimed = await db.execute<{
    id: number;
    phone_number: string;
    messaging_profile_id: string;
  }>(sql`
    UPDATE phone_number_pool
    SET status = 'assigned', instance_id = ${instanceId ?? null}
    WHERE id = (
      SELECT id FROM phone_number_pool
      WHERE status = 'available'
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, phone_number, messaging_profile_id
  `);

  const pooled = claimed.rows?.[0];
  if (pooled) {
    console.log(`[telnyx] Reusing pooled number ${pooled.phone_number} (pool id ${pooled.id})`);
    return { phoneNumber: pooled.phone_number, messagingProfileId: pooled.messaging_profile_id };
  }

  // 2. No available numbers — purchase a new one
  console.log("[telnyx] No pooled numbers available, purchasing new number...");
  const available = await searchAvailableNumber();
  console.log(`[telnyx] Found: ${available}`);

  const phoneNumber = await purchaseNumber(available);
  console.log(`[telnyx] Purchased: ${phoneNumber}`);

  const messagingProfileId = await getOrCreateMessagingProfile();
  console.log(`[telnyx] Using messaging profile: ${messagingProfileId}`);

  await assignToProfile(phoneNumber, messagingProfileId);
  console.log(`[telnyx] Assigned ${phoneNumber} to profile ${messagingProfileId}`);

  // 3. Insert into pool as assigned
  await db.insert(phoneNumberPool).values({
    phoneNumber,
    messagingProfileId,
    status: "assigned",
    instanceId: instanceId ?? null,
  });

  return { phoneNumber, messagingProfileId };
}

/**
 * Release a phone number back to the pool (does NOT delete from Telnyx).
 * Kept as `deletePhone` to preserve the existing call-site interface.
 */
export async function deletePhone(phoneNumber: string): Promise<boolean> {
  if (!phoneNumber) return false;

  try {
    const [updated] = await db
      .update(phoneNumberPool)
      .set({ status: "available" as const, instanceId: null })
      .where(eq(phoneNumberPool.phoneNumber, phoneNumber))
      .returning();

    if (updated) {
      console.log(`[telnyx] Released ${phoneNumber} back to pool`);
      return true;
    }

    // Number not in pool — nothing to do (legacy number or already cleaned up)
    console.warn(`[telnyx] Phone number ${phoneNumber} not found in pool, skipping release`);
    return false;
  } catch (err: any) {
    console.warn(`[telnyx] Failed to release phone number ${phoneNumber}:`, err.message);
    return false;
  }
}
