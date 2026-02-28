/**
 * SMS end-to-end test — makes two numbers talk to each other.
 *
 * Usage:  pnpm telnyx:sms-test
 *         pnpm telnyx:sms-test +1AAAAAAAAAA +1BBBBBBBBBB   (specific numbers)
 *
 * What it does:
 *   1. Verifies messaging features (SMS) are enabled on both numbers
 *   2. A texts B, B texts A
 *   3. Polls delivery status until both reach terminal state
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function listActiveNumbers(): Promise<string[]> {
  const res = await fetch(
    `${TELNYX_API}/phone_numbers?page[size]=100&filter[status]=active`,
    { headers: hdrs() },
  );
  const body = (await res.json()) as any;
  return (body?.data ?? [])
    .filter((n: any) => n.messaging_profile_id)
    .map((n: any) => n.phone_number);
}

async function getMessagingFeatures(phoneNumber: string): Promise<any> {
  const res = await fetch(
    `${TELNYX_API}/phone_numbers/${encodeURIComponent(phoneNumber)}/messaging`,
    { headers: hdrs() },
  );
  if (!res.ok) return null;
  return ((await res.json()) as any)?.data;
}

async function sendSMS(from: string, to: string, text: string): Promise<string | null> {
  console.log(`\n  📤 ${from} → ${to}: "${text}"`);
  const res = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: hdrs(),
    body: JSON.stringify({ from, to, text }),
  });
  const body = (await res.json()) as any;
  if (!res.ok) {
    console.error(`     SEND FAILED (${res.status}):`, JSON.stringify(body?.errors ?? body, null, 2));
    return null;
  }
  const id = body?.data?.id;
  console.log(`     Message ID: ${id}`);
  return id;
}

async function checkStatus(messageId: string): Promise<string> {
  const res = await fetch(`${TELNYX_API}/messages/${messageId}`, {
    headers: hdrs(),
  });
  const body = (await res.json()) as any;
  return body?.data?.to?.[0]?.status ?? body?.data?.status ?? "unknown";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let numberA = process.argv[2];
  let numberB = process.argv[3];

  if (!numberA || !numberB) {
    console.log("No numbers provided, picking two from the account...\n");
    const all = await listActiveNumbers();
    if (all.length < 2) {
      console.error(`Need at least 2 numbers with messaging profiles, found ${all.length}`);
      process.exit(1);
    }
    numberA = all[0];
    numberB = all[1];
  }

  console.log(`=== SMS Test ===`);
  console.log(`  Number A: ${numberA}`);
  console.log(`  Number B: ${numberB}`);

  // ── Step 1: Check messaging features ─────────────────────────────────────

  console.log("\n--- Step 1: Checking messaging features ---");

  const [featA, featB] = await Promise.all([
    getMessagingFeatures(numberA),
    getMessagingFeatures(numberB),
  ]);

  for (const [label, num, feat] of [["A", numberA, featA], ["B", numberB, featB]] as const) {
    if (!feat) {
      console.error(`  ❌ ${label} (${num}): could not retrieve messaging features`);
      continue;
    }
    const sms = feat.features?.sms;
    const profile = feat.messaging_profile_id;
    const domestic = sms?.domestic_two_way ? "✅" : "❌";
    const intlIn = sms?.international_inbound ? "✅" : "—";
    const intlOut = sms?.international_outbound ? "✅" : "—";
    console.log(`  ${label} (${num}):`);
    console.log(`     Profile: ${profile ?? "none"}`);
    console.log(`     SMS domestic 2-way: ${domestic}  intl-in: ${intlIn}  intl-out: ${intlOut}`);

    if (!sms?.domestic_two_way) {
      console.error(`     ⚠️  SMS domestic 2-way is OFF — messages may fail`);
    }
  }

  // ── Step 2: Send messages ────────────────────────────────────────────────

  console.log("\n--- Step 2: Sending messages ---");

  const ts = new Date().toISOString();
  const msgIdAtoB = await sendSMS(numberA, numberB, `Hey B, this is A (${numberA}) @ ${ts}`);
  const msgIdBtoA = await sendSMS(numberB, numberA, `Hey A, this is B (${numberB}) @ ${ts}`);

  if (!msgIdAtoB && !msgIdBtoA) {
    console.error("\n  Both sends failed. SMS is not working on these numbers.");
    process.exit(1);
  }

  // ── Step 3: Poll delivery status ─────────────────────────────────────────

  console.log("\n--- Step 3: Checking delivery status (polling up to 30s) ---");

  const toCheck = [
    ...(msgIdAtoB ? [{ id: msgIdAtoB, label: "A→B" }] : []),
    ...(msgIdBtoA ? [{ id: msgIdBtoA, label: "B→A" }] : []),
  ];

  const finalStatuses: Record<string, string> = {};

  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    console.log(`\n  Poll ${i + 1}/6 (${(i + 1) * 5}s):`);

    let allDone = true;
    for (const msg of toCheck) {
      const s = await checkStatus(msg.id);
      finalStatuses[msg.label] = s;
      console.log(`     ${msg.label}: ${s}`);
      if (!["delivered", "sent", "failed", "delivery_failed", "sending_failed"].includes(s)) {
        allDone = false;
      }
    }

    if (allDone) {
      console.log("\n  All messages reached terminal status.");
      break;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log("\n--- Summary ---");

  const aToBOk = finalStatuses["A→B"] === "delivered";
  const bToAOk = finalStatuses["B→A"] === "delivered";

  console.log(`  A→B: ${msgIdAtoB ? (aToBOk ? "✅ delivered" : `⚠️  ${finalStatuses["A→B"] ?? "no status"}`) : "❌ send failed"}`);
  console.log(`  B→A: ${msgIdBtoA ? (bToAOk ? "✅ delivered" : `⚠️  ${finalStatuses["B→A"] ?? "no status"}`) : "❌ send failed"}`);
  console.log(`  SMS features A: ${featA?.features?.sms?.domestic_two_way ? "✅" : "❌"}`);
  console.log(`  SMS features B: ${featB?.features?.sms?.domestic_two_way ? "✅" : "❌"}`);

  if (aToBOk && bToAOk) {
    console.log("\n  ✅ Both directions delivered successfully — SMS is working!\n");
  } else {
    console.log("\n  ⚠️  Some messages did not reach 'delivered' status. Check above for details.\n");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
