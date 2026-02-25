import { sql, pool as pgPool } from "./connection.js";

// Upsert an instance row (keyed by id).
export async function upsertInstance({ id, name, url, status, agentName, conversationId, inviteUrl, instructions, createdAt, claimedAt }) {
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

// Find instance by instance ID.
export async function findById(id) {
  const result = await sql`SELECT * FROM instances WHERE id = ${id}`;
  return result.rows[0] || null;
}

// List all instance rows ordered by creation time.
export async function listAll() {
  const result = await sql`SELECT * FROM instances ORDER BY created_at`;
  return result.rows;
}

// Get instances matching one or more statuses.
export async function getByStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  const result = await sql`SELECT * FROM instances WHERE status = ANY(${list}) ORDER BY created_at`;
  return result.rows;
}

// Get counts grouped by status.
export async function getCounts() {
  const result = await sql`SELECT status, COUNT(*)::int AS count FROM instances GROUP BY status`;
  const counts = { starting: 0, idle: 0, claimed: 0, crashed: 0, claiming: 0 };
  for (const row of result.rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

// Atomically claim the oldest idle instance. Returns the row or null.
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

// Complete a claim — set status to 'claimed' and fill in metadata fields.
export async function completeClaim(instanceId, { agentName, conversationId, inviteUrl, instructions }) {
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

// Release a claim (on provision failure) — reset to idle.
export async function releaseClaim(instanceId) {
  await sql`UPDATE instances SET status = 'idle' WHERE id = ${instanceId} AND status = 'claiming'`;
}

// Update status and optional fields for an instance.
export async function updateStatus(instanceId, { status, url }) {
  await sql`
    UPDATE instances SET
      status = COALESCE(${status || null}, instances.status),
      url = COALESCE(${url || null}, instances.url)
    WHERE id = ${instanceId}
  `;
}

// Delete instance by instance ID.
export async function deleteById(id) {
  await sql`DELETE FROM instances WHERE id = ${id}`;
}

// Delete orphaned instances not in the active set (skip starting/claiming to avoid race).
export async function deleteOrphaned(activeInstanceIds) {
  if (!activeInstanceIds || activeInstanceIds.length === 0) return;
  const result = await sql`
    DELETE FROM instances
    WHERE id != ALL(${activeInstanceIds})
      AND status NOT IN ('starting', 'claiming')
  `;
  const count = result.rowCount || 0;
  if (count > 0) console.log(`[db] Cleaned ${count} orphaned instance row(s)`);
}
