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
_SKILLS_DIR = _SHARED_ROOT / "skills"


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

    # Show shortened pool URL so the user can tell if they're hitting localhost or Railway
    if pool_url:
        try:
            from urllib.parse import urlparse
            result["poolHost"] = urlparse(pool_url).netloc
        except Exception:
            pass

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


@router.get("/web-tools/convos/landing.css")
async def convos_landing_css():
    return _serve_static(_CONVOS_DIR / "landing.css", "text/css",
                         "max-age=3600")


@router.get("/web-tools/convos/icon.svg")
async def convos_icon():
    return _serve_static(_CONVOS_DIR / "icon.svg", "image/svg+xml")


# ── Skills pages ────────────────────────────────────────────


def _skills_data_path() -> Path:
    """Resolve the path to $SKILLS_ROOT/generated/skills.json."""
    skills_root = os.environ.get("SKILLS_ROOT", "")
    if not skills_root:
        hermes_home = os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
        skills_root = str(Path(hermes_home) / "skills")
    return Path(skills_root) / "generated" / "skills.json"


def _read_skill_by_slug(slug: str) -> dict | None:
    """Read skills.json and return a single skill by slug."""
    try:
        data = json.loads(_skills_data_path().read_text())
        skills = data.get("skills", [])
        if not isinstance(skills, list):
            return None
        return next((s for s in skills if s.get("slug") == slug), None)
    except Exception:
        return None


def _read_skills_data() -> dict:
    """Read the full skills.json."""
    try:
        return json.loads(_skills_data_path().read_text())
    except Exception:
        return {"active": None, "skills": []}


@router.get("/web-tools/skills/skills.css")
async def skills_css():
    return _serve_static(_SKILLS_DIR / "skills.css", "text/css")


@router.get("/web-tools/skills/api")
async def skills_api_list():
    """Return the full skills.json (all skills + active marker)."""
    return Response(
        content=json.dumps(_read_skills_data()),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/web-tools/skills/api/{slug}")
async def skills_api(slug: str):
    """Return a single skill's JSON data by slug."""
    skill = _read_skill_by_slug(slug)
    if skill:
        return Response(
            content=json.dumps(skill),
            media_type="application/json",
            headers={"Cache-Control": "no-store"},
        )
    return Response(
        content=json.dumps({"error": "skill not found"}),
        status_code=404,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/web-tools/skills")
@router.get("/web-tools/skills/")
async def skills_index():
    """Serve the skills index page."""
    return _serve_static(_SKILLS_DIR / "index.html", "text/html; charset=utf-8",
                         cache_control="no-store")


@router.get("/web-tools/skills/{slug}")
async def skills_page(slug: str):
    """Serve the skill page HTML shell for any slug."""
    return _serve_static(_SKILLS_DIR / "skill.html", "text/html; charset=utf-8",
                         cache_control="no-store")
