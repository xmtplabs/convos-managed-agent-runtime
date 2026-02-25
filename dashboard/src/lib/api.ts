import type { AgentSkill, PoolCounts, PromptData } from "./types";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function getSkills(): Promise<AgentSkill[]> {
  const res = await fetch(`${POOL_API_URL}/api/pool/templates`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  return res.json();
}

export async function getSkill(slug: string): Promise<AgentSkill | null> {
  const res = await fetch(`${POOL_API_URL}/api/pool/templates/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch template: ${res.status}`);
  return res.json();
}

export async function getPoolCounts(): Promise<PoolCounts> {
  const res = await fetch(`${POOL_API_URL}/api/pool/counts`, {
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`Failed to fetch counts: ${res.status}`);
  return res.json();
}

export async function getPrompt(pageId: string): Promise<PromptData> {
  const res = await fetch(`${POOL_API_URL}/api/prompts/${pageId}`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Failed to fetch prompt: ${res.status}`);
  return res.json();
}
