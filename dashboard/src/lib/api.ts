import type { AgentSkill, PoolCounts } from "./types";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function getSkills(): Promise<AgentSkill[]> {
  const res = await fetch(`${POOL_API_URL}/api/skills`, {
    next: { revalidate: 60, tags: ["skills"] },
  });
  if (!res.ok) throw new Error(`Failed to fetch skills: ${res.status}`);
  return res.json();
}

export async function getSkill(slug: string): Promise<AgentSkill | null> {
  const res = await fetch(`${POOL_API_URL}/api/skills/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60, tags: ["skills", `skill:${slug}`] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch skill: ${res.status}`);
  return res.json();
}

export async function getPoolCounts(): Promise<PoolCounts> {
  const res = await fetch(`${POOL_API_URL}/api/pool/counts`, {
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`Failed to fetch counts: ${res.status}`);
  return res.json();
}
