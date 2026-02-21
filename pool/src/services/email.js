import { resolveAgentMailInbox, deleteAgentMailInbox } from "../keys.js";

export async function resolve(instanceId) {
  const { inboxId, perInstance } = await resolveAgentMailInbox(instanceId);
  return {
    envVars: { AGENTMAIL_INBOX_ID: inboxId },
    cleanupHandle: perInstance ? { agentMailInboxId: inboxId } : null,
  };
}

export async function cleanup(handle) {
  if (!handle?.agentMailInboxId) return;
  await deleteAgentMailInbox(handle.agentMailInboxId);
}
