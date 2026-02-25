const MOCK_POOL_PORT = process.env.MOCK_POOL_PORT || "3002";
const MOCK_POOL_URL = `http://localhost:${MOCK_POOL_PORT}`;

export async function setMockState(state: string): Promise<void> {
  const res = await fetch(`${MOCK_POOL_URL}/_control/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`Failed to set mock state: ${await res.text()}`);
}

export { MOCK_POOL_URL };
