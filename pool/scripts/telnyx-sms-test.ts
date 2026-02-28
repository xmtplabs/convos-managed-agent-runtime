/**
 * SMS end-to-end test — makes two numbers talk to each other and verifies
 * both outbound delivery AND inbound receipt via the MDR API.
 *
 * Usage:  pnpm telnyx:sms-test
 *         pnpm telnyx:sms-test +1AAAAAAAAAA +1BBBBBBBBBB   (specific numbers)
 *
 * What it does:
 *   1. Verifies messaging features (SMS) are enabled on both numbers
 *   2. A texts B, B texts A
 *   3. Polls delivery status until both reach terminal state
 *   4. Polls MDR for inbound records — confirms each number received the other's message
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

async function checkInbound(toNumber: string, sinceISO?: string): Promise<{ records: any[]; total: number }> {
  const params = new URLSearchParams({
    "filter[record_type]": "message",
    "filter[direction]": "inbound",
    "filter[cld]": toNumber,
    "page[size]": "10",
  });
  if (sinceISO) params.set("filter[sent_at][gte]", sinceISO);
  const res = await fetch(`${TELNYX_API}/detail_records?${params}`, {
    headers: hdrs(),
  });
  if (!res.ok) return { records: [], total: 0 };
  const body = (await res.json()) as any;
  return { records: body?.data ?? [], total: body?.meta?.total_results ?? 0 };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const AGENT_NUMBER = "+14193792549";
  const PARTNER_NUMBER = "+15072608139";
  let numberA = process.argv[2] ?? AGENT_NUMBER;
  let numberB = process.argv[3] ?? PARTNER_NUMBER;

  console.log(`=== SMS End-to-End Test ===`);
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
    console.log(`  ${label} (${num}): profile=${profile ?? "none"}  domestic-2way=${domestic}`);

    if (!sms?.domestic_two_way) {
      console.error(`     ⚠️  SMS domestic 2-way is OFF — messages may fail`);
    }
  }

  // ── Step 2: Send messages ────────────────────────────────────────────────

  // MDR sent_at can lag — use a 60s offset so the filter doesn't miss records
  const sentAt = new Date(Date.now() - 60_000).toISOString();
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

  // ── Step 4: Poll inbound via MDR ─────────────────────────────────────────

  console.log("\n--- Step 4: Checking inbound receipt via MDR (polling up to 60s) ---");

  let resA = { records: [] as any[], total: 0 };
  let resB = { records: [] as any[], total: 0 };

  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    [resA, resB] = await Promise.all([
      checkInbound(numberA, sentAt),
      checkInbound(numberB, sentAt),
    ]);

    console.log(`\n  Poll ${i + 1}/12 (${(i + 1) * 5}s):`);
    console.log(`     A (${numberA}) new: ${resA.records.length}`);
    console.log(`     B (${numberB}) new: ${resB.records.length}`);

    if (resA.records.length > 0 && resB.records.length > 0) {
      console.log("\n  Both numbers received inbound messages.");
      break;
    }
  }

  // Fetch total accumulated inbound counts
  const [totalA, totalB] = await Promise.all([
    checkInbound(numberA),
    checkInbound(numberB),
  ]);

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log("\n--- Summary ---");

  const aToBOk = finalStatuses["A→B"] === "delivered";
  const bToAOk = finalStatuses["B→A"] === "delivered";
  const aRecvOk = resA.records.length > 0;
  const bRecvOk = resB.records.length > 0;

  console.log(`  A→B send:     ${msgIdAtoB ? (aToBOk ? "✅ delivered" : `⚠️  ${finalStatuses["A→B"] ?? "no status"}`) : "❌ send failed"}`);
  console.log(`  B→A send:     ${msgIdBtoA ? (bToAOk ? "✅ delivered" : `⚠️  ${finalStatuses["B→A"] ?? "no status"}`) : "❌ send failed"}`);
  console.log(`  A inbound:    ${aRecvOk ? `✅ ${resA.records.length} new from ${resA.records.map((r) => r.cli).join(", ")}` : "❌ no inbound"}  (${totalA.total} total)`);
  console.log(`  B inbound:    ${bRecvOk ? `✅ ${resB.records.length} new from ${resB.records.map((r) => r.cli).join(", ")}` : "❌ no inbound"}  (${totalB.total} total)`);

  const allPass = aToBOk && bToAOk && aRecvOk && bRecvOk;

  if (allPass) {
    console.log("\n  ✅ Full E2E pass — send + delivery + inbound receipt confirmed!\n");
  } else {
    console.log("\n  ❌ Test failed. Check above for details.\n");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
