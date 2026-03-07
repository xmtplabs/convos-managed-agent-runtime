# Plan: Remove POOL_API_KEY from runtime instances

## Problem

Every runtime instance receives the pool manager's master `POOL_API_KEY` in its environment. A prompt-injected agent could use it to call pool manager admin endpoints (claim instances, drain the pool, access the admin dashboard, view all instance statuses). The codebase already acknowledges this risk in a comment at `pool-server.js:315`.

## Approach

Replace `POOL_API_KEY` with `OPENCLAW_GATEWAY_TOKEN` (already unique per-instance, already in the instance env) for authenticating pool-manager → instance calls. Stop injecting `POOL_API_KEY` into instance environments entirely.

## Changes

### 1. Pool manager: pass gateway token when calling instance endpoints

**`pool/src/pool.ts` — `healthCheck()`** (line 78-89)
- Change signature from `healthCheck(url)` to `healthCheck(url, gatewayToken)`
- Use `Bearer ${gatewayToken}` instead of `Bearer ${config.poolApiKey}`

**`pool/src/pool.ts` — `checkStarting()`** (line 92-110)
- After fetching `getByStatus("starting")`, also fetch the gateway token from `instance_infra` for each instance
- Pass the gateway token to `healthCheck()`

**`pool/src/provision.ts`** (line 50-53)
- After `claimIdle()`, look up the gateway token from `instance_infra` for the claimed instance
- Use `Bearer ${gatewayToken}` instead of `Bearer ${config.poolApiKey}`

### 2. Pool manager DB: add helper to get gateway token

**`pool/src/db/pool.ts`**
- Add `getGatewayToken(instanceId): Promise<string | null>` that queries `instance_infra` for the token
- This keeps the query simple and avoids changing `claimIdle()` or `getByStatus()` return types

### 3. Runtime pool-server: accept gateway token instead of POOL_API_KEY

**`runtime/scripts/pool-server.js`** (lines 35, 136-141)
- Change `checkAuth()` to validate against `OPENCLAW_GATEWAY_TOKEN` env var instead of `POOL_API_KEY`
- Remove the `POOL_API_KEY` constant (line 35)

### 4. Runtime convos extension: remove POOL_API_KEY usage

**`runtime/openclaw/extensions/convos/src/channel.ts`** (lines 757-759)
- The self-destruct call to `/pool/self-destruct` is localhost-only, so the Bearer header is redundant
- Remove the `POOL_API_KEY` header; the localhost check is sufficient

### 5. Stop injecting POOL_API_KEY into instances

**`pool/src/services/providers/env.ts`** (line 10)
- Remove `POOL_API_KEY: config.poolApiKey` from `buildInstanceEnv()`

### 6. Update keys.sh diagnostic script

**`runtime/scripts/keys.sh`** (lines 37, 107, 112, 122)
- Remove `POOL_API_KEY` references from the diagnostic output and env file handling

## Not changed (intentionally)

- **Admin dashboard login** — still uses `POOL_API_KEY` (admin-only, server-side)
- **`requireAuth` middleware** — still uses `POOL_API_KEY` for external API callers (dashboard site, etc.)
- **Railway webhook secret** — still uses `POOL_API_KEY` in URL path
- **`claimIdle()` return type** — unchanged; we add a separate lookup for gateway token

## Rollout consideration

Existing running instances still have `POOL_API_KEY` in their env but the pool manager will start sending gateway tokens. The pool-server `checkAuth()` change needs to land in the runtime image first (or accept both tokens during transition). Since instances are ephemeral and pool drains replace them, a single deploy cycle handles this — drain old instances, replenish with new image.
