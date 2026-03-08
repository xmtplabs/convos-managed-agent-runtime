# Stripe Integration

Stripe handles two separate payment flows for Convos agents: **processing power credits** (OpenRouter usage) and **virtual spending cards** (Stripe Issuing).

## Architecture

```
pool/src/services/providers/
  stripe.ts           — Customer management, PaymentIntents, webhook verification
  stripe-issuing.ts   — Cardholder + virtual card lifecycle (Stripe Issuing)

pool/src/stripeRoute.ts — Express routers (webhook + API endpoints)
```

All Stripe endpoints are instance-authenticated via `instanceId` + `gatewayToken`. The runtime's web-tools plugin proxies requests from the browser to the pool manager.

## Data model

Stripe resources are stored in `instance_services`:

| `toolId` | `resourceId` | `resourceMeta` | Purpose |
|----------|-------------|----------------|---------|
| `stripe` | Stripe customer ID (`cus_...`) | — | Customer record, reused across all payments |
| `stripe-issuing` | Stripe card ID (`ic_...`) | `{ cardholderId, last4, expMonth, expYear, brand, spendingLimitCents }` | Virtual spending card |

Payments are tracked in the `payments` table with `stripePaymentIntentId` for idempotency.

## Flow 1: Processing power credits

Credits fund the agent's OpenRouter API key. Priced at OpenRouter cost + 3%.

```
1. Browser → POST /api/pool/stripe/create-payment-intent
     { instanceId, gatewayToken, amountCents, purpose: "credits" }
   - Lazy-creates Stripe customer if none exists
   - Creates PaymentIntent with metadata: { instanceId, amountCents, purpose }
   - Records payment in DB (status: pending)
   - Returns { clientSecret }

2. Browser confirms payment via Stripe.js

3. Stripe webhook → POST /webhooks/stripe
   - Verifies signature via STRIPE_WEBHOOK_SECRET
   - Idempotency check: skips if payment already succeeded
   - purpose=credits: bumps OpenRouter key limit by amountCents/100
   - Updates payment status to "succeeded"
```

### Coupon codes

Bypass Stripe entirely. Pool validates the code against `COUPON_CODE` env var and bumps the OpenRouter limit by $20, up to `COUPON_MAX_LIMIT`.

```
POST /api/pool/stripe/redeem-coupon
  { instanceId, gatewayToken, code }
```

## Flow 2: Virtual spending card (Stripe Issuing)

A prepaid virtual Visa the agent uses for online purchases. Funded by the user, spent by the agent.

### Issuance (first card)

```
1. Browser → POST /api/pool/stripe/create-payment-intent
     { instanceId, gatewayToken, amountCents, purpose: "card" }

2. Browser confirms payment via Stripe.js

3. Stripe webhook fires — purpose=card, so NO credit bump

4. Browser → POST /api/pool/stripe/request-card
     { instanceId, gatewayToken, amountCents }
   - Creates cardholder via Stripe Issuing:
       name: "ca-<instanceId>" (max 24 chars)
       type: individual
       billing: Nashville TN address
       spending_controls: blocked categories (gambling, crypto ATMs, money orders)
   - Creates virtual Visa:
       currency: USD
       status: active
       spending_limits: [{ amount: amountCents, interval: all_time }]
   - Stores in instance_services (toolId=stripe-issuing)
   - Returns { action: "issued", last4, brand, spendingLimitCents }
```

### Top-up (existing card)

Same endpoint, detects existing card and increases the limit:

```
POST /api/pool/stripe/request-card
  - Finds existing card in instance_services
  - newLimit = currentLimit + amountCents
  - Calls stripe.issuing.cards.update() with new spending_limits
  - Returns { action: "topup", newLimitCents, last4 }
```

### Card info (services page display)

```
POST /api/pool/stripe/card-info
  → { hasCard, last4, brand, expMonth, expYear, spendingLimitCents, spentCents }
```

Returns masked info + current spending (sum of closed authorizations). Safe for display.

### Card details (agent use only)

```
POST /api/pool/stripe/card-details
  → { hasCard, number, cvc, expMonth, expYear, brand, spendingLimitCents }
```

Returns full card number + CVC. The agent uses this to fill payment forms via browser automation. Never exposed in chat messages.

### Blocked merchant categories

- `automated_cash_disburse`
- `betting_casino_gambling`
- `digital_goods_games`
- `wires_money_orders`

### Card metadata

Each cardholder and card carry metadata for traceability in the Stripe dashboard:

| Field | Cardholder | Card |
|-------|:----------:|:----:|
| `instanceId` | yes | yes |
| `poolEnvironment` | yes | yes |
| `agentName` | yes | yes |
| `instanceUrl` | | yes |
| `servicesUrl` | | yes |
| `railwayUrl` | | yes |

## Customer management

Stripe customers are lazy-created on first payment:

```
POST /api/pool/stripe/create-payment-intent
  → if no customer exists for instanceId:
    → stripe.customers.create({ name, metadata: { instanceId, agentName, ... } })
    → stored in instance_services (toolId=stripe, resourceId=cus_...)
```

Customer metadata includes `instanceId`, `agentName`, `poolEnvironment`, `instanceUrl`, `servicesUrl`, and `railwayUrl` for dashboard lookup.

### Balance

```
POST /api/pool/stripe/balance
  → { balanceCents }
```

Returns the Stripe customer balance (used by the services page).

## Webhook

Single endpoint at `POST /webhooks/stripe`. Must be mounted **before** `express.json()` middleware because Stripe requires the raw body for signature verification.

Handles `payment_intent.succeeded`:
- Reads `purpose` from PaymentIntent metadata
- `purpose=credits` → bumps OpenRouter key limit
- `purpose=card` → no-op (card issuance happens via `request-card` endpoint)
- Idempotent: checks `payments` table before processing

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (sk_test/sk_live) |
| `STRIPE_PUBLISHABLE_KEY` | Yes | Stripe publishable key (pk_test/pk_live) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Webhook signing secret (whsec_...) |
| `COUPON_CODE` | No | Valid coupon code for free credit bumps |
| `COUPON_MAX_LIMIT` | No | Max OpenRouter limit reachable via coupons (default: $100) |
