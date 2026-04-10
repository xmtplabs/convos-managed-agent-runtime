"""Web tools — serves the services page and landing page.

Mirrors the OpenClaw web-tools extension so both runtimes serve
the same UI at /web-tools/services and /web-tools/convos.
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter()

# Anchor-based resolution — no parent-counting.  See paths.py.
from ..server.paths import PLATFORM_ROOT

_SHARED_ROOT = PLATFORM_ROOT / "convos-platform" / "web-tools"
_CONVOS_DIR = _SHARED_ROOT / "convos"


def _gateway_token() -> str:
    return os.environ.get("GATEWAY_TOKEN", "")


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


# ── Mini-app at /web-tools/ ──────────────────────────────────


@router.get("/web-tools")
@router.get("/web-tools/")
@router.get("/web-tools/services")
@router.get("/web-tools/services/")
@router.get("/web-tools/tasks")
@router.get("/web-tools/context")
@router.get("/web-tools/notes")
async def app_page():
    return _serve_html_with_token(_SHARED_ROOT / "index.html")


@router.get("/web-tools/app.css")
async def app_css():
    return _serve_static(_SHARED_ROOT / "app.css", "text/css")


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
    port = os.environ.get("PORT", "8080")
    base = f"https://{domain}" if domain else f"http://127.0.0.1:{port}"
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


# ── Context API (reads from runtime workspace) ─────────────


_NATIVE_FILES = {"AGENTS.md", "INJECTED_CONTEXT.md", "SOUL.md"}


def _read_workspace_files() -> list[dict]:
    """Read .md files from $HERMES_HOME/workspace/, excluding native files."""
    home = _hermes_home()
    files: list[dict] = []

    ws_dir = home / "workspace"
    try:
        for f in sorted(ws_dir.iterdir()):
            if f.suffix == ".md" and f.is_file() and f.name not in _NATIVE_FILES:
                try:
                    files.append({"name": f.stem, "content": f.read_text()})
                except Exception:
                    pass
    except Exception:
        pass

    return files


@router.get("/web-tools/services/context-api")
async def context_api():
    files = _read_workspace_files()
    return Response(
        content=json.dumps({"sections": files}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


# ── Tasks / cron API ───────────────────────────────────────


def _read_cron_jobs() -> list[dict]:
    home = _hermes_home()
    jobs_path = home / "cron" / "jobs.json"
    try:
        data = json.loads(jobs_path.read_text())
        jobs = data.get("jobs", [])
        return jobs if isinstance(jobs, list) else []
    except Exception:
        return []


@router.get("/web-tools/services/tasks-api")
async def tasks_api():
    jobs = _read_cron_jobs()
    return Response(
        content=json.dumps({"jobs": jobs}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


# ── Logs sharing status & toggle ───────────────────────────


@router.get("/web-tools/services/logs-status")
async def logs_status():
    enabled = _sharing_enabled()
    return Response(
        content=json.dumps({"enabled": enabled}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/web-tools/services/logs-toggle")
async def logs_toggle(request: Request):
    body = await request.json()
    enable = bool(body.get("enabled", False))
    marker = _hermes_home() / ".share-trajectories"
    try:
        if enable:
            marker.write_text("")
        else:
            if marker.exists():
                marker.unlink()
    except Exception:
        pass
    enabled = marker.exists()
    return Response(
        content=json.dumps({"enabled": enabled}),
        media_type="application/json",
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
    """Resolve the path to $WORKSPACE_SKILLS/generated/skills.json."""
    ws_skills = os.environ.get("WORKSPACE_SKILLS", "")
    if not ws_skills:
        hermes_home = os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))
        ws_skills = str(Path(hermes_home) / "workspace" / "skills")
    return Path(ws_skills) / "generated" / "skills.json"


def _parse_skill_frontmatter(content: str) -> dict:
    """Parse simple YAML frontmatter from SKILL.md."""
    import re as _re
    m = _re.match(r"^---\n(.*?)\n---", content, _re.DOTALL)
    if not m:
        return {}
    result: dict = {}
    current_key = ""
    for line in m.group(1).split("\n"):
        kv = _re.match(r"^(\w[\w-]*):\s*(.*)", line)
        if kv:
            current_key = kv.group(1)
            val = kv.group(2).strip()
            result[current_key] = "" if val == "|" else val
        elif current_key and line.startswith("  "):
            prev = result.get(current_key, "")
            result[current_key] = (prev + "\n" + line.strip()).strip()
    return result


def _read_skills_from_dirs() -> dict:
    """Read skills from $ROOT_SKILLS or $HERMES_HOME/skills/ directories."""
    import re as _re
    root_skills = os.environ.get("ROOT_SKILLS", "")
    if not root_skills:
        root_skills = str(_hermes_home() / "skills")
    root = Path(root_skills)
    skills: list[dict] = []
    try:
        for d in sorted(root.iterdir()):
            if not d.is_dir():
                continue
            skill_md = d / "SKILL.md"
            if not skill_md.is_file():
                continue
            try:
                raw = skill_md.read_text()
                fm = _parse_skill_frontmatter(raw)
                body = _re.sub(r"^---.*?---\n*", "", raw, flags=_re.DOTALL)
                skills.append({
                    "slug": d.name,
                    "agentName": fm.get("name", d.name),
                    "description": fm.get("description", ""),
                    "emoji": fm.get("emoji", ""),
                    "category": fm.get("category", ""),
                    "prompt": body,
                    "tools": [t.strip() for t in fm.get("tools", "").split(",") if t.strip()],
                })
            except Exception:
                pass
    except Exception:
        pass
    return {"active": None, "skills": skills}


def _read_skill_by_slug(slug: str) -> dict | None:
    """Read skills.json and return a single skill by slug."""
    data = _read_skills_data()
    skills = data.get("skills", [])
    if not isinstance(skills, list):
        return None
    return next((s for s in skills if s.get("slug") == slug), None)


def _read_skills_data() -> dict:
    """Read the full skills.json, falling back to skill directories."""
    try:
        data = json.loads(_skills_data_path().read_text())
        if isinstance(data.get("skills"), list) and data["skills"]:
            return data
    except Exception:
        pass
    # Fallback: read SKILL.md from each skill directory
    from_dirs = _read_skills_from_dirs()
    return from_dirs if from_dirs["skills"] else {"active": None, "skills": []}


@router.get("/web-tools/skills")
@router.get("/web-tools/skills/")
async def skills_page():
    return _serve_html_with_token(_SHARED_ROOT / "index.html")


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


# ── Trajectories / logs ──────────────────────────────────────


def _hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))


def _sharing_enabled() -> bool:
    return (_hermes_home() / ".share-trajectories").exists()


def _read_trajectory_jsonl(file_path: Path, max_entries: int = 200) -> list[dict]:
    """Read a JSONL trajectory file, return most-recent-first."""
    entries: list[dict] = []
    if not file_path.exists():
        return entries
    try:
        for line in file_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except Exception:
        return entries
    entries.reverse()
    return entries[:max_entries]


@router.get("/web-tools/logs")
@router.get("/web-tools/logs/")
async def trajectories_page():
    return _serve_html_with_token(_SHARED_ROOT / "index.html")


@router.get("/web-tools/logs/api")
async def trajectories_api():
    """Return trajectory entries if sharing is enabled."""
    if not _sharing_enabled():
        return Response(
            content=json.dumps({"error": "sharing not enabled"}),
            status_code=403,
            media_type="application/json",
        )
    home = _hermes_home()
    entries = _read_trajectory_jsonl(home / "trajectory_samples.jsonl")
    failed = _read_trajectory_jsonl(home / "failed_trajectories.jsonl")
    all_entries = [e for e in entries + failed if isinstance(e, dict)]
    # Sort by timestamp descending
    all_entries.sort(key=lambda e: e.get("timestamp") or "", reverse=True)
    return Response(
        content=json.dumps({"runtime": "hermes", "entries": all_entries[:200]}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/web-tools/logs/download")
async def trajectories_download():
    """Download raw JSONL files as a zip."""
    if not _sharing_enabled():
        return Response(status_code=403)
    home = _hermes_home()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ("trajectory_samples.jsonl", "failed_trajectories.jsonl"):
            path = home / name
            if path.exists() and path.stat().st_size > 0:
                zf.write(path, name)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=trajectories.zip",
            "Cache-Control": "no-store",
        },
    )


