import { eq, sql } from "drizzle-orm";
import { db } from "./connection";
import { agentSkills } from "./schema";
import type { SkillRow } from "./schema";

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function createSkill(data: {
  agentName: string;
  slug?: string;
  prompt?: string;
  description?: string;
  category?: string;
  emoji?: string;
  tools?: string[];
  published?: boolean;
}): Promise<SkillRow> {
  const id = crypto.randomUUID();
  const slug = data.slug || slugify(data.agentName) || `skill-${id.slice(0, 8)}`;
  const rows = await db.insert(agentSkills).values({
    id,
    slug,
    agentName: data.agentName,
    description: data.description ?? "",
    prompt: data.prompt ?? "",
    category: data.category ?? "",
    emoji: data.emoji ?? "",
    tools: data.tools ?? [],
    published: data.published ?? false,
  }).returning();
  return rows[0];
}

export async function findById(id: string): Promise<SkillRow | null> {
  const rows = await db.select().from(agentSkills).where(eq(agentSkills.id, id));
  return rows[0] ?? null;
}

export async function findBySlug(slug: string): Promise<SkillRow | null> {
  const rows = await db.select().from(agentSkills).where(eq(agentSkills.slug, slug));
  return rows[0] ?? null;
}

export async function listPublished(): Promise<SkillRow[]> {
  return db.select().from(agentSkills)
    .where(eq(agentSkills.published, true))
    .orderBy(agentSkills.createdAt);
}

export async function listAll(): Promise<SkillRow[]> {
  return db.select().from(agentSkills)
    .orderBy(agentSkills.createdAt);
}

export async function updateSkill(
  id: string,
  data: Partial<{
    agentName: string;
    prompt: string;
    description: string;
    category: string;
    emoji: string;
    tools: string[];
    published: boolean;
  }>,
): Promise<SkillRow | null> {
  const rows = await db.update(agentSkills).set({
    ...data,
    updatedAt: sql`NOW()`,
  }).where(eq(agentSkills.id, id)).returning();
  return rows[0] ?? null;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const result = await db.delete(agentSkills).where(eq(agentSkills.id, id));
  return (result.rowCount ?? 0) > 0;
}
