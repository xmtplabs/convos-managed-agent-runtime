import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    POOL_ENVIRONMENT: config.poolEnvironment,
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_URL: config.poolUrl,
    // API keys (AGENTMAIL_API_KEY, TELNYX_API_KEY, BANKR_API_KEY) are NOT
    // passed to instances. Service calls are proxied through the pool manager
    // via /api/proxy/* endpoints, authenticated with the instance's gateway token.
  };
}
