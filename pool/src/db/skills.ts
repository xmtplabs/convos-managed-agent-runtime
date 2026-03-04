import { eq, sql } from "drizzle-orm";
import { db } from "./connection";
import { agentSkills } from "./schema";
import type { SkillRow, SkillVisibility } from "./schema";

export function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function createSkill(data: {
  creatorId: string;
  agentName: string;
  prompt: string;
  slug?: string;
  description?: string;
  category?: string;
  emoji?: string;
  tools?: string[];
  visibility?: SkillVisibility;
}): Promise<SkillRow> {
  const id = crypto.randomUUID();
  const rows = await db.insert(agentSkills).values({
    id,
    creatorId: data.creatorId,
    slug: data.slug || slugify(data.agentName),
    agentName: data.agentName,
    description: data.description ?? "",
    prompt: data.prompt,
    category: data.category ?? "",
    emoji: data.emoji ?? "",
    tools: data.tools ?? [],
    visibility: data.visibility ?? "private",
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

export async function listPublic(): Promise<SkillRow[]> {
  return db.select().from(agentSkills)
    .where(eq(agentSkills.visibility, "public"))
    .orderBy(agentSkills.createdAt);
}

export async function listByCreator(creatorId: string): Promise<SkillRow[]> {
  return db.select().from(agentSkills)
    .where(eq(agentSkills.creatorId, creatorId))
    .orderBy(agentSkills.createdAt);
}

export async function updateSkill(
  id: string,
  data: Partial<{
    agentName: string;
    prompt: string;
    slug: string;
    description: string;
    category: string;
    emoji: string;
    tools: string[];
    visibility: SkillVisibility;
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
