# Runtime

Two agent runtimes — **OpenClaw** (Node.js) and **Hermes** (Python) — sharing agent instructions, skills, evals, and versioning from this root.

**Images:** `ghcr.io/xmtplabs/convos-runtime` (OpenClaw) · `ghcr.io/xmtplabs/convos-runtime-hermes` (Hermes)

## Structure

```
runtime/
├── package.json          # shared version + scripts
├── CHANGELOG.md          # shared changelog
├── .env                  # local dev env vars
├── evals/                # shared eval suite
├── convos-platform/      # shared agent instructions, skills, web-tools
│   ├── AGENTS.md         # section manifest (assembled at boot)
│   ├── SOUL.md           # personality
│   ├── context/          # shared + runtime-specific context files
│   ├── skills/           # shared skills
│   └── web-tools/        # browser automation, forms, landing page
├── lib/                  # shared boot helpers
├── openclaw/             # OpenClaw runtime (Dockerfile, extensions, scripts)
└── hermes/               # Hermes runtime (Dockerfile, FastAPI server, scripts)
```

## Boot sequence

Both runtimes follow the same fixed pipeline:

`init.sh` → `keys.sh` → `apply-config.sh` → `install-deps.sh` → `identity.sh` → `start.sh`

`apply-config.sh` assembles `AGENTS.md` from `convos-platform/` context files via `<!-- SECTION:NAME -->` markers, copies skills, and syncs workspace files.

## Scripts

| Script | Run from | Description |
|--------|----------|-------------|
| `pnpm start` | `runtime/openclaw/` | Start OpenClaw (full boot pipeline) |
| `pnpm start` | `runtime/hermes/` | Start Hermes (local dev) |
| `pnpm docker:build:openclaw` | `runtime/` | Build OpenClaw Docker image locally |
| `pnpm docker:run:openclaw` | `runtime/` | Run OpenClaw Docker image with `.env` |
| `pnpm docker:build:hermes` | `runtime/` | Build Hermes Docker image locally |
| `pnpm docker:run:hermes` | `runtime/` | Run Hermes Docker image with `.env` |
| `pnpm evals openclaw [suite]` | `runtime/` | Run evals against OpenClaw |
| `pnpm evals hermes [suite]` | `runtime/` | Run evals against Hermes |

## Local development

```sh
# OpenClaw
cd runtime/openclaw && pnpm install && pnpm start
# → http://localhost:18789

# Hermes
cd runtime/hermes && pnpm install && pnpm start
```

Set your keys in `runtime/.env` (shared by both runtimes). See `.env.example` for the full list.

**Docker note:** values in `.env` must be unquoted — Docker `--env-file` passes quotes literally.

## CI

Images built by GitHub Actions. PRs get `:pending-<sha>` tags; merges get branch tags (`:dev`, `:staging`, `:production`). Railway environments pull by branch tag.

## Pool integration

When deployed by the pool manager, the runtime exposes `/pool/health`, `/pool/provision`, `/pool/status`, and `/pool/self-destruct` via `pool-server.js`. The pool manager creates Railway services with the GHCR image, injects env vars, and provisions at claim time.
