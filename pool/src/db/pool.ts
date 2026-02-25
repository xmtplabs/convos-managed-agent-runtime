import { sql, pool as pgPool } from "./connection.js";

interface UpsertInstanceOpts {
  id: string;
  name: string;
  url?: string | null;
  status: string;
  agentName?: string | null;
  conversationId?: string | null;
  inviteUrl?: string | null;
  instructions?: string | null;
  createdAt?: string | null;
  claimedAt?: string | null;
}

export async function upsertInstance({ id, name, url, status, agentName, conversationId, inviteUrl, instructions, createdAt, claimedAt }: UpsertInstanceOpts) {
  await sql`
    INSERT INTO instances (id, name, url, status, agent_name, conversation_id, invite_url, instructions, created_at, claimed_at)
    VALUES (${id}, ${name}, ${url || null}, ${status}, ${agentName || null}, ${conversationId || null}, ${inviteUrl || null}, ${instructions || null}, ${createdAt || new Date().toISOString()}, ${claimedAt || null})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      url = COALESCE(EXCLUDED.url, instances.url),
      status = EXCLUDED.status,
      agent_name = COALESCE(EXCLUDED.agent_name, instances.agent_name),
      conversation_id = COALESCE(EXCLUDED.conversation_id, instances.conversation_id),
      invite_url = COALESCE(EXCLUDED.invite_url, instances.invite_url),
      instructions = COALESCE(EXCLUDED.instructions, instances.instructions),
      claimed_at = COALESCE(EXCLUDED.claimed_at, instances.claimed_at)
  `;
}

export async function findById(id: string) {
  const result = await sql`SELECT * FROM instances WHERE id = ${id}`;
  return result.rows[0] || null;
}

export async function listAll() {
  const result = await sql`SELECT * FROM instances ORDER BY created_at`;
  return result.rows;
}

export async function getByStatus(statuses: string | string[]) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  const result = await sql`SELECT * FROM instances WHERE status = ANY(${list}) ORDER BY created_at`;
  return result.rows;
}

export async function getCounts() {
  const result = await sql`SELECT status, COUNT(*)::int AS count FROM instances GROUP BY status`;
  const counts: Record<string, number> = { starting: 0, idle: 0, claimed: 0, crashed: 0, claiming: 0 };
  for (const row of result.rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

export async function claimIdle() {
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
    return result.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function completeClaim(instanceId: string, { agentName, conversationId, inviteUrl, instructions }: { agentName: string; conversationId?: string | null; inviteUrl?: string | null; instructions?: string | null }) {
  await sql`
    UPDATE instances SET
      status = 'claimed',
      agent_name = ${agentName},
      conversation_id = ${conversationId || null},
      invite_url = ${inviteUrl || null},
      instructions = ${instructions || null},
      claimed_at = NOW()
    WHERE id = ${instanceId}
  `;
}

export async function releaseClaim(instanceId: string) {
  await sql`UPDATE instances SET status = 'idle' WHERE id = ${instanceId} AND status = 'claiming'`;
}

export async function updateStatus(instanceId: string, { status, url }: { status?: string | null; url?: string | null }) {
  await sql`
    UPDATE instances SET
      status = COALESCE(${status || null}, instances.status),
      url = COALESCE(${url || null}, instances.url)
    WHERE id = ${instanceId}
  `;
}

export async function deleteById(id: string) {
  await sql`DELETE FROM instances WHERE id = ${id}`;
}

export async function deleteOrphaned(activeInstanceIds: string[]) {
  if (!activeInstanceIds || activeInstanceIds.length === 0) return;
  const result = await sql`
    DELETE FROM instances
    WHERE id != ALL(${activeInstanceIds})
      AND status NOT IN ('starting', 'claiming')
  `;
  const count = result.rowCount || 0;
  if (count > 0) console.log(`[db] Cleaned ${count} orphaned instance row(s)`);
}
