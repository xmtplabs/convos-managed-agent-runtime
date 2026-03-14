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
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from .agent_runner import warm_imports
from .config import RuntimeConfig
from .convos_adapter import ConvosAdapter
from .identity import ensure_workspace, write_instructions
from .xmtp_bridge import ConvosInstance

logger = logging.getLogger(__name__)

# ---- Runtime version (read once at import) ----
# Check runtime root package.json (source of truth), then Docker-injected copy, then local hermes.
try:
    _candidates = [
        Path(__file__).resolve().parent.parent.parent / "package.json",  # runtime/package.json (local dev)
        Path(__file__).resolve().parent.parent / "runtime-version.json",  # /app/runtime-version.json (Docker)
        Path(__file__).resolve().parent.parent / "package.json",          # hermes/package.json (fallback)
    ]
    RUNTIME_VERSION = None
    for _pkg in _candidates:
        if _pkg.exists():
            RUNTIME_VERSION = json.loads(_pkg.read_text()).get("version")
            if RUNTIME_VERSION:
                break
except Exception:
    RUNTIME_VERSION = None

# ---- Module-level state ----

_config: RuntimeConfig | None = None
_adapter: ConvosAdapter | None = None

# Setup flow state
_setup_instance: ConvosInstance | None = None
_setup_join_state = {"joined": False, "joinerInboxId": None}
_setup_result: dict | None = None
_setup_cleanup_task: asyncio.Task | None = None


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

async def start_wired_instance(
    *,
    conversation_id: str,
    identity_id: str,
    env: str,
    name: str | None = None,
    debug: bool = False,
):
    """Create and start a ConvosAdapter with full message pipeline.

    Returns the ReadyEvent from agent serve (contains the fresh invite URL).
    """
    global _adapter
    cfg = get_config()

    ensure_workspace(cfg.workspace_dir)

    adapter = ConvosAdapter(cfg)
    ready_info = await adapter.start(
        conversation_id=conversation_id,
        env=env,
        name=name,
        identity_id=identity_id,
        debug=debug,
    )
    _adapter = adapter

    # Fire greeting in background
    asyncio.create_task(_dispatch_greeting())

    return ready_info


async def _dispatch_greeting() -> None:
    """Send an LLM-generated welcome message via the adapter pipeline."""
    adapter = get_adapter()
    if not adapter or not adapter.agent or not adapter.instance:
        return

    try:
        response = await adapter.agent.handle_message(
            content=(
                "[System: You just joined this conversation. Send your welcome message now. "
                "Follow the 'Welcome message' section in AGENTS.md.]"
            ),
            sender_name="System",
            sender_id="system",
            timestamp=time.time(),
            conversation_id=adapter.instance.conversation_id,
            message_id="system-greeting",
            group_members=adapter.instance.get_group_members(),
        )
        if response:
            await adapter._dispatch_response(response)
    except Exception as err:
        logger.error(f"Greeting dispatch failed: {err}")


# ---- Setup flow ----

async def cleanup_setup_instance() -> None:
    global _setup_instance, _setup_result, _setup_cleanup_task
    if _setup_cleanup_task:
        _setup_cleanup_task.cancel()
        _setup_cleanup_task = None
    if _setup_instance:
        try:
            await _setup_instance.stop()
        except (Exception, asyncio.CancelledError):
            pass
        _setup_instance = None
    _setup_result = None


async def _setup_timeout() -> None:
    await asyncio.sleep(600)
    logger.info("Setup timeout — stopping setup instance")
    # Don't go through cleanup_setup_instance() which cancels our own task.
    global _setup_instance, _setup_result, _setup_cleanup_task
    _setup_cleanup_task = None
    if _setup_instance:
        try:
            await _setup_instance.stop()
        except Exception:
            pass
        _setup_instance = None
    _setup_result = None


# ---- Pydantic models ----

class SetupRequest(BaseModel):
    accountId: str | None = None
    env: str | None = None
    name: str | None = None
    force: bool = False


class ConversationRequest(BaseModel):
    name: str = "Convos Agent"
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
    profileName: str = "Convos Agent"
    profileImage: str | None = None
    accountId: str | None = None
    instructions: str | None = None
    env: str | None = None


class SendRequest(BaseModel):
    message: str


class RenameRequest(BaseModel):
    name: str


class LockRequest(BaseModel):
    unlock: bool = False


# ---- Cron delivery ----

_cron_task: asyncio.Task | None = None
_event_loop: asyncio.AbstractEventLoop | None = None


def _patch_cron_delivery() -> None:
    """Monkey-patch the Hermes cron scheduler to deliver to Convos.

    _deliver_result() has a platform_map that doesn't include "convos",
    so job output silently drops. This patch intercepts convos delivery
    and sends through our adapter.
    """
    try:
        import cron.scheduler as cron_mod
    except ImportError:
        logger.debug("Cron module not available — skipping delivery patch")
        return

    original_deliver = cron_mod._deliver_result

    def _patched_deliver(job: dict, content: str) -> None:
        deliver = job.get("deliver", "local")
        origin = cron_mod._resolve_origin(job)

        # Resolve platform name from deliver config
        if deliver == "origin" and origin:
            platform_name = origin["platform"]
        elif ":" in deliver:
            platform_name = deliver.split(":", 1)[0]
        else:
            platform_name = deliver

        if platform_name != "convos":
            return original_deliver(job, content)

        # Send through our adapter
        adapter = get_adapter()
        if not adapter or not adapter.instance:
            logger.warning("Cron job '%s': convos adapter not active, skipping delivery", job.get("name", job["id"]))
            return

        loop = _event_loop
        if not loop or loop.is_closed():
            logger.error("Cron job '%s': no event loop for convos delivery", job.get("name", job["id"]))
            return

        try:
            future = asyncio.run_coroutine_threadsafe(adapter.send_message(content), loop)
            future.result(timeout=30)
            logger.info("Cron job '%s': delivered to convos", job.get("name", job["id"]))
        except Exception as err:
            logger.error("Cron job '%s': convos delivery failed: %s", job.get("name", job["id"]), err)

    cron_mod._deliver_result = _patched_deliver
    logger.info("Patched cron delivery for convos platform")


async def _cron_tick_loop() -> None:
    """Run the Hermes cron scheduler every 60 seconds.

    Jobs are stored in HERMES_HOME/cron/jobs.json. The tick() function
    checks for due jobs, runs them, and saves output. Delivery to the
    active Convos conversation is routed through the adapter via the
    monkey-patched _deliver_result.
    """
    while True:
        await asyncio.sleep(60)
        try:
            from cron.scheduler import tick
            loop = asyncio.get_event_loop()
            ran = await loop.run_in_executor(None, tick, False)
            if ran:
                logger.info("Cron tick: %d job(s) executed", ran)
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
    warm_imports()
    _event_loop = asyncio.get_event_loop()
    _patch_cron_delivery()
    _cron_task = asyncio.create_task(_cron_tick_loop())
    logger.info(f"Hermes runtime starting (model={_config.model}, port={_config.port})")
    yield
    if _cron_task:
        _cron_task.cancel()
        try:
            await _cron_task
        except asyncio.CancelledError:
            pass
    try:
        adapter = get_adapter()
        if adapter:
            await adapter.stop()
    finally:
        await cleanup_setup_instance()


app = FastAPI(title="Convos Hermes Runtime", lifespan=lifespan)


# ---- Health ----

@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/pool/health")
async def pool_health():
    return {"ready": True, "version": RUNTIME_VERSION}


# ---- /pool/provision ----

class ProvisionRequest(BaseModel):
    agentName: str
    instructions: str = ""
    joinUrl: str | None = None


@app.post("/pool/provision", dependencies=[Depends(require_auth)])
async def pool_provision(body: ProvisionRequest):
    if get_adapter() and get_adapter().instance:
        raise HTTPException(
            status_code=409,
            detail="Instance already bound to a conversation.",
        )

    cfg = get_config()
    env = cfg.xmtp_env

    if body.instructions:
        write_instructions(cfg.hermes_home, body.instructions)

    try:
        if body.joinUrl:
            inst, status, conversation_id = await ConvosInstance.join_conversation(
                env,
                body.joinUrl,
                profile_name=body.agentName,
                timeout=60,
                debug=True,
            )
            if status != "joined" or not conversation_id or not inst:
                raise HTTPException(status_code=503, detail="Join not accepted yet")

            await start_wired_instance(
                conversation_id=conversation_id,
                identity_id=inst.identity_id,
                env=env,
                debug=True,
            )
            return {
                "ok": True,
                "conversationId": conversation_id,
                "inviteUrl": body.joinUrl,
                "joined": True,
            }
        else:
            inst, result = await ConvosInstance.create_conversation(
                env,
                name=body.agentName,
                profile_name=body.agentName,
                debug=True,
            )

            ready_info = await start_wired_instance(
                conversation_id=result["conversationId"],
                identity_id=inst.identity_id,
                env=env,
                name=body.agentName,
                debug=True,
            )

            return {
                "ok": True,
                "conversationId": result["conversationId"],
                "inviteUrl": ready_info.invite_url or result["inviteUrl"],
                "joined": False,
            }
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


# ---- /convos/status ----

@app.get("/convos/status", dependencies=[Depends(require_auth)])
async def convos_status():
    adapter = get_adapter()
    if not adapter or not adapter.instance:
        return {"ready": True, "conversation": None, "streaming": False}
    return {
        "ready": True,
        "conversation": {"id": adapter.instance.conversation_id},
        "streaming": adapter.instance.is_streaming(),
    }


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

    try:
        inst, status, conversation_id = await ConvosInstance.join_conversation(
            env,
            body.inviteUrl,
            profile_name=body.profileName,
            timeout=60,
            debug=True,
        )

        if status != "joined" or not conversation_id or not inst:
            return {"status": "waiting_for_acceptance"}

        await start_wired_instance(
            conversation_id=conversation_id,
            identity_id=inst.identity_id,
            env=env,
            debug=True,
        )

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
    return {"ok": True, "exploded": True}


# ---- /convos/reset ----

@app.post("/convos/reset", dependencies=[Depends(require_auth)])
async def convos_reset(body: SetupRequest | None = None):
    global _adapter
    adapter = get_adapter()
    identity_id = None
    if adapter:
        # Capture identity before stopping so we can delete the credential file
        if adapter.instance:
            identity_id = adapter.instance.identity_id
        try:
            await adapter.stop()
        except Exception as err:
            logger.error(f"Error stopping adapter during reset: {err}")
        _adapter = None

    os.environ.pop("CONVOS_CONVERSATION_ID", None)

    # Clear the XMTP identity so the next join creates a fresh one
    # (matches OpenClaw's clearConvosCredentials behavior)
    convos_dir = Path.home() / ".convos" / "identities"
    if identity_id:
        cred_file = convos_dir / f"{identity_id}.json"
        try:
            cred_file.unlink(missing_ok=True)
            logger.info(f"Cleared convos identity: {identity_id}")
        except Exception as err:
            logger.warning(f"Failed to clear convos identity {identity_id}: {err}")
    else:
        # No identity tracked — clear all identities as fallback
        if convos_dir.exists():
            for f in convos_dir.iterdir():
                if f.suffix == ".json":
                    try:
                        f.unlink()
                    except Exception:
                        pass
            logger.info("Cleared all convos identities (no specific identity tracked)")

    return {"ok": True, "message": "Instance reset. Identity cleared."}


# ---- /convos/setup ----

@app.post("/convos/setup", dependencies=[Depends(require_auth)])
async def convos_setup(body: SetupRequest):
    global _setup_instance, _setup_join_state, _setup_result, _setup_cleanup_task

    cfg = get_config()
    env = body.env if body.env in ("dev", "production") else cfg.xmtp_env

    if not body.force and _setup_instance and _setup_instance.is_running() and _setup_result:
        return {
            "inviteUrl": _setup_result.get("inviteUrl", ""),
            "conversationId": _setup_result.get("conversationId", ""),
        }

    await cleanup_setup_instance()
    _setup_join_state = {"joined": False, "joinerInboxId": None}

    async def _on_setup_member_joined(info: dict) -> None:
        _setup_join_state["joined"] = True
        _setup_join_state["joinerInboxId"] = info.get("joinerInboxId")
        logger.info(f"Setup join accepted: {info.get('joinerInboxId')}")

    try:
        inst, result = await ConvosInstance.create_conversation(
            env,
            name=body.name or "Convos Agent",
            on_member_joined=_on_setup_member_joined,
            debug=True,
        )

        _setup_instance = inst
        ready_info = await inst.start()

        invite_url = ready_info.invite_url or result["inviteUrl"]
        _setup_result = {
            "identityId": inst.identity_id,
            "conversationId": result["conversationId"],
            "inviteUrl": invite_url,
            "env": env,
        }

        _setup_cleanup_task = asyncio.create_task(_setup_timeout())

        return {
            "inviteUrl": invite_url,
            "conversationId": result["conversationId"],
        }
    except Exception as err:
        await cleanup_setup_instance()
        raise HTTPException(status_code=500, detail=str(err))


@app.get("/convos/setup/status", dependencies=[Depends(require_auth)])
async def convos_setup_status():
    return {
        "active": _setup_instance is not None,
        "joined": _setup_join_state["joined"],
        "joinerInboxId": _setup_join_state["joinerInboxId"],
    }


@app.post("/convos/setup/complete", dependencies=[Depends(require_auth)])
async def convos_setup_complete():
    global _setup_result

    if not _setup_result:
        raise HTTPException(status_code=400, detail="No active setup to complete. Run /convos/setup first.")

    if get_adapter() and get_adapter().instance:
        raise HTTPException(
            status_code=409,
            detail="Instance already bound to a conversation.",
        )

    saved = dict(_setup_result)

    try:
        await start_wired_instance(
            conversation_id=saved["conversationId"],
            identity_id=saved["identityId"],
            env=saved["env"],
            debug=True,
        )
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

    _setup_result = None
    await cleanup_setup_instance()

    return {"saved": True, "conversationId": saved["conversationId"]}


@app.post("/convos/setup/cancel", dependencies=[Depends(require_auth)])
async def convos_setup_cancel():
    was_active = _setup_instance is not None
    await cleanup_setup_instance()
    global _setup_join_state
    _setup_join_state = {"joined": False, "joinerInboxId": None}
    return {"cancelled": was_active}
