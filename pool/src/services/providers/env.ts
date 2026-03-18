import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CONVOS_API_KEY: config.convosApiKey,
    POOL_URL: config.poolUrl,
    POSTHOG_API_KEY: config.posthogApiKey,
    POSTHOG_HOST: config.posthogHost,
  };
}
