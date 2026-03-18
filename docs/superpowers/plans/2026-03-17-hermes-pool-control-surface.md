# Hermes Pool Control Surface Parity — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hermes `/pool/health` reflect actual readiness and notify the pool manager on self-destruct, matching the OpenClaw runtime's pool control surface.

**Architecture:** Two changes to existing files — no new files. `server.py` gets readiness tracking and a smarter health endpoint. `convos_adapter.py` gets an `httpx` call to the pool manager on membership termination, followed by `sys.exit(0)`.

**Tech Stack:** Python, FastAPI, httpx

**Spec:** `docs/superpowers/specs/2026-03-17-hermes-pool-control-surface-design.md`

---

## Chunk 1: Health endpoint readiness

### Task 1: Add readiness state to server.py

**Files:**
- Modify: `runtime/hermes/src/server.py:50-57` (module-level state)
- Modify: `runtime/hermes/src/server.py:391-413` (lifespan)
- Modify: `runtime/hermes/src/server.py:441-444` (health endpoint)

- [ ] **Step 1: Add `_server_ready` and `_health_cached` module-level state**

In `runtime/hermes/src/server.py`, after the existing `_setup_cleanup_task` declaration (line 59), add:

```python
# Pool health readiness — tracks whether lifespan startup is complete.
# OpenClaw has two gates (gatewayReady + convosReady); Hermes collapses them
# into one because it has no subprocess — lifespan completing is equivalent.
_server_ready: bool = False
_health_cached: bool = False
```

- [ ] **Step 2: Set `_server_ready = True` at the end of lifespan startup**

In the `lifespan()` function, add `global _server_ready` to the existing global declaration, and set `_server_ready = True` right before the `yield` statement (after `_try_resume_from_credentials` returns):

Change the lifespan globals line from:
```python
    global _config, _cron_task, _event_loop
```
to:
```python
    global _config, _cron_task, _event_loop, _server_ready
```

Then add this line immediately before `yield` (after the `await _try_resume_from_credentials(_config)` call):
```python
    _server_ready = True
```

- [ ] **Step 3: Update `/pool/health` endpoint to reflect readiness**

Replace the current `pool_health` function:

```python
@app.get("/pool/health")
async def pool_health():
    return {"ready": True, "version": RUNTIME_VERSION, "runtime": "hermes"}
```

With:

```python
@app.get("/pool/health")
async def pool_health():
    global _health_cached
    if _health_cached:
        return {"ready": True, "version": RUNTIME_VERSION, "runtime": "hermes"}

    if not _server_ready:
        return {"ready": False, "version": RUNTIME_VERSION, "runtime": "hermes"}

    # Server is ready — either no adapter yet (awaiting provision)
    # or adapter exists with an active instance. Cache permanently.
    _health_cached = True
    return {"ready": True, "version": RUNTIME_VERSION, "runtime": "hermes"}
```

- [ ] **Step 4: Verify the server starts and health returns correctly**

Run locally (will fail without env vars, but confirms no syntax errors):

```bash
cd runtime/hermes && python -c "from src.server import app; print('import ok')"
```

- [ ] **Step 5: Commit**

```bash
git add runtime/hermes/src/server.py
git commit -m "fix(hermes): make /pool/health reflect actual server readiness

Pool manager polls /pool/health to promote starting → idle. Previously
always returned ready: true, even during startup. Now tracks lifespan
completion and caches once ready."
```

---

## Chunk 2: Self-destruct notification

### Task 2: Add self-destruct pool manager notification

**Files:**
- Modify: `runtime/hermes/src/convos_adapter.py:22-27` (imports)
- Modify: `runtime/hermes/src/convos_adapter.py:370-377` (termination block)

- [ ] **Step 1: Add `sys` and `httpx` imports**

In `runtime/hermes/src/convos_adapter.py`, add `import sys` and `import httpx` to the existing import block (after `import os` on line 26):

```python
import asyncio
import logging
import os
import re
import sys

import httpx
```

- [ ] **Step 2: Add `_notify_pool_self_destruct` function**

Add this module-level function after the imports and before the `ConvosAdapter` class definition. Place it after the `ProfileImageRenewalStore` import (line 35) and before any class:

```python
async def _notify_pool_self_destruct() -> None:
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

- [ ] **Step 3: Wire self-destruct into the membership termination block**

In the `_on_message` method, replace the existing termination block (around line 372-377):

```python
            if termination_reason:
                logger.info(f"Membership ended, self-destructing ({termination_reason})")
                await self.stop()
                return
```

With:

```python
            if termination_reason:
                logger.info(f"Membership ended, self-destructing ({termination_reason})")
                await self.stop()
                await _notify_pool_self_destruct()
                if not os.environ.get("EVAL_MODE"):
                    sys.exit(0)
                return
```

- [ ] **Step 4: Verify no import errors**

```bash
cd runtime/hermes && python -c "from src.convos_adapter import _notify_pool_self_destruct; print('import ok')"
```

- [ ] **Step 5: Commit**

```bash
git add runtime/hermes/src/convos_adapter.py
git commit -m "feat(hermes): notify pool manager on self-destruct

When membership terminates (kicked/removed), notify the pool manager
via POST /api/pool/self-destruct so it can destroy the Railway service.
Skips if not pool-managed (missing env vars) or EVAL_MODE is set."
```
