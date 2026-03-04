# web-tools

OpenClaw plugin that serves public-facing web pages and handles credit management for pool-managed instances.

## What it does

1. **Convos landing page** — installable PWA at `/web-tools/convos` with invite link and QR code
2. **Services page** — shows instance identity (email, phone) and credit balance at `/web-tools/services`
3. **Credit error rewriting** — intercepts outgoing messages containing provider credit errors and replaces them with a friendly link to the services page

## Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/web-tools/convos` | GET | Convos landing page (PWA) |
| `/web-tools/convos/manifest.json` | GET | PWA manifest |
| `/web-tools/convos/sw.js` | GET | Service worker |
| `/web-tools/convos/icon.svg` | GET | App icon |
| `/web-tools/services` | GET | Services dashboard (credits, identity) |
| `/web-tools/services/api` | GET | JSON API — instance identity + credit balance |
| `/web-tools/services/topup` | POST | Proxy credit top-up request to pool manager |

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry — route registration, credit error interception, services API |
| `convos/landing.html` | Convos landing page |
| `convos/landing-manifest.json` | PWA manifest |
| `convos/sw.js` | Service worker for offline support |
| `convos/icon.svg` | App icon |
| `services/services.html` | Services dashboard page |

## Credit flow

For pool-managed instances, the services page shows remaining credits and a top-up button:

```
Browser → GET /web-tools/services/api → instance fetches from pool manager → returns credits JSON
Browser → POST /web-tools/services/topup → instance proxies to pool manager → returns top-up result
```

Auth uses `OPENCLAW_GATEWAY_TOKEN` + `INSTANCE_ID` to identify the instance to the pool manager. The `poolApiKey` from config is injected into HTML pages as `window.__POOL_TOKEN` for client-side API calls.

## Environment variables

| Variable | Used for |
|----------|----------|
| `INSTANCE_ID` | Identifies this instance to the pool manager |
| `OPENCLAW_GATEWAY_TOKEN` | Auth token for pool manager API calls |
| `POOL_URL` | Pool manager base URL |
| `AGENTMAIL_INBOX_ID` | Displayed on services page as email identity |
| `TELNYX_PHONE_NUMBER` | Displayed on services page as phone identity |
| `RAILWAY_PUBLIC_DOMAIN` | Used to build the public services URL |
