# Credits Sweep Worker

Cloudflare Worker that tracks per-instance OpenRouter credit spend and sends it to PostHog.

Runs on a 15-minute cron. Paginates OpenRouter's `listKeys()` API, extracts instance IDs and environment from key names (`assistant-<env>-<instanceId>`, with legacy `convos-agent-<instanceId>` fallback), computes spend deltas using Cloudflare KV, and batch-sends `instance_credits` events to PostHog.

## Event schema

### `instance_credits`

| Property | Type | Description |
|---|---|---|
| `instance_id` | string | Pool instance ID |
| `environment` | string | Pool environment (`dev`, `staging`, `production`) — empty for legacy keys |
| `credits_usage_total` | number | Cumulative spend from OpenRouter (snapshot) |
| `credits_limit` | number | Spending cap on the key |
| `credits_remaining` | number | `limit - usage` |
| `credits_spend_delta` | number | Spend since last sweep (computed via KV) |

`distinct_id` is `instance:<instanceId>`.

## Setup

```bash
cd workers/credits-sweep
pnpm install
wrangler kv namespace create STATS_CREDITS   # fill ID into wrangler.toml
wrangler secret put POSTHOG_API_KEY
wrangler secret put OPENROUTER_MANAGEMENT_KEY
wrangler deploy
```

## Local testing

```bash
cp .dev.vars.example .dev.vars   # fill in real values
wrangler dev --test-scheduled
# In another terminal:
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

## CI

Deployed automatically on merge to `staging` or `main` via `.github/workflows/worker-credits-sweep.yml`. Requires `CLOUDFLARE_API_TOKEN` repo secret.
