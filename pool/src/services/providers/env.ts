import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_URL: config.poolUrl,
    // API keys (email, SMS): proxied through pool manager via /api/proxy/* endpoints.
    // Bankr key is still passed through directly.
    BANKR_API_KEY: config.bankrApiKey,
  };
}
