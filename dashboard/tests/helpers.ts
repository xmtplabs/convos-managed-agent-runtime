const MOCK_POOL_URL = "http://localhost:3002";

export async function setMockState(state: string): Promise<void> {
  const res = await fetch(`${MOCK_POOL_URL}/_control/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`Failed to set mock state: ${await res.text()}`);
}
