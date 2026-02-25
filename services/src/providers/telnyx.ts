import { config } from "../config.js";

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

/** Assign a phone number to a messaging profile. */
async function assignToProfile(phoneNumber: string, profileId: string): Promise<void> {
  await fetch(`${TELNYX_API}/phone_numbers/${phoneNumber}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ messaging_profile_id: profileId }),
  });
}

export interface ProvisionedPhone {
  phoneNumber: string;
  messagingProfileId: string;
}

/** Provision a new phone number: search → purchase → get/create profile → assign. */
export async function provisionPhone(): Promise<ProvisionedPhone> {
  if (!config.telnyxApiKey) throw new Error("TELNYX_API_KEY not set");

  console.log("[telnyx] Searching for available number...");
  const available = await searchAvailableNumber();
  console.log(`[telnyx] Found: ${available}`);

  const phoneNumber = await purchaseNumber(available);
  console.log(`[telnyx] Purchased: ${phoneNumber}`);

  const messagingProfileId = await getOrCreateMessagingProfile();
  console.log(`[telnyx] Using messaging profile: ${messagingProfileId}`);

  await assignToProfile(phoneNumber, messagingProfileId);
  console.log(`[telnyx] Assigned ${phoneNumber} to profile ${messagingProfileId}`);

  return { phoneNumber, messagingProfileId };
}

/** Delete (release) a phone number. Best-effort. */
export async function deletePhone(phoneNumber: string): Promise<boolean> {
  if (!config.telnyxApiKey || !phoneNumber) return false;

  try {
    const res = await fetch(`${TELNYX_API}/phone_numbers/${phoneNumber}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (res.ok) {
      console.log(`[telnyx] Deleted phone number ${phoneNumber}`);
      return true;
    }
    const body = await res.text();
    console.warn(`[telnyx] Failed to delete phone number ${phoneNumber}: ${res.status} ${body}`);
    return false;
  } catch (err: any) {
    console.warn(`[telnyx] Failed to delete phone number ${phoneNumber}:`, err.message);
    return false;
  }
}
