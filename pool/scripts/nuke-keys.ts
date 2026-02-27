/**
 * Nuke all OpenRouter keys and AgentMail inboxes.
 *
 * Usage:
 *   source .env.dev && npx tsx pool/scripts/nuke-keys.ts
 *   # or with --dry-run to just list without deleting
 *   source .env.dev && npx tsx pool/scripts/nuke-keys.ts --dry-run
 */

const OPENROUTER_MGMT_KEY = process.env.OPENROUTER_MANAGEMENT_KEY ?? "";
const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

// ── OpenRouter ──────────────────────────────────────────────────────

async function listOpenRouterKeys(): Promise<{ hash: string; name: string }[]> {
  const res = await fetch("https://openrouter.ai/api/v1/keys", {
    headers: { Authorization: `Bearer ${OPENROUTER_MGMT_KEY}` },
  });
  if (!res.ok) throw new Error(`List keys failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as any;
  return (body?.data ?? []).map((k: any) => ({ hash: k.hash, name: k.name }));
}

async function deleteOpenRouterKey(hash: string): Promise<boolean> {
  const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${OPENROUTER_MGMT_KEY}` },
  });
  return res.ok || res.status === 404; // 404 = already deleted
}

// ── AgentMail ───────────────────────────────────────────────────────

async function listAgentMailInboxes(): Promise<{ inbox_id: string; username: string }[]> {
  const all: { inbox_id: string; username: string }[] = [];
  let cursor: string | undefined;

  while (true) {
    const url = new URL("https://api.agentmail.to/v0/inboxes");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AGENTMAIL_API_KEY}` },
    });
    if (!res.ok) throw new Error(`List inboxes failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as any;
    const inboxes: any[] = body?.inboxes ?? body?.data ?? [];
    for (const inbox of inboxes) {
      all.push({ inbox_id: inbox.inbox_id ?? inbox.id, username: inbox.username ?? "" });
    }

    cursor = body?.next_cursor;
    if (!cursor || inboxes.length === 0) break;
  }

  return all;
}

async function deleteAgentMailInbox(inboxId: string): Promise<boolean> {
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${inboxId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${AGENTMAIL_API_KEY}` },
  });
  return res.ok;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log("🔍 DRY RUN — nothing will be deleted\n");

  // OpenRouter — loop until all pages are drained
  if (OPENROUTER_MGMT_KEY) {
    console.log("── OpenRouter Keys ──");
    let total = 0;
    while (true) {
      const keys = await listOpenRouterKeys();
      if (keys.length === 0) break;
      total += keys.length;
      console.log(`  Batch of ${keys.length} keys (${total} total so far)`);

      if (DRY_RUN) {
        keys.forEach((k) => console.log(`    [skip] ${k.name} (${k.hash})`));
      } else {
        // Delete in chunks of 20 to avoid rate limits
        let ok = 0, failed = 0;
        for (let i = 0; i < keys.length; i += 20) {
          const chunk = keys.slice(i, i + 20);
          const results = await Promise.all(
            chunk.map(async (key) => deleteOpenRouterKey(key.hash))
          );
          ok += results.filter(Boolean).length;
          failed += results.filter((r) => !r).length;
        }
        console.log(`    ${ok} deleted, ${failed} failed`);
        if (ok === 0) {
          console.log(`    Rate limited — waiting 30s...`);
          await new Promise((r) => setTimeout(r, 30000));
        } else if (failed > 50) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    console.log(`Deleted ${total} OpenRouter key(s) total`);
  } else {
    console.log("OPENROUTER_MANAGEMENT_KEY not set — skipping OpenRouter");
  }

  console.log();

  // AgentMail
  if (AGENTMAIL_API_KEY) {
    console.log("── AgentMail Inboxes ──");
    const inboxes = await listAgentMailInboxes();
    console.log(`Found ${inboxes.length} inbox(es)`);

    for (const inbox of inboxes) {
      if (DRY_RUN) {
        console.log(`  [skip] ${inbox.username} (${inbox.inbox_id})`);
      } else {
        const ok = await deleteAgentMailInbox(inbox.inbox_id);
        console.log(`  ${ok ? "[deleted]" : "[FAILED]"} ${inbox.username} (${inbox.inbox_id})`);
      }
    }
  } else {
    console.log("AGENTMAIL_API_KEY not set — skipping AgentMail");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
