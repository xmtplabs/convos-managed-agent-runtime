/**
 * Ping the Railway GraphQL API and check rate-limit status.
 *
 * Usage:  pnpm railway:test
 */

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const TOKEN = process.env.RAILWAY_API_TOKEN ?? "";
const LIMIT_PER_HOUR = 10_000;

async function main() {
  if (!TOKEN) {
    console.error("RAILWAY_API_TOKEN not set. Add it to pool/.env");
    process.exit(1);
  }

  // Simple introspection query — lightweight ping
  const query = `{ me { name email } }`;

  const start = performance.now();
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });
  const ms = (performance.now() - start).toFixed(0);
  const body = await res.json();

  console.log(`\n  Status:   ${res.status} (${ms}ms)`);

  if (res.status === 429) {
    console.log("  RATE LIMITED! Wait before making more requests.\n");
    process.exit(1);
  }

  if (body.data?.me) {
    console.log(`  Account:  ${body.data.me.name} <${body.data.me.email}>`);
  }

  // Print rate-limit headers
  const rlHeaders = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
    "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "ratelimit-policy", "retry-after"];
  let remaining: number | null = null;

  console.log("\n  Headers:");
  for (const key of rlHeaders) {
    const val = res.headers.get(key);
    if (val) {
      console.log(`    ${key}: ${val}`);
      if (key.includes("remaining")) remaining = parseInt(val, 10);
    }
  }

  // Budget estimate
  const now = new Date();
  const minutesLeft = 60 - now.getMinutes();

  console.log(`\n  Budget:   ${LIMIT_PER_HOUR.toLocaleString()}/hr`);
  if (remaining !== null) {
    console.log(`  Remaining: ${remaining.toLocaleString()}`);
    console.log(`  Used:      ${(LIMIT_PER_HOUR - remaining).toLocaleString()}`);
  } else {
    console.log("  Remaining: (no header — Railway may not expose this)");
  }
  console.log(`  Minutes left in hour: ${minutesLeft}\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
