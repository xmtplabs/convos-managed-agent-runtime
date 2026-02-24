import { sql, pool as pgPool } from "./connection.js";

// Upsert an instance row (keyed by service_id).
export async function upsertInstance({ id, serviceId, name, url, status, deployStatus, agentName, conversationId, inviteUrl, instructions, createdAt, claimedAt, sourceBranch, openrouterKeyHash, agentmailInboxId, gatewayToken }) {
  await sql`
    INSERT INTO instances (id, service_id, name, url, status, deploy_status, agent_name, conversation_id, invite_url, instructions, created_at, claimed_at, source_branch, openrouter_key_hash, agentmail_inbox_id, gateway_token)
    VALUES (${id}, ${serviceId}, ${name}, ${url || null}, ${status}, ${deployStatus || null}, ${agentName || null}, ${conversationId || null}, ${inviteUrl || null}, ${instructions || null}, ${createdAt || new Date().toISOString()}, ${claimedAt || null}, ${sourceBranch || null}, ${openrouterKeyHash || null}, ${agentmailInboxId || null}, ${gatewayToken || null})
    ON CONFLICT (service_id) DO UPDATE SET
      name = EXCLUDED.name,
      url = COALESCE(EXCLUDED.url, instances.url),
      status = EXCLUDED.status,
      deploy_status = EXCLUDED.deploy_status,
      agent_name = COALESCE(EXCLUDED.agent_name, instances.agent_name),
      conversation_id = COALESCE(EXCLUDED.conversation_id, instances.conversation_id),
      invite_url = COALESCE(EXCLUDED.invite_url, instances.invite_url),
      instructions = COALESCE(EXCLUDED.instructions, instances.instructions),
      claimed_at = COALESCE(EXCLUDED.claimed_at, instances.claimed_at),
      source_branch = COALESCE(EXCLUDED.source_branch, instances.source_branch),
      openrouter_key_hash = COALESCE(EXCLUDED.openrouter_key_hash, instances.openrouter_key_hash),
      agentmail_inbox_id = COALESCE(EXCLUDED.agentmail_inbox_id, instances.agentmail_inbox_id),
      gateway_token = COALESCE(EXCLUDED.gateway_token, instances.gateway_token)
  `;
}

// Find instance by Railway service ID.
export async function findByServiceId(serviceId) {
  const result = await sql`SELECT * FROM instances WHERE service_id = ${serviceId}`;
  return result.rows[0] || null;
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
      WHERE service_id = (
        SELECT service_id FROM instances
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
export async function completeClaim(serviceId, { agentName, conversationId, inviteUrl, instructions, sourceBranch }) {
  await sql`
    UPDATE instances SET
      status = 'claimed',
      agent_name = ${agentName},
      conversation_id = ${conversationId || null},
      invite_url = ${inviteUrl || null},
      instructions = ${instructions || null},
      claimed_at = NOW(),
      source_branch = ${sourceBranch || null}
    WHERE service_id = ${serviceId}
  `;
}

// Release a claim (on provision failure) — reset to idle.
export async function releaseClaim(serviceId) {
  await sql`UPDATE instances SET status = 'idle' WHERE service_id = ${serviceId} AND status = 'claiming'`;
}

// Update status and optional fields for a service.
export async function updateStatus(serviceId, { status, deployStatus, url }) {
  await sql`
    UPDATE instances SET
      status = COALESCE(${status || null}, instances.status),
      deploy_status = COALESCE(${deployStatus || null}, instances.deploy_status),
      url = COALESCE(${url || null}, instances.url)
    WHERE service_id = ${serviceId}
  `;
}

// Delete instance by Railway service ID.
export async function deleteByServiceId(serviceId) {
  await sql`DELETE FROM instances WHERE service_id = ${serviceId}`;
}

// Delete instance by instance ID.
export async function deleteById(id) {
  await sql`DELETE FROM instances WHERE id = ${id}`;
}

// Delete orphaned instances not in the active set (skip starting/claiming to avoid race).
export async function deleteOrphaned(activeServiceIds) {
  if (!activeServiceIds || activeServiceIds.length === 0) return;
  const result = await sql`
    DELETE FROM instances
    WHERE service_id != ALL(${activeServiceIds})
      AND status NOT IN ('starting', 'claiming')
  `;
  const count = result.rowCount || 0;
  if (count > 0) console.log(`[db] Cleaned ${count} orphaned instance row(s)`);
}
