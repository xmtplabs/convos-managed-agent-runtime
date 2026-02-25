/**
 * Quick connectivity + rate-limit check for the Railway API.
 * Usage: node --env-file=.env src/railway-check.js
 */

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

async function main() {
  for (const key of ["RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID"]) {
    if (!process.env[key]) {
      console.error(`Missing env var: ${key}`);
      process.exit(1);
    }
  }

  console.log("Checking Railway API...\n");

  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RAILWAY_API_TOKEN}`,
    },
    body: JSON.stringify({
      query: `query($id: String!) {
        project(id: $id) {
          services(first: 500) { edges { node { id name } } }
        }
      }`,
      variables: { id: process.env.RAILWAY_PROJECT_ID },
    }),
  });

  // Rate limit headers
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  const retryAfter = res.headers.get("retry-after");

  // Always show rate limit info
  console.log("Rate limits:");
  console.log(`  Limit:     ${limit ?? "unknown"} requests/window`);
  console.log(`  Remaining: ${remaining ?? "unknown"}`);
  const used = limit && remaining ? `${Number(limit) - Number(remaining)}` : "unknown";
  console.log(`  Used:      ${used}`);
  if (reset) {
    // Railway may send unix seconds, unix ms, or ISO string
    let resetDate = new Date(reset);
    if (isNaN(resetDate)) resetDate = new Date(Number(reset) * 1000);
    if (isNaN(resetDate)) resetDate = new Date(Number(reset));
    if (!isNaN(resetDate)) {
      const minsLeft = Math.round((resetDate - Date.now()) / 60000);
      console.log(`  Resets at: ${resetDate.toLocaleTimeString()} (${minsLeft > 0 ? `in ${minsLeft}m` : "now"})`);
    } else {
      console.log(`  Reset:     ${reset}`);
    }
  }
  if (retryAfter) {
    const hrs = (Number(retryAfter) / 3600).toFixed(1);
    console.log(`  Retry in:  ${hrs}h`);
  }
  console.log();

  if (res.status === 429) {
    console.error("RATE LIMITED — wait for the window to reset.");
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`API error: HTTP ${res.status}`);
    process.exit(1);
  }

  const json = await res.json();
  if (json.errors) {
    console.error(`API error: ${JSON.stringify(json.errors)}`);
    process.exit(1);
  }

  const services = json.data?.project?.services?.edges || [];
  const agents = services.filter((e) => e.node.name.startsWith("convos-agent-"));

  console.log(`Services:  ${services.length} total, ${agents.length} agent instances`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
