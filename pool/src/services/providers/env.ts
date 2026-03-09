import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_URL: config.poolUrl,
    // POOL_ENVIRONMENT: derived from RAILWAY_ENVIRONMENT_NAME (auto-set by Railway)
    // API keys: proxied through pool manager via /api/proxy/* endpoints
  };
}
