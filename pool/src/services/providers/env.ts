import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_URL: config.poolUrl,
    // API keys (email, SMS, bankr): proxied through pool manager via /api/proxy/* endpoints.
    // BANKR_API_URL and BANKR_API_KEY are set in infra.ts with instance credentials.
  };
}
