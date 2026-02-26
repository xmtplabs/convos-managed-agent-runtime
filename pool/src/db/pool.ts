import { eq, and, sql, notInArray, inArray } from "drizzle-orm";
import { db } from "./connection";
import { pool as pgPool } from "./connection";
import { instances } from "./schema";
import type { InstanceRow, InstanceStatus } from "./schema";

interface UpsertInstanceOpts {
  id: string;
  name: string;
  url?: string | null;
  status: InstanceStatus;
  agentName?: string | null;
  conversationId?: string | null;
  inviteUrl?: string | null;
  instructions?: string | null;
  createdAt?: string | null;
  claimedAt?: string | null;
}

export async function upsertInstance({ id, name, url, status, agentName, conversationId, inviteUrl, instructions, createdAt, claimedAt }: UpsertInstanceOpts) {
  await db.insert(instances).values({
    id,
    name,
    url: url || null,
    status,
    agentName: agentName || null,
    conversationId: conversationId || null,
    inviteUrl: inviteUrl || null,
    instructions: instructions || null,
    createdAt: createdAt || new Date().toISOString(),
    claimedAt: claimedAt || null,
  }).onConflictDoUpdate({
    target: instances.id,
    set: {
      name: sql`EXCLUDED.name`,
      url: sql`COALESCE(EXCLUDED.url, ${instances.url})`,
      status: sql`EXCLUDED.status`,
      agentName: sql`COALESCE(EXCLUDED.agent_name, ${instances.agentName})`,
      conversationId: sql`COALESCE(EXCLUDED.conversation_id, ${instances.conversationId})`,
      inviteUrl: sql`COALESCE(EXCLUDED.invite_url, ${instances.inviteUrl})`,
      instructions: sql`COALESCE(EXCLUDED.instructions, ${instances.instructions})`,
      claimedAt: sql`COALESCE(EXCLUDED.claimed_at, ${instances.claimedAt})`,
    },
  });
}

export async function findById(id: string): Promise<InstanceRow | null> {
  const rows = await db.select().from(instances).where(eq(instances.id, id));
  return rows[0] ?? null;
}

export async function listAll(): Promise<InstanceRow[]> {
  return db.select().from(instances).orderBy(instances.createdAt);
}

export async function getByStatus(statuses: InstanceStatus | InstanceStatus[]): Promise<InstanceRow[]> {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  return db.select().from(instances).where(inArray(instances.status, list)).orderBy(instances.createdAt);
}

export async function getCounts(): Promise<Record<InstanceStatus, number>> {
  const rows = await db.select({
    status: instances.status,
    count: sql<number>`count(*)::int`,
  }).from(instances).groupBy(instances.status);

  const counts = { starting: 0, idle: 0, claimed: 0, crashed: 0, claiming: 0, dead: 0, sleeping: 0 } as Record<InstanceStatus, number>;
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

/** Atomically claim one idle instance using FOR UPDATE SKIP LOCKED. */
export async function claimIdle(): Promise<InstanceRow | null> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      UPDATE instances SET status = 'claiming'
      WHERE id = (
        SELECT id FROM instances
        WHERE status = 'idle'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      status: row.status,
      agentName: row.agent_name,
      conversationId: row.conversation_id,
      inviteUrl: row.invite_url,
      instructions: row.instructions,
      createdAt: row.created_at,
      claimedAt: row.claimed_at,
    } as InstanceRow;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function completeClaim(instanceId: string, { agentName, conversationId, inviteUrl, instructions }: { agentName: string; conversationId?: string | null; inviteUrl?: string | null; instructions?: string | null }) {
  await db.update(instances).set({
    status: "claimed",
    agentName,
    conversationId: conversationId || null,
    inviteUrl: inviteUrl || null,
    instructions: instructions || null,
    claimedAt: sql`NOW()`,
  }).where(eq(instances.id, instanceId));
}

export async function releaseClaim(instanceId: string) {
  await db.update(instances).set({ status: "idle" }).where(and(eq(instances.id, instanceId), eq(instances.status, "claiming")));
}

export async function updateStatus(instanceId: string, { status, url }: { status?: string | null; url?: string | null }) {
  await db.update(instances).set({
    status: sql`COALESCE(${status || null}, ${instances.status})`,
    url: sql`COALESCE(${url || null}, ${instances.url})`,
  }).where(eq(instances.id, instanceId));
}

export async function deleteById(id: string) {
  await db.delete(instances).where(eq(instances.id, id));
}

export async function deleteOrphaned(activeInstanceIds: string[]) {
  if (!activeInstanceIds || activeInstanceIds.length === 0) return;
  const result = await db.delete(instances).where(
    and(
      notInArray(instances.id, activeInstanceIds),
      sql`${instances.status} NOT IN ('starting', 'claiming')`,
    )
  );
  const count = result.rowCount || 0;
  if (count > 0) console.log(`[db] Cleaned ${count} orphaned instance row(s)`);
}
