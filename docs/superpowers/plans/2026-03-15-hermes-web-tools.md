# Hermes Web Tools Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the services page and landing page from Hermes so users clicking the services link see the actual page instead of a 404.

**Architecture:** Move static HTML/CSS files into `runtime/shared/web-tools/`, add FastAPI routes to Hermes that serve them with token injection and proxy pool API calls, update OpenClaw extension to read from the shared location.

**Tech Stack:** Python/FastAPI (Hermes), TypeScript (OpenClaw extension update), Docker

---

### Task 1: Move static files to shared location

**Files:**
- Create: `runtime/shared/web-tools/services/services.html` (moved from openclaw)
- Create: `runtime/shared/web-tools/services/services.css` (moved from openclaw)
- Create: `runtime/shared/web-tools/convos/landing.html` (moved from openclaw)
- Create: `runtime/shared/web-tools/convos/landing-manifest.json` (moved from openclaw)
- Create: `runtime/shared/web-tools/convos/sw.js` (moved from openclaw)
- Create: `runtime/shared/web-tools/convos/icon.svg` (moved from openclaw)
- Delete: `runtime/openclaw/extensions/web-tools/services/` (directory)
- Delete: `runtime/openclaw/extensions/web-tools/convos/` (directory)

- [ ] **Step 1: Create shared directory and move files**

```bash
mkdir -p runtime/shared/web-tools/services runtime/shared/web-tools/convos
git mv runtime/openclaw/extensions/web-tools/services/services.html runtime/shared/web-tools/services/
git mv runtime/openclaw/extensions/web-tools/services/services.css runtime/shared/web-tools/services/
git mv runtime/openclaw/extensions/web-tools/convos/landing.html runtime/shared/web-tools/convos/
git mv runtime/openclaw/extensions/web-tools/convos/landing-manifest.json runtime/shared/web-tools/convos/
git mv runtime/openclaw/extensions/web-tools/convos/sw.js runtime/shared/web-tools/convos/
git mv runtime/openclaw/extensions/web-tools/convos/icon.svg runtime/shared/web-tools/convos/
```

- [ ] **Step 2: Fix hardcoded port in landing.html**

In `runtime/shared/web-tools/convos/landing.html`, line 354, replace:

```js
gatewayTip.textContent = "Join only works when this page is opened from your OpenClaw gateway. Open http://localhost:18789/web-tools/convos (or your gateway URL + /web-tools/convos), then paste the invite and click Join.";
```

With:

```js
gatewayTip.textContent = "Join only works when this page is opened from your agent's public URL. Open your agent URL + /web-tools/convos, then paste the invite and click Join.";
```

- [ ] **Step 3: Commit**

```bash
git add runtime/shared/web-tools/ runtime/openclaw/extensions/web-tools/
git commit -m "refactor: move web-tools static files to runtime/shared/"
```

---

### Task 2: Update OpenClaw extension to use shared path

**Files:**
- Modify: `runtime/openclaw/extensions/web-tools/index.ts:140-141`
- Modify: `runtime/openclaw/Dockerfile:29`

- [ ] **Step 1: Update path resolution in index.ts**

Replace lines 140-141:

```typescript
const agentsDir = path.resolve(__dirname, "convos");
const servicesDir = path.resolve(__dirname, "services");
```

With:

```typescript
// Docker: shared files copied to /app/web-tools/. Local dev: fall back to __dirname.
const sharedRoot = fs.existsSync("/app/web-tools") ? "/app/web-tools" : __dirname;
const agentsDir = path.resolve(sharedRoot, "convos");
const servicesDir = path.resolve(sharedRoot, "services");
```

- [ ] **Step 2: Add COPY to OpenClaw Dockerfile**

After the existing `COPY runtime/openclaw/extensions /app/openclaw/extensions` line, add:

```dockerfile
COPY runtime/shared/web-tools /app/web-tools
```

- [ ] **Step 3: Verify OpenClaw Dockerfile builds**

```bash
cd /Users/saulxmtp/Developer/convos-agents
docker build -f runtime/openclaw/Dockerfile -t convos-runtime:test-shared . --no-cache 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add runtime/openclaw/extensions/web-tools/index.ts runtime/openclaw/Dockerfile
git commit -m "fix(openclaw): use shared web-tools path"
```

---

### Task 3: Add FastAPI web-tools routes to Hermes

**Files:**
- Create: `runtime/hermes/src/web_tools.py`
- Modify: `runtime/hermes/src/server.py` (mount the router)

- [ ] **Step 1: Create web_tools.py**

Create `runtime/hermes/src/web_tools.py`:

```python
"""Web tools — serves the services page and landing page.

Mirrors the OpenClaw web-tools extension so both runtimes serve
the same UI at /web-tools/services and /web-tools/convos.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter()

# Static files live at /app/web-tools in Docker, fall back for local dev.
_SHARED_ROOT = Path("/app/web-tools") if Path("/app/web-tools").exists() else (
    Path(__file__).resolve().parent.parent.parent / "shared" / "web-tools"
)
_SERVICES_DIR = _SHARED_ROOT / "services"
_CONVOS_DIR = _SHARED_ROOT / "convos"


def _gateway_token() -> str:
    return os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")


def _serve_html_with_token(html_path: Path) -> Response:
    """Read an HTML file and inject the gateway token before </head>."""
    try:
        html = html_path.read_text()
    except FileNotFoundError:
        return Response(status_code=404)
    token = _gateway_token()
    injection = f"<script>window.__POOL_TOKEN={json.dumps(token)};</script>"
    html = html.replace("</head>", injection + "\n</head>")
    return Response(content=html, media_type="text/html",
                    headers={"Cache-Control": "no-store"})


def _serve_static(file_path: Path, media_type: str,
                  cache_control: str = "max-age=3600") -> Response:
    try:
        body = file_path.read_bytes()
    except FileNotFoundError:
        return Response(status_code=404)
    return Response(content=body, media_type=media_type,
                    headers={"Cache-Control": cache_control})


def _pool_auth() -> dict:
    """Build auth body fields for pool manager requests."""
    return {
        "instanceId": os.environ.get("INSTANCE_ID", ""),
        "gatewayToken": _gateway_token(),
    }


def _pool_url() -> str:
    return os.environ.get("POOL_URL", "")


# ── Services page ────────────────────────────────────────────


@router.get("/web-tools/services")
@router.get("/web-tools/services/")
async def services_page():
    return _serve_html_with_token(_SERVICES_DIR / "services.html")


@router.get("/web-tools/services/services.css")
async def services_css():
    return _serve_static(_SERVICES_DIR / "services.css", "text/css")


@router.get("/web-tools/services/api")
async def services_api():
    """Return identity, credits, and runtime info — same contract as OpenClaw."""
    pool_url = _pool_url()
    instance_id = os.environ.get("INSTANCE_ID", "")
    gateway_token = _gateway_token()

    email = None
    phone = None
    result: dict = {"email": None, "phone": None, "servicesUrl": None, "instanceId": instance_id}

    # Build services URL from public domain
    domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")
    ngrok = os.environ.get("NGROK_URL", "")
    port = os.environ.get("PORT", "8080")
    if domain:
        base = f"https://{domain}"
    elif ngrok:
        base = ngrok.rstrip("/")
    else:
        base = f"http://127.0.0.1:{port}"
    result["servicesUrl"] = f"{base}/web-tools/services"

    if instance_id and gateway_token and pool_url:
        async with httpx.AsyncClient(timeout=5) as client:
            # Identity
            try:
                resp = await client.get(
                    f"{pool_url}/api/proxy/info",
                    headers={"Authorization": f"Bearer {instance_id}:{gateway_token}"},
                )
                if resp.status_code == 200:
                    info = resp.json()
                    email = info.get("email")
                    phone = info.get("phone")
            except Exception:
                pass

            # Runtime version/image
            try:
                resp = await client.post(
                    f"{pool_url}/api/pool/self-info",
                    json={"instanceId": instance_id, "gatewayToken": gateway_token},
                )
                if resp.status_code == 200:
                    self_info = resp.json()
                    result["runtimeVersion"] = self_info.get("runtimeVersion")
                    result["runtimeImage"] = self_info.get("runtimeImage")
            except Exception:
                pass

            # Credits
            try:
                resp = await client.post(
                    f"{pool_url}/api/pool/credits-check",
                    json={"instanceId": instance_id, "gatewayToken": gateway_token},
                )
                if resp.status_code == 200:
                    result["credits"] = resp.json()
                else:
                    result["credits"] = {"error": "unavailable"}
            except Exception:
                result["credits"] = {"error": "unavailable"}
    else:
        result["credits"] = {"error": "not pool-managed"}

    # Env fallback for local dev
    if not email:
        email = os.environ.get("AGENTMAIL_INBOX_ID")
    if not phone:
        phone = os.environ.get("TELNYX_PHONE_NUMBER")

    result["email"] = email
    result["phone"] = phone

    return result


@router.post("/web-tools/services/topup")
async def services_topup():
    pool_url = _pool_url()
    auth = _pool_auth()
    if not auth["instanceId"] or not auth["gatewayToken"] or not pool_url:
        return Response(
            content=json.dumps({"error": "Top-up not available (missing config)"}),
            status_code=400, media_type="application/json",
        )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{pool_url}/api/pool/credits-topup", json=auth)
            return Response(content=resp.content, status_code=resp.status_code,
                            media_type="application/json")
    except Exception as err:
        logger.warning(f"Credits top-up error: {err}")
        return Response(
            content=json.dumps({"error": "Failed to reach pool manager"}),
            status_code=502, media_type="application/json",
        )


@router.post("/web-tools/services/redeem-coupon")
async def services_redeem_coupon(request: Request):
    pool_url = _pool_url()
    auth = _pool_auth()
    if not auth["instanceId"] or not auth["gatewayToken"] or not pool_url:
        return Response(
            content=json.dumps({"error": "Coupon redemption not available"}),
            status_code=400, media_type="application/json",
        )
    try:
        body = await request.json()
        payload = {**auth, "code": body.get("code", "")}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{pool_url}/api/pool/redeem-coupon", json=payload)
            return Response(content=resp.content, status_code=resp.status_code,
                            media_type="application/json")
    except Exception as err:
        logger.warning(f"Coupon redemption error: {err}")
        return Response(
            content=json.dumps({"error": "Failed to reach server"}),
            status_code=502, media_type="application/json",
        )


# ── Convos landing page ─────────────────────────────────────


@router.get("/web-tools/convos")
@router.get("/web-tools/convos/")
async def convos_landing():
    return _serve_html_with_token(_CONVOS_DIR / "landing.html")


@router.get("/web-tools/convos/manifest.json")
async def convos_manifest():
    return _serve_static(_CONVOS_DIR / "landing-manifest.json",
                         "application/manifest+json")


@router.get("/web-tools/convos/sw.js")
async def convos_sw():
    return _serve_static(_CONVOS_DIR / "sw.js",
                         "application/javascript", "max-age=0")


@router.get("/web-tools/convos/icon.svg")
async def convos_icon():
    return _serve_static(_CONVOS_DIR / "icon.svg", "image/svg+xml")
```

- [ ] **Step 2: Mount the router in server.py**

In `runtime/hermes/src/server.py`, after the line `app = FastAPI(title="Convos Hermes Runtime", lifespan=lifespan)`, add:

```python
from .web_tools import router as web_tools_router
app.include_router(web_tools_router)
```

- [ ] **Step 3: Add httpx to requirements.txt**

Check if httpx is already in requirements.txt. If not, add it:

```
httpx
```

- [ ] **Step 4: Commit**

```bash
git add runtime/hermes/src/web_tools.py runtime/hermes/src/server.py runtime/hermes/requirements.txt
git commit -m "feat(hermes): add web-tools routes for services and landing pages"
```

---

### Task 4: Update Hermes Dockerfile

**Files:**
- Modify: `runtime/hermes/Dockerfile:53`

- [ ] **Step 1: Add COPY for shared web-tools**

After the existing `COPY runtime/hermes/src /app/src` line, add:

```dockerfile
COPY runtime/shared/web-tools /app/web-tools
```

- [ ] **Step 2: Verify Hermes Dockerfile builds**

```bash
cd /Users/saulxmtp/Developer/convos-agents
docker build -f runtime/hermes/Dockerfile -t convos-runtime-hermes:test-shared . --no-cache 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add runtime/hermes/Dockerfile
git commit -m "fix(hermes): copy shared web-tools into Docker image"
```

---

### Task 5: Verify end-to-end locally

- [ ] **Step 1: Run Hermes locally and verify services page loads**

```bash
cd /Users/saulxmtp/Developer/convos-agents/runtime
pnpm start:hermes
# In another terminal:
curl -s http://localhost:8080/web-tools/services | head -5
```

Expected: HTML starting with `<!DOCTYPE html>` containing the injected `window.__POOL_TOKEN` script.

- [ ] **Step 2: Verify CSS serves**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/web-tools/services/services.css
```

Expected: `200`

- [ ] **Step 3: Verify API endpoint responds**

```bash
curl -s http://localhost:8080/web-tools/services/api | python3 -m json.tool
```

Expected: JSON with `email`, `phone`, `credits`, `instanceId` fields (values may be null in local dev).

- [ ] **Step 4: Verify convos landing page**

```bash
curl -s http://localhost:8080/web-tools/convos | head -5
```

Expected: HTML with `<title>convos managed agent runtime</title>`.

- [ ] **Step 5: Final commit with all changes**

```bash
git add -A
git commit -m "feat(hermes): web-tools services and landing pages"
```
