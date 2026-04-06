export function getEnv(name: string, fallback = ""): string {
  const val = process.env[name];
  return val != null && val !== "" ? val : fallback;
}

export const config = {
  port: parseInt(getEnv("PORT", "3001"), 10),
  poolApiKey: getEnv("POOL_API_KEY"),
  // Derive from RAILWAY_PUBLIC_DOMAIN if POOL_URL not explicitly set
  poolUrl: getEnv("POOL_URL") || (() => {
    const domain = getEnv("RAILWAY_PUBLIC_DOMAIN");
    return domain ? `https://${domain}` : "";
  })(),

  // Database — single unified DB
  databaseUrl: getEnv("DATABASE_URL"),

  // Pool behavior
  stuckTimeoutMs: parseInt(getEnv("POOL_STUCK_TIMEOUT_MS", String(15 * 60 * 1000)), 10),

  // Pool environment context
  poolEnvironment:
    getEnv("POOL_ENVIRONMENT") || getEnv("RAILWAY_ENVIRONMENT_NAME", "local"),
  deployBranch: getEnv("RAILWAY_SOURCE_BRANCH") || getEnv("RAILWAY_GIT_BRANCH", "unknown"),
  railwayServiceId: getEnv("RAILWAY_SERVICE_ID"),
  railwayProjectId: getEnv("RAILWAY_PROJECT_ID"),
  railwayEnvironmentId: getEnv("RAILWAY_ENVIRONMENT_ID"),
  railwayEnvironmentName: getEnv("RAILWAY_ENVIRONMENT_NAME"),

  // Template site
  templateSiteUrl: getEnv("TEMPLATE_SITE_URL", "https://convos.org/assistants"),
  templateSiteOrigins: getEnv("TEMPLATE_SITE_ORIGINS", "http://localhost:3000"),

  // Admin dashboard
  poolAdminUrls: getEnv("POOL_ADMIN_URLS", "vibe=https://convos-agents-vibe.up.railway.app,dev=https://convos-agents-dev.up.railway.app,staging=https://convos-agents-staging.up.railway.app,production=https://convos-agents-production.up.railway.app"),

  // Railway (from services)
  railwayApiToken: getEnv("RAILWAY_API_TOKEN"),
  railwayApiTokens: getEnv("RAILWAY_API_TOKENS")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  railwayTeamId: getEnv("RAILWAY_TEAM_ID"),
  railwayRuntimeImage: getEnv("RAILWAY_RUNTIME_IMAGE") || (() => {
    const env = getEnv("POOL_ENVIRONMENT") || getEnv("RAILWAY_ENVIRONMENT_NAME", "");
    return env ? `ghcr.io/xmtplabs/convos-runtime:${env}` : "";
  })(),

  // OpenRouter (from services)
  openrouterManagementKey: getEnv("OPENROUTER_MANAGEMENT_KEY"),
  openrouterKeyLimit: parseInt(getEnv("OPENROUTER_KEY_LIMIT", "20"), 10),
  skillsOpenrouterApiKey: getEnv("SKILLS_OPENROUTER_API_KEY"),

  // Exa (from services)
  exaServiceKey: getEnv("EXA_SERVICE_KEY"),
  exaKeyRateLimit: parseInt(getEnv("EXA_KEY_RATE_LIMIT", "10"), 10),

  // AgentMail (from services)
  agentmailApiKey: getEnv("AGENTMAIL_API_KEY"),
  agentmailDomain: getEnv("AGENTMAIL_DOMAIN"),
  agentmailWebhookSecret: getEnv("AGENTMAIL_WEBHOOK_SECRET"),

  // Telnyx (from services)
  telnyxApiKey: getEnv("TELNYX_API_KEY"),
  telnyxMessagingProfileId: getEnv("TELNYX_MESSAGING_PROFILE_ID"),
  telnyxWebhookPublicKey: getEnv("TELNYX_WEBHOOK_PUBLIC_KEY"),

  // Protected instances — cannot be claimed, killed, or drained
  protectedInstances: getEnv("PROTECTED_INSTANCES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Stripe (sandbox)
  stripeSecretKey: getEnv("STRIPE_SECRET_KEY"),
  stripePublishableKey: getEnv("STRIPE_PUBLISHABLE_KEY"),
  stripeWebhookSecret: getEnv("STRIPE_WEBHOOK_SECRET"),

  // Instance passthrough env vars
  defaultAgentName: getEnv("DEFAULT_AGENT_NAME", "Assistant"),
  xmtpEnv: getEnv("XMTP_ENV", "dev"),
  convosApiKey: getEnv("CONVOS_API_KEY"),

  // Telemetry
  posthogApiKey: getEnv("POSTHOG_API_KEY"),
  posthogHost: getEnv("POSTHOG_HOST", "https://us.i.posthog.com"),

  // Attestation — Ed25519 signing key for agent identity verification
  attestationPrivateKeyPem: getEnv("ATTESTATION_PRIVATE_KEY_PEM").replace(/\\n/g, "\n"),
  attestationKid: getEnv("ATTESTATION_KID", "convos-agents-1"),
};
