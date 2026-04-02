import { eq, and, sql, notInArray, inArray, getTableColumns } from "drizzle-orm";
import { db } from "./connection";
import { instances, instanceInfra, instanceServices } from "./schema";
import type { InstanceRow, InstanceStatus } from "./schema";
import { config } from "../config";

/** InstanceRow + url resolved from instance_infra. */
export type InstanceView = InstanceRow & { url: string | null };

interface UpsertInstanceOpts {
  id: string;
  name: string;
  status: InstanceStatus;
  agentName?: string | null;
  conversationId?: string | null;
  inviteUrl?: string | null;
  instructions?: string | null;
  createdAt?: string | null;
  claimedAt?: string | null;
}

export async function upsertInstance({ id, name, status, agentName, conversationId, inviteUrl, instructions, createdAt, claimedAt }: UpsertInstanceOpts) {
  await db.insert(instances).values({
    id,
    name,
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
      status: sql`EXCLUDED.status`,
      agentName: sql`COALESCE(EXCLUDED.agent_name, ${instances.agentName})`,
      conversationId: sql`COALESCE(EXCLUDED.conversation_id, ${instances.conversationId})`,
      inviteUrl: sql`COALESCE(EXCLUDED.invite_url, ${instances.inviteUrl})`,
      instructions: sql`COALESCE(EXCLUDED.instructions, ${instances.instructions})`,
      claimedAt: sql`COALESCE(EXCLUDED.claimed_at, ${instances.claimedAt})`,
    },
  });
}

const instanceWithUrl = { ...getTableColumns(instances), url: instanceInfra.url };

export async function findById(id: string): Promise<InstanceView | null> {
  const rows = await db.select(instanceWithUrl).from(instances)
    .leftJoin(instanceInfra, eq(instances.id, instanceInfra.instanceId))
    .where(eq(instances.id, id));
  return rows[0] ?? null;
}

export async function listAll(): Promise<InstanceView[]> {
  return db.select(instanceWithUrl).from(instances)
    .leftJoin(instanceInfra, eq(instances.id, instanceInfra.instanceId))
    .orderBy(instances.createdAt);
}

export async function getByStatus(statuses: InstanceStatus | InstanceStatus[]): Promise<InstanceView[]> {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  return db.select(instanceWithUrl).from(instances)
    .leftJoin(instanceInfra, eq(instances.id, instanceInfra.instanceId))
    .where(inArray(instances.status, list)).orderBy(instances.createdAt);
}

export async function getCounts(): Promise<Record<InstanceStatus, number>> {
  const rows = await db.select({
    status: instances.status,
    count: sql<number>`count(*)::int`,
  }).from(instances).groupBy(instances.status);

  const counts = {
    starting: 0, idle: 0, claimed: 0, pending_acceptance: 0, tainted: 0,
    crashed: 0, claiming: 0, dead: 0, sleeping: 0,
  } as Record<InstanceStatus, number>;
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

/** Atomically claim one idle instance using FOR UPDATE SKIP LOCKED.
 *  When inviteUrl is provided, aborts if another instance is already
 *  claiming/claimed for that URL (dedup within the same transaction). */
export async function claimIdle(inviteUrl?: string | null): Promise<InstanceView | null> {
  return db.transaction(async (tx) => {
    // Dedup: if an instance is already handling this inviteUrl, don't claim another
    if (inviteUrl) {
      const dup = await tx.execute(sql`
        SELECT 1 FROM instances
        WHERE invite_url = ${inviteUrl}
          AND status IN ('claiming', 'claimed', 'pending_acceptance')
        LIMIT 1
      `);
      if (dup.rows.length > 0) return null;
    }

    const protected_ = config.protectedInstances;
    const excludeClause = protected_.length > 0
      ? sql`AND id NOT IN (${sql.join(protected_.map((id) => sql`${id}`), sql`, `)})`
      : sql``;

    const result = await tx.execute(sql`
      UPDATE instances SET status = 'claiming',
        invite_url = COALESCE(${inviteUrl ?? null}, invite_url)
      WHERE id = (
        SELECT id FROM instances
        WHERE status = 'idle'
        ${excludeClause}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id, name, status,
        agent_name    AS "agentName",
        conversation_id AS "conversationId",
        invite_url    AS "inviteUrl",
        instructions,
        created_at    AS "createdAt",
        claimed_at    AS "claimedAt",
        (SELECT url FROM instance_infra WHERE instance_id = instances.id) AS url
    `);
    const row = result.rows[0];
    return (row as InstanceView) ?? null;
  });
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

export async function markClaimPendingAcceptance(
  instanceId: string,
  { agentName, inviteUrl, instructions }: { agentName: string; inviteUrl?: string | null; instructions?: string | null },
): Promise<boolean> {
  const result = await db.update(instances).set({
    status: "pending_acceptance", agentName,
    inviteUrl: inviteUrl || null, instructions: instructions || null,
    claimedAt: sql`NOW()`,
  }).where(and(eq(instances.id, instanceId), eq(instances.status, "claiming")));
  return (result.rowCount ?? 0) > 0;
}

export async function completePendingAcceptance(instanceId: string, conversationId: string): Promise<boolean> {
  const result = await db.update(instances).set({
    status: "claimed", conversationId,
    claimedAt: sql`COALESCE(${instances.claimedAt}, NOW())`,
  }).where(and(eq(instances.id, instanceId), eq(instances.status, "pending_acceptance")));
  return (result.rowCount ?? 0) > 0;
}

export async function failPendingAcceptance(instanceId: string, status: InstanceStatus = "tainted"): Promise<boolean> {
  const result = await db.update(instances).set({ status })
    .where(and(eq(instances.id, instanceId), eq(instances.status, "pending_acceptance")));
  return (result.rowCount ?? 0) > 0;
}

const IDLE_RECOVERY_FIELDS = {
  status: "idle" as InstanceStatus, agentName: null, conversationId: null,
  inviteUrl: null, instructions: null, claimedAt: null,
};

export async function recoverClaimToIdle(instanceId: string): Promise<boolean> {
  const result = await db.update(instances).set(IDLE_RECOVERY_FIELDS)
    .where(and(eq(instances.id, instanceId), eq(instances.status, "claiming")));
  return (result.rowCount ?? 0) > 0;
}

export async function failClaim(instanceId: string, status: InstanceStatus = "crashed"): Promise<boolean> {
  const result = await db.update(instances).set({ status })
    .where(and(eq(instances.id, instanceId), eq(instances.status, "claiming")));
  return (result.rowCount ?? 0) > 0;
}

export async function updateStatus(instanceId: string, { status }: { status?: string | null }) {
  await db.update(instances).set({
    status: sql`COALESCE(${status || null}, ${instances.status})`,
  }).where(eq(instances.id, instanceId));
}

/**
 * Atomically recover an instance to idle, clearing all claim metadata.
 * Uses conditional update to avoid overwriting concurrent claims.
 */
export async function recoverToIdle(
  instanceId: string,
  expectedStatus?: string,
): Promise<boolean> {
  const conditions = [eq(instances.id, instanceId), sql`${instances.status} != 'claiming'`];
  if (expectedStatus) {
    conditions.push(sql`${instances.status} = ${expectedStatus}`);
  }
  const result = await db.update(instances).set(IDLE_RECOVERY_FIELDS).where(and(...conditions));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Conditionally update status only if the current status matches `expectedStatus`
 * and is not 'claiming' (atomic claim in progress). Returns true if the row was updated.
 */
export async function conditionalUpdateStatus(
  instanceId: string,
  newStatus: string,
  expectedStatus?: string,
): Promise<boolean> {
  const conditions = [eq(instances.id, instanceId), sql`${instances.status} != 'claiming'`];
  if (expectedStatus) {
    conditions.push(sql`${instances.status} = ${expectedStatus}`);
  }
  const result = await db.update(instances).set({
    status: sql`${newStatus}`,
  }).where(and(...conditions));
  return (result.rowCount ?? 0) > 0;
}

/** Look up an instance by its Railway service ID (from instance_infra). */
export async function findByServiceId(serviceId: string): Promise<{ instanceId: string; providerEnvId: string; url: string | null } | null> {
  const rows = await db.select({
    instanceId: instanceInfra.instanceId,
    providerEnvId: instanceInfra.providerEnvId,
    url: instanceInfra.url,
  }).from(instanceInfra).where(eq(instanceInfra.providerServiceId, serviceId));
  return rows[0] ?? null;
}

/** Update the deploy_status column in instance_infra. */
export async function updateDeployStatus(instanceId: string, deployStatus: string) {
  await db.update(instanceInfra).set({
    deployStatus,
    updatedAt: sql`NOW()`,
  }).where(eq(instanceInfra.instanceId, instanceId));
}

/** Verify an instance ID + gateway token pair. Used by self-destruct auth. */
export async function findInstanceByToken(instanceId: string, gatewayToken: string): Promise<boolean> {
  const rows = await db.select({ id: instanceInfra.instanceId })
    .from(instanceInfra)
    .where(and(eq(instanceInfra.instanceId, instanceId), eq(instanceInfra.gatewayToken, gatewayToken)));
  return rows.length > 0;
}

/** Look up the gateway token for an instance. */
export async function getGatewayToken(instanceId: string): Promise<string | null> {
  const rows = await db.select({ gatewayToken: instanceInfra.gatewayToken })
    .from(instanceInfra)
    .where(eq(instanceInfra.instanceId, instanceId));
  return rows[0]?.gatewayToken ?? null;
}

export async function getRuntimeInfo(instanceId: string): Promise<{ version: string | null; type: string | null }> {
  const rows = await db.select({
    version: instanceInfra.runtimeVersion,
    type: instanceInfra.runtimeType,
  }).from(instanceInfra).where(eq(instanceInfra.instanceId, instanceId));
  return rows[0] ?? { version: null, type: null };
}

export async function setRuntimeVersion(instanceId: string, version: string, runtimeType?: string) {
  const updates: Record<string, unknown> = {
    runtimeVersion: version,
    updatedAt: sql`NOW()`,
  };
  if (runtimeType) updates.runtimeType = runtimeType;
  await db.update(instanceInfra).set(updates).where(eq(instanceInfra.instanceId, instanceId));
}

export async function deleteById(id: string) {
  await db.delete(instances).where(eq(instances.id, id));
}

/** Look up an instance's provisioned service resources (inbox, phone). */
export async function getServiceResources(instanceId: string): Promise<{ inboxId: string | null; phoneNumber: string | null }> {
  const rows = await db.select({
    toolId: instanceServices.toolId,
    envValue: instanceServices.envValue,
  }).from(instanceServices).where(eq(instanceServices.instanceId, instanceId));

  let inboxId: string | null = null;
  let phoneNumber: string | null = null;
  for (const row of rows) {
    if (row.toolId === "agentmail") inboxId = row.envValue;
    if (row.toolId === "telnyx") phoneNumber = row.envValue;
  }
  return { inboxId, phoneNumber };
}

/** Reverse lookup: find the instance that owns a given phone number. */
export async function findInstanceByPhone(
  phoneNumber: string,
): Promise<{ instanceId: string; url: string | null; gatewayToken: string | null } | null> {
  const rows = await db
    .select({
      instanceId: instanceServices.instanceId,
      url: instanceInfra.url,
      gatewayToken: instanceInfra.gatewayToken,
    })
    .from(instanceServices)
    .innerJoin(instanceInfra, eq(instanceServices.instanceId, instanceInfra.instanceId))
    .where(and(eq(instanceServices.toolId, "telnyx"), eq(instanceServices.resourceId, phoneNumber)))
    .limit(1);
  return rows[0] ?? null;
}

/** Reverse lookup: find the instance that owns a given AgentMail inbox. */
export async function findInstanceByInboxId(
  inboxId: string,
): Promise<{ instanceId: string; url: string | null; gatewayToken: string | null } | null> {
  const rows = await db
    .select({
      instanceId: instanceServices.instanceId,
      url: instanceInfra.url,
      gatewayToken: instanceInfra.gatewayToken,
    })
    .from(instanceServices)
    .innerJoin(instanceInfra, eq(instanceServices.instanceId, instanceInfra.instanceId))
    .where(and(eq(instanceServices.toolId, "agentmail"), eq(instanceServices.resourceId, inboxId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Check if an instance is already claiming/claimed for a given invite URL. */
export async function hasActiveInviteUrl(inviteUrl: string): Promise<boolean> {
  const rows = await db.select({ id: instances.id }).from(instances).where(
    and(eq(instances.inviteUrl, inviteUrl), inArray(instances.status, ["claiming", "claimed", "pending_acceptance"])),
  ).limit(1);
  return rows.length > 0;
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
