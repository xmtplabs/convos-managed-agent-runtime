/**
 * 10DLC registration helper — walks through brand, vetting, campaign, and
 * number assignment via the Telnyx API.
 *
 * WHY: US carriers silently drop SMS from unregistered long codes. 10DLC
 * registration tells carriers "this is a legit business" so messages
 * actually reach phones. Without it, Telnyx shows "delivered" but the
 * carrier filters the message before the handset.
 *
 * Usage:  pnpm telnyx:10dlc <command>
 *
 * Commands:
 *   status                  — show current 10DLC status (brands, campaigns, numbers)
 *   brand                   — register a new brand (interactive via env vars)
 *   vet <brandId>           — submit brand for third-party vetting
 *   campaign <brandId>      — create a campaign for a brand
 *   assign <campaignId> [phone]  — assign phone number(s) to a campaign
 *   assign-all <campaignId>      — assign ALL active Telnyx numbers to a campaign
 *
 * Required env:  TELNYX_API_KEY
 *
 * Brand and campaign details are hardcoded below for XMTP Labs, Inc.
 * Edit the values directly in this file if anything changes.
 *
 * ── XMTP Labs registration progress ──────────────────────────────────────
 *
 * Brand details (confirmed):
 *   entityType:  PRIVATE_PROFIT
 *   displayName: XMTP Labs
 *   companyName: XMTP Labs, Inc.
 *   ein:         86-3377822
 *   phone:       +13026001456
 *   street:      1131 4th Avenue South, Unit 230
 *   city:        Nashville
 *   state:       TN
 *   postalCode:  37210
 *   country:     US
 *   email:       fabri@xmtp.com
 *   website:     https://xmtp.org
 *   vertical:    TECHNOLOGY
 *
 * Progress (2026-03-10):
 *   [x] 1. Brand registered          → 4b20019c-d7f3-0a4d-44ef-c77918e1ff50
 *   [x] 2. Brand vetted (AEGIS)      → VETTED_VERIFIED (TCR ID: BLU7YWX)
 *   [x] 3. Campaign created          → 4b30019c-d83d-7622-1193-d6fb73a0c8ec (TCR: CZL2FYB)
 *       Status: Pending Telnyx Review
 *   [ ] 4. assign-all <campaignId>   → link all active numbers (after campaign approved)
 *   [ ] 5. Test SMS delivery
 *
 * Failed campaigns (for reference):
 *   - 4b30019c-d7f3-7fba-7eb4-8f486d652277  TCR_FAILED — "Brand registration status pending"
 *   - 4b30019c-d83b-f245-cee7-f97bf4397a2b  TCR_FAILED — missing subscriberHelp/Optin/Optout
 *
 * Notes:
 *   - One brand + one campaign covers all numbers under the same TELNYX_API_KEY
 *   - Campaign type is CUSTOMER_CARE (conversational AI, not marketing)
 *   - subscriberHelp/Optin/Optout booleans are REQUIRED — campaigns fail TCR without them
 *   - optinMessage/optoutMessage/helpMessage are the actual auto-reply text
 *   - Vetting score determines throughput on AT&T/T-Mobile
 * ──────────────────────────────────────────────────────────────────────────
 */

const TELNYX_API = "https://api.telnyx.com/v2";
const API_KEY = process.env.TELNYX_API_KEY;

if (!API_KEY) {
  console.error("TELNYX_API_KEY not set. Add it to pool/.env");
  process.exit(1);
}

function hdrs() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: hdrs(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    const errors = json?.errors ?? json;
    console.error(`\n  API error (${res.status}):`, JSON.stringify(errors, null, 2));
    return null;
  }
  return json?.data ?? json;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdStatus() {
  console.log("\n=== 10DLC Status ===\n");

  // Brands
  const brands = await api("GET", "/10dlc/brand?page[size]=20");
  if (!brands) {
    console.log("  Could not fetch brands.\n");
    return;
  }
  const brandList = Array.isArray(brands) ? brands : brands?.records ?? [];
  if (brandList.length === 0) {
    console.log("  No brands registered. Run: pnpm telnyx:10dlc brand\n");
    return;
  }

  console.log("  Brands:");
  for (const b of brandList) {
    const score = b.vettingScore != null ? `  vetting_score=${b.vettingScore}` : "";
    console.log(`    ${b.brandId ?? b.id}  ${b.displayName}  status=${b.identityStatus ?? b.status ?? "unknown"}${score}`);
  }

  // Campaigns
  const brandIds = brandList.map((b: any) => b.brandId ?? b.id).join(",");
  const campaigns = await api("GET", `/10dlc/campaign?brandId=${brandIds}&page[size]=20`);
  const campaignList = Array.isArray(campaigns) ? campaigns : campaigns?.records ?? [];
  if (campaignList.length > 0) {
    console.log("\n  Campaigns:");
    for (const c of campaignList) {
      const status = c.campaignStatus ?? c.submissionStatus ?? c.status ?? "unknown";
      const failures = c.failureReasons?.length ? `  failures=${c.failureReasons.map((r: any) => r.description).join("; ")}` : "";
      console.log(`    ${c.campaignId ?? c.id}  usecase=${c.usecase}  status=${status}  brand=${c.brandId}${failures}`);
    }
  } else {
    console.log("\n  No campaigns. Run: pnpm telnyx:10dlc campaign <brandId>");
  }

  // Phone number assignments
  const assignments = await api("GET", "/10dlc/phoneNumberCampaign?page[size]=50");
  const assignList = Array.isArray(assignments) ? assignments : assignments?.records ?? [];
  if (assignList.length > 0) {
    console.log("\n  Phone Number Assignments:");
    for (const a of assignList) {
      console.log(`    ${a.phoneNumber}  campaign=${a.campaignId}`);
    }
  } else {
    console.log("\n  No phone numbers assigned to campaigns.");
  }

  console.log("");
}

async function cmdBrand() {
  console.log("\n=== Register 10DLC Brand ===\n");

  const body = {
    entityType: "PRIVATE_PROFIT",
    displayName: "XMTP Labs",
    companyName: "XMTP Labs, Inc.",
    ein: "86-3377822",
    phone: "+13026001456",
    street: "1131 4th Avenue South, Unit 230",
    city: "Nashville",
    state: "TN",
    postalCode: "37210",
    country: "US",
    email: "fabri@xmtp.com",
    website: "https://xmtp.org",
    vertical: "TECHNOLOGY",
  };


  console.log("  Registering brand:");
  console.log(`    Company:  ${body.companyName}`);
  console.log(`    Display:  ${body.displayName}`);
  console.log(`    EIN:      ${body.ein}`);
  console.log(`    Type:     ${body.entityType}`);
  console.log(`    Vertical: ${body.vertical}\n`);

  const result = await api("POST", "/10dlc/brand", body);
  if (!result) {
    console.error("  Brand registration failed.\n");
    process.exit(1);
  }

  const brandId = result.brandId ?? result.id;
  console.log(`  Brand registered: ${brandId}`);
  console.log(`  Identity status:  ${result.identityStatus ?? "pending"}`);
  console.log(`\n  Next: pnpm telnyx:10dlc vet ${brandId}\n`);
}

async function cmdVet(brandId: string) {
  console.log(`\n=== Submitting Brand ${brandId} for Vetting ===\n`);

  const result = await api("POST", `/10dlc/brand/${brandId}/vetting`, {
    vettingProvider: "AEGIS",
    vettingClass: "STANDARD",
  });

  if (!result) {
    console.error("  Vetting submission failed.\n");
    process.exit(1);
  }

  console.log(`  Vetting submitted.`);
  console.log(`  Status: ${result.vettingStatus ?? result.status ?? "pending"}`);
  console.log(`\n  Vetting takes 1-7 business days.`);
  console.log(`  Check progress: pnpm telnyx:10dlc status`);
  console.log(`\n  You can create campaigns now (throughput limited until vetting completes).`);
  console.log(`  Next: pnpm telnyx:10dlc campaign ${brandId}\n`);
}

async function cmdCampaign(brandId: string) {
  console.log(`\n=== Create 10DLC Campaign for Brand ${brandId} ===\n`);

  const body = {
    brandId,
    usecase: "CUSTOMER_CARE",
    description:
      "Conversational AI agent providing customer support and notifications via SMS.",
    sample1:
      "Hi! I am your AI assistant. How can I help you today? Reply STOP to opt out.",
    sample2:
      "Your request has been processed. Let me know if you need anything else. Reply STOP to unsubscribe.",
    messageFlow:
      "Users initiate conversations by texting the number or opting in through the web application. They can opt out at any time by replying STOP.",
    helpMessage: "Reply HELP for support or visit https://xmtp.org. Reply STOP to opt out.",
    helpKeywords: "HELP,INFO",
    optinKeywords: "START,YES",
    optinMessage: "You are now subscribed to messages from XMTP Labs. Reply HELP for help, STOP to opt out.",
    optoutKeywords: "STOP,CANCEL,END,QUIT,UNSUBSCRIBE",
    optoutMessage: "You have been unsubscribed and will no longer receive messages. Reply START to resubscribe.",
    subscriberHelp: true,
    subscriberOptin: true,
    subscriberOptout: true,
    embeddedLink: false,
    numberPool: false,
    ageGated: false,
  };

  console.log("  Campaign details:");
  console.log(`    Use case:     ${body.usecase}`);
  console.log(`    Description:  ${body.description}`);
  console.log(`    Sample 1:     ${body.sample1}`);
  console.log(`    Sample 2:     ${body.sample2}\n`);

  const result = await api("POST", "/10dlc/campaignBuilder", body);
  if (!result) {
    console.error("  Campaign creation failed.\n");
    process.exit(1);
  }

  const campaignId = result.campaignId ?? result.id;
  console.log(`  Campaign created: ${campaignId}`);
  console.log(`  Status: ${result.status ?? "pending"}`);
  console.log(`\n  Next: pnpm telnyx:10dlc assign ${campaignId} +1XXXXXXXXXX`);
  console.log(`  Or:   pnpm telnyx:10dlc assign-all ${campaignId}\n`);
}

async function cmdAssign(campaignId: string, phoneNumber?: string) {
  if (!phoneNumber) {
    console.error("Usage: pnpm telnyx:10dlc assign <campaignId> <phoneNumber>");
    process.exit(1);
  }

  console.log(`\n=== Assigning ${phoneNumber} to Campaign ${campaignId} ===\n`);

  const result = await api("POST", "/10dlc/phoneNumberCampaign", {
    phoneNumber,
    campaignId,
  });

  if (!result) {
    console.error("  Assignment failed.\n");
    process.exit(1);
  }

  console.log(`  Assigned ${phoneNumber} to campaign ${campaignId}`);
  console.log("");
}

async function cmdAssignAll(campaignId: string) {
  console.log(`\n=== Assigning All Active Numbers to Campaign ${campaignId} ===\n`);

  // Fetch all active numbers
  const res = await fetch(
    `${TELNYX_API}/phone_numbers?page[size]=100&filter[status]=active`,
    { headers: hdrs() },
  );
  const body = (await res.json()) as any;
  const numbers: Array<{ phone_number: string }> = body?.data ?? [];

  if (numbers.length === 0) {
    console.log("  No active numbers found on account.\n");
    return;
  }

  console.log(`  Found ${numbers.length} active number(s). Assigning...\n`);

  let ok = 0;
  let failed = 0;

  for (const n of numbers) {
    const result = await api("POST", "/10dlc/phoneNumberCampaign", {
      phoneNumber: n.phone_number,
      campaignId,
    });
    if (result) {
      console.log(`    + ${n.phone_number}`);
      ok++;
    } else {
      console.log(`    x ${n.phone_number} (failed)`);
      failed++;
    }
  }

  console.log(`\n  Done. Assigned: ${ok}, Failed: ${failed}\n`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2] ?? "status";
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  switch (cmd) {
    case "status":
      return cmdStatus();
    case "brand":
      return cmdBrand();
    case "vet":
      if (!arg1) { console.error("Usage: pnpm telnyx:10dlc vet <brandId>"); process.exit(1); }
      return cmdVet(arg1);
    case "campaign":
      if (!arg1) { console.error("Usage: pnpm telnyx:10dlc campaign <brandId>"); process.exit(1); }
      return cmdCampaign(arg1);
    case "assign":
      if (!arg1) { console.error("Usage: pnpm telnyx:10dlc assign <campaignId> <phoneNumber>"); process.exit(1); }
      return cmdAssign(arg1, arg2);
    case "assign-all":
      if (!arg1) { console.error("Usage: pnpm telnyx:10dlc assign-all <campaignId>"); process.exit(1); }
      return cmdAssignAll(arg1);
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Available: status, brand, vet, campaign, assign, assign-all");
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
