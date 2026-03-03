import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_API_KEY: config.poolApiKey,
    POOL_URL: config.poolUrl,
    // AgentMail + Telnyx API keys removed — now proxied via Composio MCP
    BANKR_API_KEY: config.bankrApiKey,
  };
}
