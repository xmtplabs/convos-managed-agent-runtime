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

/** Search for an available US SMS-capable phone number. */
async function searchAvailableNumber(): Promise<string> {
  const res = await fetch(
    `${TELNYX_API}/available_phone_numbers?filter[country_code]=US&filter[features][]=sms&filter[limit]=1`,
    { headers: headers() },
  );
  const body = await res.json() as any;
  const number = body?.data?.[0]?.phone_number;
  if (!number) throw new Error("No available Telnyx phone numbers found");
  return number;
}

/** Purchase a phone number. Returns the purchased number. */
async function purchaseNumber(phoneNumber: string): Promise<string> {
  const res = await fetch(`${TELNYX_API}/number_orders`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      phone_numbers: [{ phone_number: phoneNumber }],
    }),
  });
  const body = await res.json() as any;
  const purchased = body?.data?.phone_numbers?.[0]?.phone_number;
  if (!purchased) {
    console.error("[telnyx] Purchase failed:", res.status, body);
    throw new Error(`Telnyx number purchase failed: ${res.status}`);
  }
  return purchased;
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
