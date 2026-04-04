/**
 * Quick test: generate invite codes via the Convos API.
 * Usage: pnpm invite:test
 */
const apiUrl = process.env.CONVOS_INVITE_API_URL;
const apiToken = process.env.CONVOS_INVITE_API_TOKEN;

if (!apiUrl || !apiToken) {
  console.error("Set CONVOS_INVITE_API_URL and CONVOS_INVITE_API_TOKEN");
  process.exit(1);
}

async function main() {
  console.log(`API: ${apiUrl}/generate`);
  console.log("Generating 1 invite code...\n");

  const res = await fetch(`${apiUrl}/generate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ count: 1 }),
  });

  console.log(`Status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed:", text.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));

  const codes = data.data?.codes || data.codes || data.inviteCodes || [];
  if (codes.length > 0) {
    console.log(`\nGenerated ${codes.length} code(s)`);
  } else {
    console.warn("\nNo codes in response — check API response shape above");
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
