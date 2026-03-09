# web-tools

OpenClaw plugin that serves public-facing web pages and handles billing for pool-managed Convos agents.

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
| `index.ts` | Plugin entry — route registration, services API, coupon proxy |
| `convos/landing.html` | Convos landing page |
| `convos/landing-manifest.json` | PWA manifest |
| `convos/sw.js` | Service worker for offline support |
| `convos/icon.svg` | App icon |
| `services/services.html` | Services dashboard page |
| `services/services.css` | Services stylesheet |

## Billing overview

Every Convos agent starts with **$20 of free usage**, enforced by an OpenRouter API key spend cap. In all models, **OpenRouter bills XMTP Labs, Inc.** for token usage — the billing model only affects when and how Convos recovers that cost from users.

**Fee model:** Convos charges users OpenRouter's cost + 3%.

### Billing models compared

|  | **Prepaid tokens** (current) | **Fixed subscription** | **Postpaid / usage-based** (Stripe preview) |
| --- | --- | --- | --- |
| **How it works** | Buy credits upfront. Agent stops when depleted. | Flat monthly fee. Agent runs freely. | Add a card. Charged at end of billing cycle for actual usage. |
| **Usage risk** | User | Convos (heavy users may exceed price) | Convos (front costs until month end, card failure = loss) |
| **OpenRouter** | Key cap set to credits purchased. Bumped via webhook after payment. | Key cap set to a high ceiling (e.g. $500/mo). | Key cap set to a high ceiling. Usage reported to Stripe automatically. |
| **Stripe** | One-time payment. Webhook → limit bump. | Recurring subscription, auto-renewal. | Usage-based subscription. Stripe meters, applies 3% markup, invoices. |
| **Revenue** | Lumpy — depends on top-up timing. | Predictable MRR. | Unpredictable — varies with usage. |
| **Overhead** | Medium — webhook bridges payment → limit bump. | Low. | Low, but requires Stripe preview access + OpenRouter partnership. |
| **Margin** | 3% on credits purchased. | 3% on actual usage, absorbed into flat price. | 3% configured as markup in Stripe dashboard. |
| **Churn risk** | Low — money already spent. | Medium — cancels if underused. | Medium — cancels after surprise bill. |
| **Availability** | Now. | Now. | Stripe private preview only. |

## Prepaid token flow (current)

User hits $20 free limit → buys a credit pack ($20, $50, $100) → Stripe payment webhook → pool manager bumps OpenRouter key cap → agent resumes. Credits are priced at OpenRouter cost + 3%. Money collected **before** usage. Zero usage risk for Convos.

```
User's agent runs out of power (hits $20 free limit)
  → User opens services page, picks a credit pack
  → Stripe Elements collects card, creates PaymentIntent
  → Stripe webhook fires → pool manager bumps OpenRouter key cap
  → Agent resumes with new credits available
```

Detailed flow:
```
Browser → GET /web-tools/services/api           → returns current balance
Browser → POST /web-tools/services/stripe-config → get Stripe publishable key
Browser → POST /web-tools/services/create-payment → create PaymentIntent (purpose=credits)
Browser → Stripe.js confirms card payment
Stripe webhook (payment_intent.succeeded) → pool manager → increases OpenRouter key spend limit
Browser → polls /web-tools/services/api until balance reflects the increase
```

Coupon codes bypass Stripe entirely:
```
Browser → POST /web-tools/services/redeem-coupon → pool validates code → bumps limit by $20
```

## Virtual spending card (Stripe Issuing)

Users can fund a **prepaid virtual Visa** for their agent. The card is issued via Stripe Issuing and has a one-time spending cap funded by the user's payment. The agent uses it for online purchases, subscriptions, and bookings.

### How it works

1. User pays via Stripe Elements on the services page (purpose = `card`)
2. Stripe webhook confirms payment — **no credit bump** for card payments
3. Pool manager calls Stripe Issuing to create a cardholder + virtual card
4. Card is stored in `instance_services` with `toolId = "stripe-issuing"`
5. Agent retrieves card details via `services.mjs card details` and uses them silently in browser/forms

### Issuance flow (new card)

```
Browser → POST /web-tools/services/create-payment   → PaymentIntent (purpose=card, amountCents)
Browser → Stripe.js confirms card payment
Browser → POST /web-tools/services/request-card      → pool issues virtual card via Stripe Issuing
  └─ Creates cardholder (name: "ca-<instanceId>", billing: Nashville TN)
  └─ Creates virtual Visa with all_time spending limit = amountCents
  └─ Stores card in instance_services (toolId=stripe-issuing)
  └─ Returns { action: "issued", last4, brand, spendingLimitCents }
```

### Top-up flow (existing card)

If the agent already has a card, the same `request-card` endpoint increases the spending limit instead of issuing a new one:

```
Browser → POST /web-tools/services/request-card
  └─ Finds existing card in instance_services
  └─ Calls Stripe Issuing updateSpendingLimit(newLimit = currentLimit + amountCents)
  └─ Returns { action: "topup", newLimitCents, last4 }
```

### Card controls

- **Spending limit:** All-time cap, not monthly. Increases only when user adds more funds.
- **Blocked categories:** Gambling, crypto ATMs, money orders, automated cash disbursement.
- **Card info endpoint** (`/card-info`): Returns last4, brand, expiry, limit, and current spending. Used by the services page.
- **Card details endpoint** (`/card-details`): Returns full number + CVC. Authenticated by gateway token, intended for agent use only (filling payment forms via browser). Never exposed in chat.

### Card metadata (Stripe dashboard)

Each cardholder and card carry metadata for traceability:

| Field | Cardholder | Card |
|-------|:----------:|:----:|
| `instanceId` | ✓ | ✓ |
| `poolEnvironment` | ✓ | ✓ |
| `agentName` | ✓ | ✓ |
| `instanceUrl` | | ✓ |
| `servicesUrl` | | ✓ |
| `railwayUrl` | | ✓ |

## Fixed subscription flow

User hits $20 free limit → subscribes to a monthly plan (e.g. $29/mo) → Stripe handles recurring billing → Convos raises OpenRouter key cap → agent runs freely up to that limit, overage charged beyond.

Flat price covers up to $100 of OpenRouter usage. Above $100, Convos charges per dollar of additional usage at OpenRouter cost + 3%.

## Postpaid / usage-based flow (Stripe preview)

User hits $20 free limit → adds a card → OpenRouter reports actual token usage to Stripe → Stripe invoices at month end. Cleanest margin model — 3% is always accurate to actual usage. Requires Stripe private preview access and coordination with OpenRouter.

## Auth

Auth uses `OPENCLAW_GATEWAY_TOKEN` + `INSTANCE_ID` to identify the instance to the pool manager. The `poolApiKey` from runtime config is injected into HTML pages as `window.__POOL_TOKEN` for client-side API calls. Every pool manager endpoint validates `instanceId` + `gatewayToken` before processing.

A Stripe customer is lazy-created on first payment and stored in `instance_services` with `toolId = "stripe"`. This customer ID is reused for all subsequent payments and card operations.

## Environment variables

| Variable | Used for |
|----------|----------|
| `INSTANCE_ID` | Identifies this instance to the pool manager |
| `OPENCLAW_GATEWAY_TOKEN` | Auth token for pool manager API calls |
| `POOL_URL` | Pool manager base URL (email/phone fetched via `/api/proxy/info`) |
| `RAILWAY_PUBLIC_DOMAIN` | Used to build the public services URL |
| `NGROK_URL` | Fallback for public services URL when no Railway domain |
