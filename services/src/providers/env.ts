import { config } from "../config.js";

/** Build the base env var map for new runtime instances. */
export function buildInstanceEnv(): Record<string, string> {
  return {
    OPENCLAW_STATE_DIR: "/app",
    OPENCLAW_PRIMARY_MODEL: config.openclawPrimaryModel,
    XMTP_ENV: config.xmtpEnv,
    CHROMIUM_PATH: "/usr/bin/chromium",
    POOL_API_KEY: config.poolApiKey,
    AGENTMAIL_API_KEY: config.agentmailApiKey,
    BANKR_API_KEY: config.bankrApiKey,
    TELNYX_API_KEY: config.telnyxApiKey,
    TELNYX_PHONE_NUMBER: config.telnyxPhoneNumber,
    TELNYX_MESSAGING_PROFILE_ID: config.telnyxMessagingProfileId,
  };
}
