export function getEnv(name: string, fallback = ""): string {
  const val = process.env[name];
  return val != null && val !== "" ? val : fallback;
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Required env var ${name} not set`);
  return val;
}

export const config = {
  port: parseInt(getEnv("PORT", "3002"), 10),
  servicesApiKey: getEnv("SERVICES_API_KEY"),

  // Database
  databaseUrl: getEnv("DATABASE_URL"),
  poolDatabaseUrl: getEnv("POOL_DATABASE_URL"),

  // Railway
  railwayApiToken: getEnv("RAILWAY_API_TOKEN"),
  railwayProjectId: getEnv("RAILWAY_PROJECT_ID"),
  railwayEnvironmentId: getEnv("RAILWAY_ENVIRONMENT_ID"),
  railwayEnvironmentName: getEnv("RAILWAY_ENVIRONMENT_NAME"),
  railwayRuntimeImage: getEnv("RAILWAY_RUNTIME_IMAGE", "ghcr.io/xmtplabs/convos-runtime:latest"),

  // OpenRouter
  openrouterManagementKey: getEnv("OPENROUTER_MANAGEMENT_KEY"),
  openrouterKeyLimit: parseInt(getEnv("OPENROUTER_KEY_LIMIT", "20"), 10),
  openrouterKeyLimitReset: getEnv("OPENROUTER_KEY_LIMIT_RESET", "monthly"),

  // AgentMail
  agentmailApiKey: getEnv("AGENTMAIL_API_KEY"),
  agentmailDomain: getEnv("AGENTMAIL_DOMAIN"),

  // Telnyx
  telnyxApiKey: getEnv("TELNYX_API_KEY"),
  telnyxMessagingProfileId: getEnv("TELNYX_MESSAGING_PROFILE_ID"),

  // Instance env vars (passed through to runtime)
  openclawPrimaryModel: getEnv("OPENCLAW_PRIMARY_MODEL"),
  xmtpEnv: getEnv("XMTP_ENV", "dev"),
  poolApiKey: getEnv("POOL_API_KEY"),
  bankrApiKey: getEnv("BANKR_API_KEY"),
  telnyxPhoneNumber: getEnv("TELNYX_PHONE_NUMBER"),
};
