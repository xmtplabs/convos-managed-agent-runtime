# web-tools

Public-facing web pages served by both runtimes — landing page, services dashboard, and skills browser.

## Implementations

| Runtime | Entry point |
|---------|-------------|
| OpenClaw | `openclaw/extensions/web-tools/index.ts` (OpenClaw plugin) |
| Hermes | `hermes/src/web_tools.py` (FastAPI router) |

Both implementations serve the same routes from the shared HTML/CSS in this directory.

## What it does

1. **Convos landing page** — installable PWA at `/web-tools/convos` with invite link and QR code
2. **Services page** — shows instance identity (email, phone), credit balance, and coupon redemption at `/web-tools/services`
3. **Skills pages** — index and detail pages for generated skills at `/web-tools/skills`, backed by a JSON API reading from `$WORKSPACE_SKILLS/generated/skills.json`

## Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/web-tools/convos` | GET | Convos landing page (PWA) |
| `/web-tools/convos/manifest.json` | GET | PWA manifest |
| `/web-tools/convos/sw.js` | GET | Service worker |
| `/web-tools/convos/icon.svg` | GET | App icon |
| `/web-tools/services` | GET | Services dashboard (credits, identity, coupon) |
| `/web-tools/services/services.css` | GET | Stylesheet for services page |
| `/web-tools/services/api` | GET | JSON API — instance identity + credit balance |
| `/web-tools/services/topup` | POST | Proxy credit top-up request to pool manager |
| `/web-tools/services/redeem-coupon` | POST | Proxy coupon redemption to pool manager |
| `/web-tools/skills` | GET | Skills index page (list all generated skills) |
| `/web-tools/skills/:slug` | GET | Skill detail page |
| `/web-tools/skills/skills.css` | GET | Stylesheet for skills pages |
| `/web-tools/skills/api` | GET | JSON API — list all skills |
| `/web-tools/skills/api/:slug` | GET | JSON API — single skill by slug |

## Files

| File | Purpose |
|------|---------|
| `convos/landing.html` | Convos landing page |
| `convos/landing-manifest.json` | PWA manifest |
| `convos/sw.js` | Service worker for offline support |
| `convos/icon.svg` | App icon |
| `services/services.html` | Services dashboard page |
| `services/services.css` | Extracted styles for services page |
| `skills/index.html` | Skills index page |
| `skills/skill.html` | Skill detail page |
| `skills/skills.css` | Styles for skills pages |

## Credit flow

For pool-managed instances, the services page shows remaining credits and a coupon redemption form:

```
Browser → GET /web-tools/services/api → instance fetches from pool manager → returns credits JSON
Browser → POST /web-tools/services/topup → instance proxies to pool manager → returns top-up result
Browser → POST /web-tools/services/redeem-coupon → instance proxies to pool manager → bumps OpenRouter limit
```

Auth uses `GATEWAY_TOKEN` + `INSTANCE_ID` to identify the instance to the pool manager. The gateway token is injected into HTML pages as `window.__POOL_TOKEN` for client-side API calls.

## Coupon redemption

The coupon flow lets users add processing power by entering a coupon code:

1. User enters code on the services page → POST to `/web-tools/services/redeem-coupon`
2. Web-tools proxies to pool manager's `/api/pool/redeem-coupon` with `instanceId`, `gatewayToken`, and `code`
3. Pool manager validates the code against `COUPON_CODE` env var (case-insensitive), bumps the instance's OpenRouter key limit by $20
4. Max limit enforced by `COUPON_MAX_LIMIT` (default $100)

## Environment variables

| Variable | Used for |
|----------|----------|
| `INSTANCE_ID` | Identifies this instance to the pool manager |
| `GATEWAY_TOKEN` | Auth token for pool manager API calls |
| `POOL_URL` | Pool manager base URL (email/phone fetched via `/api/proxy/info`) |
| `RAILWAY_PUBLIC_DOMAIN` | Used to build the public services URL |

### Pool manager env vars (for coupon support)

| Variable | Used for |
|----------|----------|
| `COUPON_CODE` | Valid coupon code (case-insensitive match) |
| `COUPON_MAX_LIMIT` | Max OpenRouter limit reachable via coupons (default: $100) |
