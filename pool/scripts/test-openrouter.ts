/**
 * Quick test: count OpenRouter keys and check credits.
 * Usage: pnpm openrouter:test
 */
const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
if (!mgmtKey) { console.error("Set OPENROUTER_MANAGEMENT_KEY"); process.exit(1); }

async function main() {
  // Credits
  console.log("Fetching credits...");
  const creditsRes = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${mgmtKey}` },
  });
  console.log(`Credits status: ${creditsRes.status}`);
  if (creditsRes.status === 429) { console.error("RATE LIMITED"); }
  if (creditsRes.ok) {
    const credits = await creditsRes.json();
    console.log(JSON.stringify(credits, null, 2));
  } else {
    console.error(await creditsRes.text());
  }

  // Count keys (paginate)
  console.log("\nCounting keys...");
  let total = 0;
  let offset = 0;
  while (true) {
    const res = await fetch(`https://openrouter.ai/api/v1/keys?offset=${offset}`, {
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (res.status === 429) { console.error("RATE LIMITED at offset", offset); break; }
    if (!res.ok) { console.error(`Error ${res.status}:`, await res.text()); break; }
    const body = await res.json() as any;
    const keys = body?.data ?? [];
    if (keys.length === 0) break;
    total += keys.length;
    offset += keys.length;
    process.stdout.write(`  ...${total} keys so far\r`);
  }
  console.log(`\nTotal keys: ${total}`);
}

main().catch(console.error);
