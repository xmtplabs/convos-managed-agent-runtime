# Template site

Next.js app for browsing and launching Convos agents. Deployed to Vercel at `assistants.convos.org`.

## Setup

```bash
cd dashboard
cp .env.example .env.local
pnpm install
pnpm dev
```

Requires a running pool manager at the URL specified in `POOL_API_URL` (defaults to `http://localhost:3001`).

## Environment variables

| Variable | Description |
|----------|-------------|
| `POOL_API_URL` | Pool manager URL (server-side, e.g. `http://localhost:3001`) |
| `NEXT_PUBLIC_POOL_API_URL` | Pool manager URL (client-side) |
| `NEXT_PUBLIC_POOL_ENVIRONMENT` | Environment name shown in UI (`staging` or `production`) |
| `POOL_ENVIRONMENT` | Server-side environment guard for admin routes (defaults to `production` = fail closed) |
| `POOL_API_KEY` | API key for authenticated pool endpoints |

## Routes

| Path | Description |
|------|-------------|
| `/` | Homepage — agent catalog grid with category filters |
| `/a/[slug]` | Template detail page — description, skills, launch/join flow |
| `/og/[slug]` | OG image generation for template pages |
| `/qr/[slug]` | QR code PNG generation for template pages |

## API routes

Proxy routes that forward to the pool manager:

| Path | Proxies to |
|------|-----------|
| `/api/claim` | `POST /api/pool/claim` |
| `/api/pool/counts` | `GET /api/pool/counts` |
| `/api/pool/info` | `GET /api/pool/info` |
| `/api/pool/templates` | `GET /api/pool/templates` |
| `/api/prompts/[pageId]` | `GET /api/prompts/:pageId` |

## Testing

```bash
pnpm test:parity    # Playwright visual regression tests
```

Tests use a mock pool server (see `tests/mock-pool.ts`) and compare screenshots against baseline snapshots in `tests/parity.spec.ts-snapshots/`.

## Deployment

Deployed to Vercel via `vercel.json`. Build command: `pnpm build`.
