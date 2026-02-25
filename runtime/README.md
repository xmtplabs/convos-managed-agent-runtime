# Runtime

Agent runtime image — OpenClaw gateway + config, workspace, extensions, and skills.

## Build locally

```bash
cd runtime

# Build the image
pnpm build

# Build and run with .env from repo root
pnpm build:run
```

Health check: `http://localhost:8080/pool/health`

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm start` | Full init: keys → apply → install-deps → gateway |
| `pnpm keys` | Generate gateway token, setup password, wallet key; create/reuse OpenRouter key; write .env |
| `pnpm apply` | Sync workspace/skills/extensions and copy config template to state dir |
| `pnpm install-deps` | Install extension and skill deps in OPENCLAW_STATE_DIR |
| `pnpm gateway` | Start the gateway |
| `pnpm qa` | QA smoke tests (email, sms, bankr, convos, browser) |
| `pnpm pool-server` | Pool-managed container entrypoint (spawns gateway, serves /pool/* API) |
| `pnpm clean-providers` | Delete orphaned AgentMail inboxes / OpenRouter keys |
| `pnpm build` | Build Docker image locally |
| `pnpm build:run` | Build and run with .env from repo root |
