"""
FastAPI server implementing the pool manager HTTP API contract.

Every endpoint matches the existing OpenClaw-based runtime so the pool
manager can provision, health-check, and control instances identically.

Uses ConvosAdapter for the message pipeline (eyes reaction, marker parsing,
response routing through xmtp_bridge).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from .agent_runner import warm_imports
from .config import RuntimeConfig
from ..convos.convos_adapter import ConvosAdapter
from .credentials import clear_credentials, load_credentials, save_credentials
from .identity import ensure_workspace, write_instructions

DEFAULT_AGENT_NAME = os.environ.get("DEFAULT_AGENT_NAME", "Assistant")
from ..convos.xmtp_bridge import ConvosInstance
from .stats import stats

logger = logging.getLogger(__name__)

# ---- Runtime version (read once at import) ----
# Anchor-based resolution — no parent-counting.  See paths.py.
from .paths import HERMES_ROOT, PLATFORM_ROOT

try:
    _candidates = [
        PLATFORM_ROOT / "package.json",           # runtime/package.json (local dev)
        HERMES_ROOT / "runtime-version.json",      # /app/runtime-version.json (Docker)
    ]
    RUNTIME_VERSION = None
    for _pkg in _candidates:
        if _pkg.exists():
            RUNTIME_VERSION = json.loads(_pkg.read_text()).get("version")
            if RUNTIME_VERSION:
                logger.info("Runtime version %s from %s", RUNTIME_VERSION, _pkg)
                break
    if not RUNTIME_VERSION:
        logger.warning("Could not resolve runtime version from: %s", [str(p) for p in _candidates])
except Exception:
    RUNTIME_VERSION = None

# ---- Module-level state ----

_config: RuntimeConfig | None = None
_adapter: ConvosAdapter | None = None

# Provision state tracking (replaces the old 3-endpoint setup flow)
_provision_state: dict | None = None  # {state, startedAt, inviteUrl, watching, lastError}
_provision_generation: int = 0
_pending_join_task: asyncio.Task | None = None


def get_config() -> RuntimeConfig:
    assert _config is not None
    return _config


def get_adapter() -> ConvosAdapter | None:
    return _adapter


# ---- Auth ----

async def require_auth(request: Request) -> None:
    cfg = get_config()
    if not cfg.gateway_token:
        return
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {cfg.gateway_token}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---- Instance lifecycle ----


# Webhooks handle email/SMS — no cronjob needed.


async def start_wired_instance(
    *,
    conversation_id: str,
    identity_id: str,
    env: str,
    name: str | None = None,
    debug: bool = False,
    resuming: bool = False,
):
    """Create and start a ConvosAdapter with full message pipeline.

    Returns the ReadyEvent from agent serve (contains the fresh invite URL).
    """
    global _adapter
    cfg = get_config()

    ensure_workspace(cfg.workspace_dir)

    # Persist credentials before starting so a mid-startup crash still allows resume
    save_credentials(cfg.hermes_home, {
        "identityId": identity_id,
        "conversationId": conversation_id,
        "env": env,
    })

    # Clear previous session state when provisioning a NEW conversation
    # (matches OpenClaw's startWiredInstance behavior). On resume we keep it.
    if not resuming:
        _clear_session_state(cfg.hermes_home)

    adapter = ConvosAdapter(cfg)
    ready_info = await adapter.start(
        conversation_id=conversation_id,
        env=env,
        name=name,
        identity_id=identity_id,
        debug=debug,
    )
    _adapter = adapter

    if cfg.posthog_api_key and cfg.instance_id:
        cron_jobs_file = os.path.join(cfg.hermes_home, "cron", "jobs.json")
        skills_dir = os.environ.get("SKILLS_ROOT", os.path.join(cfg.hermes_home, "skills"))
        stats.start(
            posthog_api_key=cfg.posthog_api_key,
            posthog_host=cfg.posthog_host,
            instance_id=cfg.instance_id,
            agent_name=name or "",
            runtime="hermes",
            environment=os.environ.get("POOL_ENVIRONMENT", ""),
            version=RUNTIME_VERSION or "",
            cron_jobs_file=cron_jobs_file,
            skills_dir=skills_dir,
        )

    # Fire greeting in background (skip if resuming — caller handles workspace refresh).
    # The adapter gates _process_message behind greeting_done so early inbound
    # messages queue until the greeting populates history.
    if not resuming:
        asyncio.create_task(_dispatch_greeting(adapter))
    else:
        adapter._greeting_done.set()

    return ready_info


def _clear_session_state(hermes_home: str) -> None:
    """Clear session state so the agent starts fresh for a new conversation."""
    sessions_dir = Path(hermes_home) / "sessions"
    if sessions_dir.exists():
        try:
            shutil.rmtree(sessions_dir)
            sessions_dir.mkdir(parents=True, exist_ok=True)
            logger.info("Cleared session state for new conversation")
        except Exception as err:
            logger.error("Failed to clear session state: %s", err)


def _has_active_skill() -> bool:
    """Check if the agent has an active skill configured."""
    skills_root = os.environ.get("SKILLS_ROOT", "")
    if not skills_root:
        return False
    skills_json = Path(skills_root) / "generated" / "skills.json"
    try:
        data = json.loads(skills_json.read_text())
        return bool(data.get("active"))
    except Exception:
        return False


async def _dispatch_greeting(adapter: ConvosAdapter) -> None:
    """Send an LLM-generated welcome message via the adapter pipeline.

    Signals adapter._greeting_done when complete so queued inbound
    messages can proceed with the greeting already in history.
    """
    try:
        if not adapter.agent or not adapter.instance:
            return

        skill_active = _has_active_skill()

        # Phase 1: greeting — unconditional. AGENTS-base.md handles both paths
        # (active skill → THE ENTRANCE, no skill → ask what the group needs).
        greeting_content = (
            "[System: You just joined this conversation. Send your welcome message now. "
            "Follow the 'Welcome message' section in AGENTS.md.]"
        )

        logger.info("Dispatching greeting (skill-active=%s)", skill_active)
        response = await adapter.agent.handle_message(
            content=greeting_content,
            sender_name="System",
            sender_id="system",
            timestamp=time.time(),
            conversation_id=adapter.instance.conversation_id,
            message_id="system-greeting",
            group_members=adapter.instance.get_group_members(),
        )
        if response:
            await adapter._dispatch_response(response)

        # Phase 2: skill-builder kickoff — only if no active skill.
        # Fires after the greeting is already delivered to the conversation.
        if not skill_active:
            logger.info("Dispatching skill-builder kickoff (silent)")
            # Response is intentionally discarded — the agent reads the skill
            # into context but should not send anything to the conversation.
            await adapter.agent.handle_message(
                content=(
                    "[System: Read your skill-builder skill at $SKILLS_ROOT/skill-builder/SKILL.md now. "
                    "You already asked the group what they need — when they respond, follow the skill from step 1.]"
                ),
                sender_name="System",
                sender_id="system",
                timestamp=time.time(),
                conversation_id=adapter.instance.conversation_id,
                message_id="system-skill-builder",
                group_members=adapter.instance.get_group_members(),
            )
    except Exception as err:
        logger.error(f"Greeting dispatch failed: {err}")
    finally:
        adapter._greeting_done.set()


async def _try_resume_from_credentials(cfg: RuntimeConfig) -> None:
    """Check for saved credentials and auto-resume the conversation."""
    creds = load_credentials(cfg.hermes_home)
    if not creds:
        return

    logger.info(
        "Found saved credentials — resuming conversation %s",
        creds["conversationId"][:12],
    )

    try:
        await start_wired_instance(
            conversation_id=creds["conversationId"],
            identity_id=creds["identityId"],
            env=creds["env"],
            debug=True,
            resuming=True,
        )
        # No workspace refresh needed — AgentRunner re-reads SOUL.md/AGENTS.md at init
        logger.info("Resumed conversation successfully")
    except Exception as err:
        logger.error("Failed to resume from saved credentials: %s", err)
        # Don't clear credentials on transient failure — next restart can retry


# ---- Provision state ----

CUSTOM_INSTRUCTIONS_MARKER = "## Custom Instructions"
PENDING_JOIN_TIMEOUT_SECONDS = 24 * 60 * 60
PENDING_JOIN_MAX_RETRIES = 30


def _set_provision_state(
    state: str,
    *,
    started_at: str | None = None,
    invite_url: str | None = None,
    watching: bool = False,
    last_error: str | None = None,
) -> int:
    global _provision_state, _provision_generation
    _provision_generation += 1
    _provision_state = {
        "state": state,
        "startedAt": started_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "inviteUrl": invite_url,
        "watching": watching,
        "lastError": last_error,
    }
    return _provision_generation


def _clear_provision_state(generation: int | None = None) -> None:
    global _provision_state, _provision_generation, _pending_join_task
    if generation is not None and generation != _provision_generation:
        return
    _provision_generation += 1
    _provision_state = None
    _pending_join_task = None


def _get_provision_status() -> dict:
    adapter = get_adapter()
    if adapter and adapter.instance:
        return {"state": "active", "startedAt": None, "inviteUrl": None, "watching": False, "lastError": None}
    if _provision_state:
        return _provision_state
    return {"state": "idle", "startedAt": None, "inviteUrl": None, "watching": False, "lastError": None}


def _path_has_state(target: Path) -> bool:
    try:
        if target.is_dir():
            return any(target.iterdir())
        return target.stat().st_size > 0
    except (OSError, StopIteration):
        return False


def _has_custom_instructions(hermes_home: str) -> bool:
    soul_path = Path(hermes_home) / "SOUL.md"
    try:
        return CUSTOM_INSTRUCTIONS_MARKER in soul_path.read_text()
    except Exception:
        return False


def _clear_custom_instructions(hermes_home: str) -> bool:
    soul_path = Path(hermes_home) / "SOUL.md"
    try:
        content = soul_path.read_text()
    except Exception:
        return False
    idx = content.find(CUSTOM_INSTRUCTIONS_MARKER)
    if idx == -1:
        return False
    import re
    base = re.sub(r"\n---\s*\n*$", "", content[:idx]).rstrip()
    try:
        if base:
            soul_path.write_text(f"{base}\n")
        else:
            soul_path.unlink(missing_ok=True)
    except (PermissionError, OSError) as err:
        logger.warning("Failed to clear custom instructions: %s", err)
        return False
    logger.info("Cleared custom instructions from SOUL.md")
    return True


def _is_clean() -> bool:
    cfg = get_config()
    hermes_home = cfg.hermes_home
    if get_adapter() and get_adapter().instance:
        return False
    if load_credentials(hermes_home):
        return False
    if _has_custom_instructions(hermes_home):
        return False
    if _path_has_state(Path.home() / ".convos" / "identities"):
        return False
    if _path_has_state(Path.home() / ".convos" / "db"):
        return False
    if _path_has_state(Path(hermes_home) / "sessions"):
        return False
    if _path_has_state(Path(hermes_home) / "media"):
        return False
    if _path_has_state(Path(hermes_home) / "state.db"):
        return False
    if _path_has_state(Path(hermes_home) / "profile-image"):
        return False
    if os.environ.get("CONVOS_CONVERSATION_ID", "").strip():
        return False
    provision = _get_provision_status()
    if provision["state"] != "idle":
        return False
    return True


def _build_runtime_status() -> dict:
    adapter = get_adapter()
    conversation_id = adapter.instance.conversation_id if adapter and adapter.instance else None
    # After a process restart the in-memory adapter is gone but credentials
    # are persisted on disk.  Fall back so the pool manager can match the
    # conversation and recover the instance to "claimed".
    if not conversation_id:
        cfg = get_config()
        creds = load_credentials(cfg.hermes_home)
        if creds:
            conversation_id = creds["conversationId"]
    provision = _get_provision_status()
    return {
        "conversationId": conversation_id,
        "inboxId": adapter.instance.inbox_id if adapter and adapter.instance else None,
        "pending": provision["state"] == "pending_acceptance",
        "clean": _is_clean(),
    }


async def _factory_reset() -> dict:
    """Full factory reset: stop adapter, clear all state, return post-reset status."""
    global _adapter, _pending_join_task
    cfg = get_config()
    hermes_home = cfg.hermes_home
    logger.info("Factory reset started (hermes_home=%s)", hermes_home)

    # 1. Cancel pending join
    if _pending_join_task and not _pending_join_task.done():
        _pending_join_task.cancel()
        try:
            await _pending_join_task
        except (asyncio.CancelledError, Exception):
            pass
    _pending_join_task = None
    _clear_provision_state()

    # 2. Stop adapter
    adapter = get_adapter()
    if adapter:
        try:
            await adapter.stop()
        except Exception as err:
            logger.error("Error stopping adapter during reset: %s", err)
        _adapter = None

    # 3. Clear credentials
    clear_credentials(hermes_home)

    # 5. Clear custom instructions
    _clear_custom_instructions(hermes_home)

    # 6. Clear session state
    for d in ("sessions",):
        target = Path(hermes_home) / d
        shutil.rmtree(target, ignore_errors=True)

    # 7. Clear session DB
    state_db = Path(hermes_home) / "state.db"
    state_db.unlink(missing_ok=True)

    # 8. Clear media + profile image cache
    for d in ("media", "profile-image"):
        target = Path(hermes_home) / d
        shutil.rmtree(target, ignore_errors=True)

    # 8b. Clear trajectory files and sharing flag
    for f in ("trajectory_samples.jsonl", "failed_trajectories.jsonl", ".share-trajectories"):
        target = Path(hermes_home) / f
        target.unlink(missing_ok=True)

    # 8c. Clear generated skills data so the next boot enters skill-builder onboarding
    skills_root = os.environ.get("SKILLS_ROOT", os.path.join(hermes_home, "skills"))
    shutil.rmtree(Path(skills_root) / "generated", ignore_errors=True)

    # 9. Clear XMTP CLI identity
    convos_home = Path.home() / ".convos"
    for entry in ("identities", "db"):
        target = convos_home / entry
        shutil.rmtree(target, ignore_errors=True)

    # 10. Clear env
    os.environ.pop("CONVOS_CONVERSATION_ID", None)

    status = _build_runtime_status()
    logger.info("Factory reset complete (clean=%s)", status.get("clean"))
    return {"ok": True, "reset": True, "status": status}


async def _notify_pool_pending_join(event: str, *, conversation_id: str | None = None, error: str | None = None) -> None:
    """Callback to the pool manager when a pending join resolves."""
    pool_url = os.environ.get("POOL_URL", "")
    instance_id = os.environ.get("INSTANCE_ID", "")
    gateway_token = os.environ.get("GATEWAY_TOKEN", "")
    if not pool_url or not instance_id or not gateway_token:
        return

    endpoint = f"{pool_url}/api/pool/pending-acceptance/{'complete' if event == 'claimed' else 'fail'}"
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(endpoint, json={
                "instanceId": instance_id,
                "gatewayToken": gateway_token,
                "conversationId": conversation_id,
                "error": error,
            })
    except Exception as err:
        logger.warning("Pending join pool callback failed: %s", err)


async def _fetch_attestation(inbox_id: str) -> dict[str, str] | None:
    """Fetch a signed attestation from the pool manager."""
    pool_url = os.environ.get("POOL_URL")
    instance_id = os.environ.get("INSTANCE_ID")
    gateway_token = os.environ.get("GATEWAY_TOKEN")
    if not pool_url or not instance_id or not gateway_token:
        logger.warning("Cannot fetch attestation: missing POOL_URL, INSTANCE_ID, or GATEWAY_TOKEN")
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{pool_url}/api/pool/attest",
                json={"instanceId": instance_id, "gatewayToken": gateway_token, "inboxId": inbox_id},
            )
            if resp.status_code != 200:
                logger.error("Attestation request failed: %d %s", resp.status_code, resp.text[:200])
                return None
            return resp.json()
    except Exception as err:
        logger.error("Attestation request error: %s", err)
        return None


async def _apply_attestation() -> None:
    """Fetch attestation from pool and push to running instance."""
    adapter = get_adapter()
    if not adapter or not adapter.instance or not adapter.instance.inbox_id:
        return
    att = await _fetch_attestation(adapter.instance.inbox_id)
    if not att:
        return
    if not all(k in att for k in ("attestation", "attestation_ts", "attestation_kid")):
        logger.warning("Attestation response missing required fields: %s", list(att.keys()))
        return
    # Store for subprocess restarts
    adapter.instance.set_attestation(att["attestation"], att["attestation_ts"], att["attestation_kid"])
    # Push to running agent serve process
    await adapter.instance.update_profile(metadata={
        "attestation": att["attestation"],
        "attestation_ts": att["attestation_ts"],
        "attestation_kid": att["attestation_kid"],
    })
    logger.info("Attestation signed for %s...", adapter.instance.inbox_id[:12])


async def _watch_pending_join(invite_url: str, generation: int, cfg: RuntimeConfig) -> None:
    """Background task that retries joining until accepted or timed out."""
    env = cfg.xmtp_env
    deadline = time.time() + PENDING_JOIN_TIMEOUT_SECONDS
    attempt = 0
    while time.time() < deadline and attempt < PENDING_JOIN_MAX_RETRIES:
        attempt += 1
        await asyncio.sleep(min(15 * attempt, 120))  # backoff: 15s, 30s, 45s, ... 120s max
        if generation != _provision_generation:
            return  # cancelled or superseded

        try:
            inst, status, conversation_id = await ConvosInstance.join_conversation(
                env, invite_url, profile_name=DEFAULT_AGENT_NAME, timeout=30, debug=True,
            )
            if status == "joined" and conversation_id and inst:
                if generation != _provision_generation:
                    return  # superseded before we could wire up
                await start_wired_instance(
                    conversation_id=conversation_id,
                    identity_id=inst.identity_id,
                    env=env,
                    debug=True,
                )
                _clear_provision_state(generation)
                await _apply_attestation()
                await _notify_pool_pending_join("claimed", conversation_id=conversation_id)
                logger.info("Pending join accepted: conversation %s", conversation_id[:12])
                return
            if status == "pending":
                logger.info("Pending join retry %d: already joined, waiting for acceptance", attempt)
                continue
        except Exception as err:
            logger.warning("Pending join retry %d failed: %s", attempt, err)

    # Timed out or exhausted retries
    if generation == _provision_generation:
        reason = f"Join exhausted {attempt} retries" if attempt >= PENDING_JOIN_MAX_RETRIES else "Join timed out"
        _set_provision_state("failed", invite_url=invite_url, last_error=reason)
        await _notify_pool_pending_join("tainted", error=reason)


# ---- Pydantic models ----


class ConversationRequest(BaseModel):
    name: str = DEFAULT_AGENT_NAME
    profileName: str | None = None
    profileImage: str | None = None
    description: str | None = None
    imageUrl: str | None = None
    permissions: str | None = None
    accountId: str | None = None
    instructions: str | None = None
    env: str | None = None


class JoinRequest(BaseModel):
    inviteUrl: str
    profileName: str = DEFAULT_AGENT_NAME
    profileImage: str | None = None
    metadata: dict[str, str] | None = None
    accountId: str | None = None
    instructions: str | None = None
    env: str | None = None


class SendRequest(BaseModel):
    message: str


class RenameRequest(BaseModel):
    name: str


class LockRequest(BaseModel):
    unlock: bool = False


# ---- Cron seeding & delivery ----

_SEED_JOBS = [
    {
        "id": "seed-morning-checkin",
        "prompt": (
            "Morning check-in: check for open threads, pending action items, "
            "or upcoming plans. If you find something concrete, send one sentence "
            "referencing it to the group. If there's nothing real to reference, "
            "stay silent. Never send a message just to start a conversation, "
            "ask if anyone needs help, or say good morning without a reason."
        ),
        "schedule": "0 8 * * *",
        "name": "Morning check-in",
        "deliver": "convos",
    },
]


def _seed_cron_jobs() -> None:
    """Seed default cron jobs if they don't already exist.

    Also recomputes next_run_at for existing seeds so a timezone change
    in config.yaml takes effect immediately instead of firing at the
    stale UTC-based time first.
    """
    try:
        from cron.jobs import load_jobs, create_job, save_jobs, compute_next_run
    except ImportError:
        logger.debug("Cron module not available — skipping seed")
        return

    existing = {j["id"]: j for j in load_jobs()}
    for seed in _SEED_JOBS:
        if seed["id"] in existing:
            # Refresh next_run_at so timezone changes take effect immediately.
            job = existing[seed["id"]]
            if job.get("enabled", True) and job.get("schedule"):
                new_next = compute_next_run(job["schedule"], job.get("last_run_at"))
                if new_next and new_next != job.get("next_run_at"):
                    jobs = load_jobs()
                    for j in jobs:
                        if j["id"] == seed["id"]:
                            j["next_run_at"] = new_next
                            break
                    save_jobs(jobs)
                    logger.info("Refreshed next_run_at for '%s': %s", seed["id"], new_next)
            continue
        job = create_job(
            prompt=seed["prompt"],
            schedule=seed["schedule"],
            name=seed["name"],
            deliver=seed.get("deliver", "origin"),
        )
        # Overwrite the random ID with the stable seed ID
        jobs = load_jobs()
        for j in jobs:
            if j["id"] == job["id"]:
                j["id"] = seed["id"]
                break
        save_jobs(jobs)
        logger.info("Seeded cron job '%s'", seed["name"])


_cron_task: asyncio.Task | None = None
_event_loop: asyncio.AbstractEventLoop | None = None


def _patch_cron_for_convos() -> None:
    """Monkey-patch the Hermes cron scheduler for Convos integration.

    Two patches:

    1. run_job — convos-targeted jobs fire into the main AgentRunner
       session (same pattern as /convos/notify) instead of creating a
       standalone agent.  The agent sees full conversation history and
       can decide whether to respond or stay silent.

    2. _deliver_result — no-op for convos jobs because delivery already
       happened through _dispatch_response in the run_job patch.
       Non-convos jobs use the original delivery.
    """
    try:
        import cron.scheduler as cron_mod
    except ImportError:
        logger.debug("Cron module not available — skipping convos patches")
        return

    _original_run_job = cron_mod.run_job

    def _is_convos_targeted(job: dict) -> bool:
        deliver = job.get("deliver", "local")
        if deliver == "origin":
            origin = cron_mod._resolve_origin(job)
            return bool(origin and origin.get("platform") == "convos")
        if ":" in deliver:
            return deliver.split(":", 1)[0] == "convos"
        return deliver == "convos"

    def _patched_run_job(job: dict) -> tuple:
        if not _is_convos_targeted(job):
            return _original_run_job(job)

        # Wake the main session instead of creating a standalone agent.
        # Same pattern as the /convos/notify endpoint.
        adapter = get_adapter()
        if not adapter or not adapter.instance or not adapter.agent:
            error = "No active conversation — adapter/agent not ready"
            logger.warning("Cron job '%s': %s", job.get("name", job["id"]), error)
            output = f"# Cron Job: {job.get('name', job['id'])} (FAILED)\n\n## Error\n\n{error}"
            return (False, output, "", error)

        loop = _event_loop
        if not loop or loop.is_closed():
            error = "No event loop for convos dispatch"
            logger.error("Cron job '%s': %s", job.get("name", job["id"]), error)
            output = f"# Cron Job: {job.get('name', job['id'])} (FAILED)\n\n## Error\n\n{error}"
            return (False, output, "", error)

        job_id = job["id"]
        job_name = job.get("name", job_id)
        prompt = job["prompt"]

        async def _wake_main_session() -> str | None:
            await adapter._greeting_done.wait()
            response = await adapter.agent.handle_message(
                content=prompt,
                sender_name="System",
                sender_id="system",
                timestamp=time.time(),
                conversation_id=adapter.instance.conversation_id,
                message_id=f"cron-{job_id}-{int(time.time() * 1000)}",
                group_members=adapter.instance.get_group_members(),
            )
            if response:
                await adapter._dispatch_response(response)
            return response

        future = None
        try:
            future = asyncio.run_coroutine_threadsafe(_wake_main_session(), loop)
            response = future.result(timeout=120)
        except Exception as e:
            if future is not None:
                future.cancel()
            error = f"{type(e).__name__}: {e}"
            output = f"# Cron Job: {job_name} (FAILED)\n\n## Error\n\n{error}"
            logger.error("Cron job '%s': wake failed: %s", job_name, error)
            return (False, output, "", error)

        # handle_message returns friendly error strings on internal failures
        # (credit exhaustion, agent errors).  Detect these so mark_job_run
        # records an error instead of false-positive success.
        _ERROR_SENTINELS = ("I encountered an error", "I hit a temporary issue")
        if response and any(response.startswith(s) for s in _ERROR_SENTINELS):
            output = f"# Cron Job: {job_name} (FAILED)\n\n## Error\n\n{response}"
            logger.warning("Cron job '%s': agent returned error response", job_name)
            return (False, output, "", response)

        final = response or "(silent)"
        output = f"# Cron Job: {job_name}\n\n## Response\n\n{final}"
        logger.info("Cron job '%s': woke main session", job_name)
        return (True, output, final, None)

    cron_mod.run_job = _patched_run_job
    logger.info("Patched cron run_job to wake main session")

    # -- Delivery: no-op for convos (already dispatched above) -------------

    original_deliver = cron_mod._deliver_result

    def _patched_deliver(job: dict, content: str) -> None:
        if _is_convos_targeted(job):
            return  # Already delivered through _dispatch_response in run_job
        original_deliver(job, content)

    cron_mod._deliver_result = _patched_deliver
    logger.info("Patched cron delivery for convos platform")


_cron_credit_error_notified = False


async def _cron_check_credit_errors() -> None:
    """After a cron tick, check if any jobs failed due to credit exhaustion.

    Sends a one-shot credit top-up message to the user.  Resets when a
    job succeeds again (meaning credits were restored).
    """
    global _cron_credit_error_notified
    try:
        from cron.jobs import load_jobs
        from .outbound_policy import _is_credit_error, _build_credit_message

        jobs = load_jobs()
        any_credit_error = False
        any_success = False
        for job in jobs:
            if job.get("last_status") == "error" and _is_credit_error(job.get("last_error", "")):
                any_credit_error = True
            if job.get("last_status") == "ok":
                any_success = True

        # Reset the flag only when credits are restored (success AND no credit errors)
        if any_success and not any_credit_error:
            _cron_credit_error_notified = False

        if any_credit_error and not _cron_credit_error_notified:
            adapter = get_adapter()
            if adapter and adapter.instance:
                await adapter.send_message(_build_credit_message())
                _cron_credit_error_notified = True
                logger.info("Sent credit exhaustion notification to user (cron)")
    except ImportError:
        pass
    except Exception as err:
        logger.debug("Cron credit check failed: %s", err)


async def _cron_tick_loop() -> None:
    """Run the Hermes cron scheduler periodically.

    Jobs are stored in HERMES_HOME/cron/jobs.json. The tick() function
    checks for due jobs, runs them, and saves output. Delivery to the
    active Convos conversation is routed through the adapter via the
    monkey-patched _deliver_result.

    In eval mode the interval is 15s so cron tests don't need to wait
    a full minute for the first tick.
    """
    interval = 15 if os.environ.get("EVAL_MODE") == "1" else 60
    while True:
        await asyncio.sleep(interval)
        try:
            from cron.scheduler import tick
            loop = asyncio.get_event_loop()
            ran = await loop.run_in_executor(None, tick, False)
            if ran:
                logger.info("Cron tick: %d job(s) executed", ran)
                await _cron_check_credit_errors()
        except ImportError:
            logger.debug("Cron module not available — skipping tick")
            return
        except Exception as err:
            logger.error("Cron tick error: %s", err)


# ---- App ----

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _config, _cron_task, _event_loop
    _config = RuntimeConfig.from_env()
    errors = _config.validate()
    if errors:
        for e in errors:
            logger.error(e)
        raise RuntimeError(f"Config validation failed: {'; '.join(errors)}")
    ensure_workspace(_config.workspace_dir)
    # Ungate cron tools — Hermes gates them behind a "gateway or CLI" env var,
    # but we run our own tick loop (see _cron_tick_loop below).
    os.environ.setdefault("HERMES_GATEWAY_SESSION", "1")
    warm_imports()
    _event_loop = asyncio.get_event_loop()
    _patch_cron_for_convos()
    _seed_cron_jobs()
    _cron_task = asyncio.create_task(_cron_tick_loop())
    logger.info(f"Hermes runtime starting (model={_config.model}, port={_config.port})")

    # Auto-resume from saved credentials (if any)
    await _try_resume_from_credentials(_config)

    yield
    if _cron_task:
        _cron_task.cancel()
        try:
            await _cron_task
        except asyncio.CancelledError:
            pass
    if _pending_join_task and not _pending_join_task.done():
        _pending_join_task.cancel()
        try:
            await _pending_join_task
        except (asyncio.CancelledError, Exception):
            pass
    await stats.shutdown()
    adapter = get_adapter()
    if adapter:
        try:
            await adapter.stop()
        except Exception:
            pass


app = FastAPI(title="Convos Hermes Runtime", lifespan=lifespan)

from .web_tools import router as web_tools_router
app.include_router(web_tools_router)


# ---- Health ----

@app.get("/health")
async def health():
    return {"ok": True}


# ---- /convos/status ----

@app.get("/convos/status", dependencies=[Depends(require_auth)])
async def convos_status():
    return _build_runtime_status()


# ---- /convos/conversation (create) ----

@app.post("/convos/conversation", dependencies=[Depends(require_auth)])
async def convos_conversation(body: ConversationRequest):
    if get_adapter() and get_adapter().instance:
        raise HTTPException(
            status_code=409,
            detail="Instance already bound to a conversation.",
        )

    cfg = get_config()
    env = body.env if body.env in ("dev", "production") else cfg.xmtp_env

    if body.instructions:
        write_instructions(cfg.hermes_home, body.instructions)

    profile_name = body.profileName or body.name

    try:
        inst, result = await ConvosInstance.create_conversation(
            env,
            name=body.name,
            profile_name=profile_name,
            description=body.description,
            image_url=body.imageUrl,
            permissions=body.permissions,
            debug=True,
        )

        ready_info = await start_wired_instance(
            conversation_id=result["conversationId"],
            identity_id=inst.identity_id,
            env=env,
            name=body.name,
            debug=True,
        )
        await _apply_attestation()

        return {
            "conversationId": result["conversationId"],
            "inviteUrl": ready_info.invite_url or result["inviteUrl"],
            "inviteSlug": ready_info.invite_slug or result["inviteSlug"],
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/join ----

@app.post("/convos/join", dependencies=[Depends(require_auth)])
async def convos_join(body: JoinRequest):
    if get_adapter() and get_adapter().instance:
        raise HTTPException(
            status_code=409,
            detail="Instance already bound to a conversation.",
        )

    cfg = get_config()
    env = body.env if body.env in ("dev", "production") else cfg.xmtp_env

    if body.instructions:
        write_instructions(cfg.hermes_home, body.instructions)

    instance_id = os.environ.get("INSTANCE_ID")
    join_meta = {**(body.metadata or {}), **({"instanceId": instance_id} if instance_id else {})} or None

    try:
        inst, status, conversation_id = await ConvosInstance.join_conversation(
            env,
            body.inviteUrl,
            profile_name=body.profileName,
            profile_image=body.profileImage,
            metadata=join_meta,
            timeout=60,
            debug=True,
        )

        if status != "joined" or not conversation_id or not inst:
            # Start background watcher to retry until accepted
            gen = _set_provision_state("pending_acceptance", invite_url=body.inviteUrl, watching=True)
            global _pending_join_task
            _pending_join_task = asyncio.create_task(
                _watch_pending_join(body.inviteUrl, gen, cfg)
            )
            return {"status": "pending_acceptance"}

        await start_wired_instance(
            conversation_id=conversation_id,
            identity_id=inst.identity_id,
            env=env,
            debug=True,
        )
        await _apply_attestation()

        return {"status": "joined", "conversationId": conversation_id}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/conversation/send ----

@app.post("/convos/conversation/send", dependencies=[Depends(require_auth)])
async def convos_send(body: SendRequest):
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        raise HTTPException(status_code=400, detail="No active conversation")

    try:
        await adapter.send_message(body.message)
        return {"ok": True}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/rename ----

@app.post("/convos/rename", dependencies=[Depends(require_auth)])
async def convos_rename(body: RenameRequest):
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        raise HTTPException(status_code=400, detail="No active conversation")

    try:
        await adapter.rename(body.name)
        return {"ok": True}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/update-metadata ----

class UpdateMetadataRequest(BaseModel):
    metadata: dict[str, str]


@app.post("/convos/update-metadata", dependencies=[Depends(require_auth)])
async def convos_update_metadata(body: UpdateMetadataRequest):
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        raise HTTPException(status_code=400, detail="No active conversation")

    try:
        await adapter.instance.update_profile(metadata=body.metadata)
        return {"ok": True}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/notify ----

class NotifyRequest(BaseModel):
    text: str


@app.post("/convos/notify", dependencies=[Depends(require_auth)])
async def convos_notify(body: NotifyRequest):
    """Dispatch a background notification as a synthetic system message.

    The agent responds over XMTP but the notification itself is invisible
    to the user (same pattern as the greeting dispatch).
    """
    adapter = get_adapter()
    if not adapter or not adapter.instance or not adapter.agent:
        raise HTTPException(status_code=400, detail="No active conversation")

    # Wait for greeting to complete so history order is preserved
    await adapter._greeting_done.wait()

    try:
        response = await adapter.agent.handle_message(
            content=body.text,
            sender_name="System",
            sender_id="system",
            timestamp=time.time(),
            conversation_id=adapter.instance.conversation_id,
            message_id=f"system-notify-{int(time.time() * 1000)}",
            group_members=adapter.instance.get_group_members(),
        )
        if response:
            await adapter._dispatch_response(response)
        return {"ok": True}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/re-attest ----

class ReattestRequest(BaseModel):
    attestation: str
    attestation_ts: str
    attestation_kid: str


@app.post("/convos/re-attest", dependencies=[Depends(require_auth)])
async def convos_reattest(body: ReattestRequest):
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        raise HTTPException(status_code=400, detail="No active conversation")
    try:
        adapter.instance.set_attestation(body.attestation, body.attestation_ts, body.attestation_kid)
        await adapter.instance.update_profile(metadata={
            "attestation": body.attestation,
            "attestation_ts": body.attestation_ts,
            "attestation_kid": body.attestation_kid,
        })
        return {"ok": True}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/lock ----

@app.post("/convos/lock", dependencies=[Depends(require_auth)])
async def convos_lock(body: LockRequest):
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        raise HTTPException(status_code=400, detail="No active conversation")

    try:
        if body.unlock:
            await adapter.unlock()
        else:
            await adapter.lock()
        return {"ok": True, "locked": not body.unlock}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/explode ----

@app.post("/convos/explode", dependencies=[Depends(require_auth)])
async def convos_explode():
    global _adapter
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        raise HTTPException(status_code=400, detail="No active conversation")

    try:
        await adapter.explode()
        await adapter.stop()
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))
    finally:
        _adapter = None
        clear_credentials(get_config().hermes_home)
    return {"ok": True, "exploded": True}


# ---- /convos/reset ----

@app.post("/convos/reset", dependencies=[Depends(require_auth)])
async def convos_reset():
    return await _factory_reset()


# ---- /agent/query and /agent/reset-history (eval surface) ----
# These mirror the minimal eval server so evals can attach to a live instance
# and route queries through the real production path.
# Falls back to a standalone AgentRunner when no conversation is provisioned
# (e.g. CI eval jobs that start the container without provisioning).

from .agent_runner import AgentRunner as _AgentRunner

_standalone_agent: _AgentRunner | None = None


def _get_eval_agent() -> _AgentRunner:
    """Return the adapter's agent if provisioned, otherwise a standalone runner."""
    adapter = get_adapter()
    if adapter and adapter.agent:
        return adapter.agent

    global _standalone_agent
    if _standalone_agent is None:
        cfg = get_config()
        _standalone_agent = _AgentRunner(
            model=cfg.model,
            hermes_home=cfg.hermes_home,
        )
    return _standalone_agent


class AgentQueryRequest(BaseModel):
    query: str
    session: str = "eval-session"


@app.post("/agent/query", dependencies=[Depends(require_auth)])
async def agent_query(body: AgentQueryRequest):
    agent = _get_eval_agent()
    response = await agent.handle_message(
        content=body.query,
        sender_name="user",
        sender_id="eval-user",
        timestamp=time.time(),
        conversation_id=body.session,
        message_id=f"eval-{int(time.time())}",
    )
    from starlette.responses import PlainTextResponse
    return PlainTextResponse(response or "")


@app.post("/agent/reset-history", dependencies=[Depends(require_auth)])
async def agent_reset_history():
    agent = _get_eval_agent()
    agent.reset_history()
    return {"ok": True}
