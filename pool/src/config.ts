export function getEnv(name: string, fallback = ""): string {
  const val = process.env[name];
  return val != null && val !== "" ? val : fallback;
}

export const config = {
  port: parseInt(getEnv("PORT", "3001"), 10),
  poolApiKey: getEnv("POOL_API_KEY"),

  // Database — single unified DB
  databaseUrl: getEnv("DATABASE_URL"),

  // Pool behavior
  tickIntervalMs: parseInt(getEnv("TICK_INTERVAL_MS", "30000"), 10),
  stuckTimeoutMs: parseInt(getEnv("POOL_STUCK_TIMEOUT_MS", String(15 * 60 * 1000)), 10),

  // Pool environment context
  poolEnvironment:
    getEnv("POOL_ENVIRONMENT") || getEnv("RAILWAY_ENVIRONMENT_NAME", "undefined"),
  deployBranch: getEnv("RAILWAY_SOURCE_BRANCH") || getEnv("RAILWAY_GIT_BRANCH", "unknown"),
  instanceModel: getEnv("OPENCLAW_PRIMARY_MODEL", "unknown"),
  railwayServiceId: getEnv("RAILWAY_SERVICE_ID"),
  railwayEnvironmentName: getEnv("RAILWAY_ENVIRONMENT_NAME"),

  // Template site
  templateSiteUrl: getEnv("TEMPLATE_SITE_URL", "https://assistants.convos.org"),
  templateSiteOrigins: getEnv("TEMPLATE_SITE_ORIGINS", "http://localhost:3000"),

  // Notion
  notionApiKey: getEnv("NOTION_API_KEY"),

  // Admin dashboard
  poolAdminUrls: getEnv("POOL_ADMIN_URLS", "vibe=https://convos-agents-vibe.up.railway.app,dev=https://convos-agents-dev.up.railway.app,scaling=https://convos-agents-scaling.up.railway.app,staging=https://convos-agents-staging.up.railway.app,production=https://convos-agents-production.up.railway.app"),

  // Railway (from services)
  railwayApiToken: getEnv("RAILWAY_API_TOKEN"),
  railwayTeamId: getEnv("RAILWAY_TEAM_ID"),
  railwayRuntimeImage: getEnv("RAILWAY_RUNTIME_IMAGE") || (() => {
    const env = getEnv("POOL_ENVIRONMENT") || getEnv("RAILWAY_ENVIRONMENT_NAME", "");
    const tag = env === "production" ? "latest" : env;
    return `ghcr.io/xmtplabs/convos-runtime:${tag}`;
  })(),

  // OpenRouter (from services)
  openrouterManagementKey: getEnv("OPENROUTER_MANAGEMENT_KEY"),
  openrouterKeyLimit: parseInt(getEnv("OPENROUTER_KEY_LIMIT", "20"), 10),
  openrouterKeyLimitReset: getEnv("OPENROUTER_KEY_LIMIT_RESET", "monthly"),

  // AgentMail (from services)
  agentmailApiKey: getEnv("AGENTMAIL_API_KEY"),
  agentmailDomain: getEnv("AGENTMAIL_DOMAIN"),

  // Telnyx (from services)
  telnyxApiKey: getEnv("TELNYX_API_KEY"),
  telnyxMessagingProfileId: getEnv("TELNYX_MESSAGING_PROFILE_ID"),

  // Instance passthrough env vars
  openclawPrimaryModel: getEnv("OPENCLAW_PRIMARY_MODEL"),
  xmtpEnv: getEnv("XMTP_ENV", "dev"),
  bankrApiKey: getEnv("BANKR_API_KEY"),
  telnyxPhoneNumber: getEnv("TELNYX_PHONE_NUMBER"),
};
