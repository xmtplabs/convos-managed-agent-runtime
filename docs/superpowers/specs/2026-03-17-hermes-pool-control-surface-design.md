# Hermes Pool Control Surface Parity

**Date:** 2026-03-17
**Status:** Approved
**Scope:** Two missing pool-manager control surface endpoints in `runtime-hermes`

## Context

The Hermes runtime (`hermes/src/server.py`) implements the pool-manager HTTP API contract so pool-managed instances can be provisioned, health-checked, and controlled. Two gaps remain versus the OpenClaw reference implementation (`openclaw/scripts/pool-server.js`):

1. **`/pool/health` always returns `ready: true`** — the pool manager promotes instances to `idle` immediately, even if startup hasn't completed.
2. **No self-destruct notification to pool manager** — when a conversation ends (membership termination), Hermes stops the adapter but never tells the pool manager to destroy the Railway service.

A third gap (`/pool/restart-gateway`) was evaluated and deemed unnecessary — nothing in the pool manager or dashboard calls it, and Hermes has no subprocess to restart.

## Design

### Fix 1: `/pool/health` reflects actual readiness

**File:** `hermes/src/server.py`

**New module-level state:**
- `_server_ready: bool = False` — set to `True` at the end of `lifespan()`, after `_try_resume_from_credentials` returns (whether it succeeds or there are no saved credentials).
- `_health_cached: bool = False` — once `/pool/health` returns `ready: true`, this locks it permanently (matches OpenClaw's caching behavior).

**Note:** OpenClaw has two separate readiness gates (`gatewayReady` for the subprocess, `convosReady` for the extension). Since Hermes is a single process with no subprocess, these collapse into the single `_server_ready` flag — the lifespan completing is equivalent to both gates passing.

**Endpoint logic:**

| State | `ready` |
|---|---|
| Lifespan not yet complete | `false` |
| Lifespan done, no adapter (awaiting provision) | `true` |
| Lifespan done, adapter exists and instance is active | `true` |

Once `ready: true` is returned, `_health_cached` is set and subsequent calls always return `true`.

Response shape is unchanged: `{"ready": bool, "version": str, "runtime": "hermes"}`

### Fix 2: Self-destruct notification on membership termination

**File:** `hermes/src/convos_adapter.py`

**Architecture note:** In OpenClaw, the extension calls a localhost `/pool/self-destruct` endpoint on its own pool-server, which then relays to the pool manager. Hermes has no pool-server subprocess — the FastAPI app IS the HTTP server — so the adapter calls the pool manager directly. This is the equivalent behavior with one fewer hop.

**New imports:** `import sys`, `import httpx`

**New module-level async function** (called as `await _notify_pool_self_destruct()`, not as an instance method):

```python
async def _notify_pool_self_destruct():
    """Tell the pool manager to destroy this instance."""
    instance_id = os.environ.get("INSTANCE_ID")
    pool_url = os.environ.get("POOL_URL")
    gateway_token = os.environ.get("GATEWAY_TOKEN")

    if not instance_id or not pool_url or not gateway_token:
        logger.info("Self-destruct skipped: not a pool-managed instance")
        return

    url = f"{pool_url}/api/pool/self-destruct"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "instanceId": instance_id,
                "gatewayToken": gateway_token,
            })
            logger.info("Pool manager self-destruct response: %d", resp.status_code)
    except Exception as err:
        logger.error("Self-destruct call failed: %s", err)
```

**Call site:** Inside `_on_message`, in the `if termination_reason:` block (line ~374), after `self.stop()`:

```python
if termination_reason:
    logger.info(f"Membership ended, self-destructing ({termination_reason})")
    await self.stop()
    await _notify_pool_self_destruct()
    if not os.environ.get("EVAL_MODE"):
        sys.exit(0)
    return
```

- Uses `httpx.AsyncClient` (already a dependency in `requirements.txt`).
- Skips silently if env vars are missing (not pool-managed).
- Skips `sys.exit(0)` if `EVAL_MODE` is set (keeps container alive for result collection, matching OpenClaw).

## Out of scope

- `/pool/restart-gateway` — dead code in OpenClaw, nothing calls it, no Hermes equivalent needed.
- Changes to pool manager or OpenClaw runtime.
