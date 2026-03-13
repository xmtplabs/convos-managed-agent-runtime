import { config } from "../../config";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    XMTP_ENV: config.xmtpEnv,
    CONVOS_API_KEY: config.convosApiKey,
  };
}
