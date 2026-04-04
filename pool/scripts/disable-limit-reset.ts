/**
 * Disable monthly credit reset on all existing OpenRouter sub-keys.
 *
 * Usage:
 *   source .env.dev && npx tsx pool/scripts/disable-limit-reset.ts
 *   # or with --dry-run to just list keys without patching
 *   source .env.dev && npx tsx pool/scripts/disable-limit-reset.ts --dry-run
 */

const OPENROUTER_MGMT_KEY = process.env.OPENROUTER_MANAGEMENT_KEY ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

async function listAllKeys(): Promise<{ hash: string; name: string; limit_reset: string }[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`https://openrouter.ai/api/v1/keys?offset=${offset}`, {
      headers: { Authorization: `Bearer ${OPENROUTER_MGMT_KEY}` },
    });
    if (!res.ok) throw new Error(`List keys failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as any;
    const keys: any[] = body?.data ?? [];
    if (keys.length === 0) break;
    all.push(...keys);
    offset += keys.length;
  }
  return all.map((k) => ({ hash: k.hash, name: k.name, limit_reset: k.limit_reset ?? "unknown" }));
}

async function patchKey(hash: string): Promise<boolean> {
  const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${OPENROUTER_MGMT_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit_reset: null }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`    PATCH ${hash} → ${res.status}: ${body}`);
  }
  return res.ok;
}

async function main() {
  if (!OPENROUTER_MGMT_KEY) {
    console.error("OPENROUTER_MANAGEMENT_KEY not set");
    process.exit(1);
  }

  if (DRY_RUN) console.log("DRY RUN — nothing will be patched\n");

  const keys = await listAllKeys();
  const toFix = keys.filter((k) => k.limit_reset !== null && k.limit_reset !== "unknown" && k.limit_reset !== "null");

  console.log(`Found ${keys.length} key(s) total, ${toFix.length} with limit_reset still set\n`);

  if (toFix.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let ok = 0;
  let failed = 0;

  let remaining = [...toFix];
  let attempt = 0;

  while (remaining.length > 0) {
    attempt++;
    if (attempt > 1) {
      console.log(`\nRetry #${attempt - 1} — ${remaining.length} key(s) remaining, waiting 30s...\n`);
      await new Promise((r) => setTimeout(r, 30000));
    }

    const nextRound: typeof remaining = [];

    for (let i = 0; i < remaining.length; i += 5) {
      const chunk = remaining.slice(i, i + 5);
      if (DRY_RUN) {
        chunk.forEach((k) => console.log(`  [skip] ${k.name} (${k.hash}) — ${k.limit_reset}`));
      } else {
        const results = await Promise.all(chunk.map((k) => patchKey(k.hash)));
        for (let j = 0; j < chunk.length; j++) {
          if (results[j]) {
            console.log(`  [ok] ${chunk[j].name} (${chunk[j].hash})`);
            ok++;
          } else {
            nextRound.push(chunk[j]);
            failed++;
          }
        }
        // pause 1s between chunks to avoid rate limits
        if (i + 5 < remaining.length) await new Promise((r) => setTimeout(r, 1000));
      }
    }

    remaining = nextRound;
    if (attempt >= 5) break;
  }

  if (!DRY_RUN) {
    console.log(`\nPatched ${ok} key(s), ${failed} failed.`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
