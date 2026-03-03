import { config } from "../../config";

const COMPOSIO_API = "https://backend.composio.dev/api/v3";

function headers(): Record<string, string> {
  return {
    "x-api-key": config.composioApiKey,
    "Content-Type": "application/json",
  };
}

/**
 * Link an AgentMail API key to a Composio entity (one per instance).
 * Creates a connected account so Composio can proxy AgentMail calls via MCP.
 */
export async function linkAgentMail(entityId: string, apiKey: string): Promise<string> {
  return linkApiKey(entityId, config.composioAgentmailAuthConfigId, { api_key: apiKey }, "agentmail");
}

/**
 * Link a Telnyx API key to a Composio entity (one per instance).
 * Creates a connected account so Composio can proxy Telnyx calls via MCP.
 */
export async function linkTelnyx(entityId: string, apiKey: string): Promise<string> {
  return linkApiKey(entityId, config.composioTelnyxAuthConfigId, { api_key: apiKey }, "telnyx");
}

/**
 * Create a connected account with API_KEY auth scheme.
 * Returns the connected account ID.
 */
async function linkApiKey(
  entityId: string,
  authConfigId: string,
  credentials: Record<string, string>,
  label: string,
): Promise<string> {
  if (!config.composioApiKey) throw new Error("COMPOSIO_API_KEY not set");
  if (!authConfigId) throw new Error(`Composio auth config ID not set for ${label}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${COMPOSIO_API}/connected_accounts`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        auth_config: { auth_config_id: authConfigId },
        connection: {
          auth_scheme: "API_KEY",
          credentials,
          entity_id: entityId,
        },
      }),
    });

    if (res.ok) {
      const body = await res.json() as any;
      const connId = body?.id;
      console.log(`[composio] Linked ${label} for entity ${entityId} → ${connId}`);
      return connId;
    }

    const isRetryable = res.status >= 500 || res.status === 429;
    if (isRetryable && attempt < 3) {
      console.warn(`[composio] Link ${label} attempt ${attempt}/3 failed (${res.status}), retrying...`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }

    const body = await res.text();
    console.error(`[composio] Link ${label} failed: ${res.status}`, body);
    throw new Error(`Composio link ${label} failed: ${res.status}`);
  }

  throw new Error(`Composio link ${label} failed: max retries exceeded`);
}

export interface McpSession {
  url: string;
  headers: Record<string, string>;
}

/**
 * Create an MCP server instance for a specific entity.
 * Returns the MCP URL and auth headers the runtime uses to connect.
 */
export async function getMcpSession(entityId: string): Promise<McpSession> {
  if (!config.composioApiKey) throw new Error("COMPOSIO_API_KEY not set");
  if (!config.composioMcpServerId) throw new Error("COMPOSIO_MCP_SERVER_ID not set");

  const serverId = config.composioMcpServerId;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${COMPOSIO_API}/mcp/servers/${serverId}/instances`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user_id: entityId }),
    });

    if (res.ok || res.status === 409) {
      // 409 = instance already exists, that's fine — reuse it
      const mcpUrl = `https://mcp.composio.dev/${serverId}/${entityId}`;
      const mcpHeaders = { "x-api-key": config.composioApiKey };
      console.log(`[composio] MCP session for ${entityId}: ${mcpUrl}`);
      return { url: mcpUrl, headers: mcpHeaders };
    }

    const isRetryable = res.status >= 500 || res.status === 429;
    if (isRetryable && attempt < 3) {
      console.warn(`[composio] MCP instance attempt ${attempt}/3 failed (${res.status}), retrying...`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      continue;
    }

    const body = await res.text();
    console.error(`[composio] MCP instance creation failed: ${res.status}`, body);
    throw new Error(`Composio MCP instance creation failed: ${res.status}`);
  }

  throw new Error("Composio MCP instance creation failed: max retries exceeded");
}
