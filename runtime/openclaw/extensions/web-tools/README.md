# web-tools

OpenClaw plugin that serves public-facing web pages and handles prepaid token management for pool-managed instances.

## What it does

1. **Convos landing page** — installable PWA at `/web-tools/convos` with invite link and QR code
2. **Services page** — shows instance identity (email, phone), processing power balance, and spending card at `/web-tools/services`
3. **Credit error rewriting** — intercepts outgoing messages containing provider credit errors and replaces them with a friendly link to the services page

## Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/web-tools/convos` | GET | Convos landing page (PWA) |
| `/web-tools/convos/manifest.json` | GET | PWA manifest |
| `/web-tools/convos/sw.js` | GET | Service worker |
| `/web-tools/convos/icon.svg` | GET | App icon |
| `/web-tools/services` | GET | Services dashboard |
| `/web-tools/services/services.css` | GET | Services stylesheet |
| `/web-tools/services/api` | GET | JSON API — instance identity + balance |
| `/web-tools/services/topup` | POST | Proxy top-up request to pool manager |
| `/web-tools/services/stripe-config` | POST | Proxy — returns Stripe publishable key |
| `/web-tools/services/create-payment` | POST | Proxy — creates Stripe PaymentIntent |
| `/web-tools/services/stripe-balance` | POST | Proxy — returns Stripe customer balance |
| `/web-tools/services/redeem-coupon` | POST | Proxy — redeems a coupon code |
| `/web-tools/services/request-card` | POST | Proxy — requests or tops up a virtual spending card |
| `/web-tools/services/card-info` | POST | Proxy — returns masked card info for display |
| `/web-tools/services/card-details` | POST | Proxy — returns full card details (agent use only) |

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry — route registration, credit error interception, services API |
| `convos/landing.html` | Convos landing page |
| `convos/landing-manifest.json` | PWA manifest |
| `convos/sw.js` | Service worker for offline support |
| `convos/icon.svg` | App icon |
| `services/services.html` | Services dashboard page |
| `services/services.css` | Services stylesheet |

## Prepaid token flow

Users start with a free $20 processing power limit. When depleted, they purchase a credit pack ($20, $50, or $100) via Stripe. Credits are priced at OpenRouter cost + 3%.

```
User's agent runs out of power (hits $20 free limit)
  → User opens services page, picks a credit pack
  → Stripe Elements collects card, creates PaymentIntent
  → Stripe webhook fires → pool manager bumps OpenRouter key cap
  → Agent resumes with new credits available
```

Detailed flow:
```
Browser → GET /web-tools/services/api → returns current balance
Browser → POST /web-tools/services/stripe-config → get Stripe publishable key
Browser → POST /web-tools/services/create-payment → create PaymentIntent
Browser → Stripe.js confirms card payment
Stripe webhook → pool manager → increases OpenRouter key spend limit
Browser → polls /web-tools/services/api until balance reflects the increase
Browser → shows green check, navigates back to landing
```

Coupon codes bypass Stripe entirely:
```
Browser → POST /web-tools/services/redeem-coupon → pool validates code → bumps limit by $20
```

## Spending card flow

Users can fund a prepaid virtual Visa for their agent. The agent uses it for online purchases, subscriptions, and bookings.

```
Browser → POST /web-tools/services/create-payment → PaymentIntent for card amount
Browser → Stripe.js confirms card payment
Browser → POST /web-tools/services/request-card → pool issues virtual card via Stripe Issuing
Browser → shows green check with card details, navigates back
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
