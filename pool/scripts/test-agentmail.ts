/**
 * Quick test: create an AgentMail inbox and delete it.
 * Usage: npx tsx scripts/test-agentmail.ts
 */
const apiKey = process.env.AGENTMAIL_API_KEY;
if (!apiKey) { console.error("Set AGENTMAIL_API_KEY"); process.exit(1); }

const domain = process.env.AGENTMAIL_DOMAIN || undefined;

async function main() {
  console.log("Creating inbox...");
  const res = await fetch("https://api.agentmail.to/v0/inboxes", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-" + Date.now(), domain, display_name: "Test" }),
  });
  const body = await res.json();
  console.log(`Status: ${res.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (body.inbox_id) {
    console.log("\nDeleting inbox...");
    const del = await fetch(`https://api.agentmail.to/v0/inboxes/${body.inbox_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    console.log(`Delete status: ${del.status}`);
  }
}

main().catch(console.error);
