/**
 * SMS end-to-end test — makes two numbers talk to each other.
 *
 * Usage:  pnpm telnyx:sms-test
 *         pnpm telnyx:sms-test +1AAAAAAAAAA +1BBBBBBBBBB   (specific numbers)
 *
 * What it does:
 *   1. Picks two numbers from the account (or uses the ones you pass)
 *   2. A texts B, B texts A
 *   3. Polls for delivery status + incoming messages on each number
 */

const TELNYX_API = "https://api.telnyx.com/v2";
const API_KEY = process.env.TELNYX_API_KEY;

if (!API_KEY) {
  console.error("TELNYX_API_KEY not set. Add it to pool/.env");
  process.exit(1);
}

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function listActiveNumbers(): Promise<string[]> {
  const res = await fetch(
    `${TELNYX_API}/phone_numbers?page[size]=100&filter[status]=active`,
    { headers: headers() },
  );
  const body = (await res.json()) as any;
  return (body?.data ?? [])
    .filter((n: any) => n.messaging_profile_id) // only numbers with messaging
    .map((n: any) => n.phone_number);
}

async function sendSMS(from: string, to: string, text: string): Promise<string | null> {
  console.log(`\n  📤 ${from} → ${to}: "${text}"`);
  const res = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: headers(),
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

async function checkStatus(messageId: string): Promise<any> {
  const res = await fetch(`${TELNYX_API}/messages/${messageId}`, {
    headers: headers(),
  });
  return (await res.json()) as any;
}

async function listMessages(phoneNumber: string, direction: "inbound" | "outbound"): Promise<any[]> {
  // MDR (message detail records) endpoint for retrieving sent/received messages
  const params = new URLSearchParams({
    "page[size]": "5",
    "filter[direction]": direction,
  });
  const res = await fetch(`${TELNYX_API}/messages?${params}`, {
    headers: headers(),
  });
  const body = (await res.json()) as any;
  return (body?.data ?? []).filter(
    (m: any) =>
      (direction === "outbound" && m.from?.phone_number === phoneNumber) ||
      (direction === "inbound" && m.to?.[0]?.phone_number === phoneNumber),
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

  // ── Step 1: Send messages ──────────────────────────────────────────────────

  console.log("\n--- Step 1: Sending messages ---");

  const msgIdAtoB = await sendSMS(numberA, numberB, `Hey B, this is A (${numberA}) testing at ${new Date().toISOString()}`);
  const msgIdBtoA = await sendSMS(numberB, numberA, `Hey A, this is B (${numberB}) testing at ${new Date().toISOString()}`);

  if (!msgIdAtoB && !msgIdBtoA) {
    console.error("\n  Both sends failed. SMS is not working on these numbers.");
    process.exit(1);
  }

  // ── Step 2: Poll delivery status ───────────────────────────────────────────

  console.log("\n--- Step 2: Checking delivery status (polling for 30s) ---");

  const toCheck = [
    ...(msgIdAtoB ? [{ id: msgIdAtoB, label: "A→B" }] : []),
    ...(msgIdBtoA ? [{ id: msgIdBtoA, label: "B→A" }] : []),
  ];

  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    console.log(`\n  Poll ${i + 1}/6 (${(i + 1) * 5}s):`);

    let allDone = true;
    for (const msg of toCheck) {
      const status = await checkStatus(msg.id);
      const s = status?.data?.to?.[0]?.status ?? status?.data?.status ?? "unknown";
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

  // ── Step 3: Check inbound messages ─────────────────────────────────────────

  console.log("\n--- Step 3: Checking inbound messages ---");

  const inboundA = await listMessages(numberA, "inbound");
  const inboundB = await listMessages(numberB, "inbound");

  console.log(`\n  Inbound for A (${numberA}): ${inboundA.length} message(s)`);
  for (const m of inboundA.slice(0, 3)) {
    console.log(`     From: ${m.from?.phone_number}  Text: "${m.text}"`);
  }

  console.log(`\n  Inbound for B (${numberB}): ${inboundB.length} message(s)`);
  for (const m of inboundB.slice(0, 3)) {
    console.log(`     From: ${m.from?.phone_number}  Text: "${m.text}"`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n--- Summary ---");
  console.log(`  A→B send: ${msgIdAtoB ? "OK" : "FAILED"}`);
  console.log(`  B→A send: ${msgIdBtoA ? "OK" : "FAILED"}`);
  console.log(`  A inbound: ${inboundA.length} message(s)`);
  console.log(`  B inbound: ${inboundB.length} message(s)`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
