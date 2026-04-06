"""
ConvosInstance — Python port of the TypeScript ConvosInstance.

1 process = 1 conversation. All operations go through a single
long-lived child process using an ndjson stdin/stdout protocol.

Stdout events: ready, message, member_joined, sent, heartbeat, error
Stdin commands: send, react, read-receipt, attach, rename, lock, unlock, explode, stop
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)

MAX_RESTARTS = 5
RESTART_BASE_DELAY_S = 2.0
RESTART_RESET_AFTER_S = 60.0
SEND_TIMEOUT_S = 30.0


@dataclass
class InboundMessage:
    conversation_id: str
    message_id: str
    sender_id: str
    sender_name: str
    content: str
    content_type: str = "text"
    timestamp: float = 0.0  # epoch seconds
    catchup: bool = False


@dataclass
class ReadyEvent:
    conversation_id: str
    identity_id: str
    inbox_id: str
    address: str
    name: str
    invite_url: str | None = None
    invite_slug: str | None = None


@dataclass
class SentEvent:
    id: str | None = None
    text: str | None = None
    type: str | None = None
    message_id: str | None = None
    emoji: str | None = None
    action: str | None = None
    name: str | None = None
    conversation_id: str | None = None


def _resolve_convos_bin() -> str:
    """Find the convos CLI binary."""
    from ..server.paths import HERMES_ROOT

    # Check node_modules in our own package (anchor-based, no parent-counting)
    local_bin = HERMES_ROOT / "node_modules" / "@xmtp" / "convos-cli" / "bin" / "run.js"
    if local_bin.exists():
        return str(local_bin)

    # Fallback: convos on PATH
    if shutil.which("convos"):
        return "convos"

    raise FileNotFoundError("convos CLI binary not found")


class ConvosInstance:
    """Manages a single convos agent serve subprocess."""

    def __init__(
        self,
        conversation_id: str,
        identity_id: str,
        env: str = "production",
        *,
        debug: bool = False,
        heartbeat_seconds: int = 30,
        on_message: Callable[[InboundMessage], Coroutine[Any, Any, None]] | None = None,
        on_member_joined: Callable[[dict], Coroutine[Any, Any, None]] | None = None,
        on_ready: Callable[[ReadyEvent], Coroutine[Any, Any, None]] | None = None,
        on_sent: Callable[[SentEvent], Coroutine[Any, Any, None]] | None = None,
        on_exit: Callable[[int | None], None] | None = None,
    ):
        self.conversation_id = conversation_id
        self.identity_id = identity_id
        self.env = env
        self.debug = debug
        self.heartbeat_seconds = heartbeat_seconds
        self.inbox_id: str | None = None
        self.label: str | None = None

        self._on_message = on_message
        self._on_member_joined = on_member_joined
        self._on_ready = on_ready
        self._on_sent = on_sent
        self._on_exit = on_exit

        self._process: asyncio.subprocess.Process | None = None
        self._running = False
        self._restart_count = 0
        self._last_start_time = 0.0
        self._member_names: dict[str, str] = {}
        self.attestation_env: dict[str, str] = {}

        self._ready_event: asyncio.Event = asyncio.Event()
        self._ready_info: ReadyEvent | None = None
        self._ready_error: Exception | None = None

        self._pending_sends: dict[int, asyncio.Future[dict]] = {}
        self._send_counter = 0

        self._stdout_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None

    # ---- One-shot CLI helpers ----

    async def _exec(self, args: list[str]) -> str:
        bin_path = _resolve_convos_bin()
        if bin_path == "convos":
            cmd = ["convos", *args, "--env", self.env]
        else:
            cmd = ["node", bin_path, *args, "--env", self.env]

        if self.debug:
            logger.debug(f"exec: {' '.join(cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "CONVOS_ENV": self.env},
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"convos command failed (exit {proc.returncode}): {stderr.decode()}")
        return stdout.decode()

    async def _exec_json(self, args: list[str]) -> dict:
        stdout = await self._exec([*args, "--json"])
        # Find the last complete JSON object
        text = stdout.strip()
        last_brace = text.rfind("}")
        if last_brace != -1:
            depth = 0
            for i in range(last_brace, -1, -1):
                if text[i] == "}":
                    depth += 1
                elif text[i] == "{":
                    depth -= 1
                if depth == 0:
                    return json.loads(text[i : last_brace + 1])
        return json.loads(text)

    # ---- Factory methods ----

    @classmethod
    async def create_conversation(
        cls,
        env: str,
        *,
        name: str | None = None,
        profile_name: str | None = None,
        description: str | None = None,
        image_url: str | None = None,
        permissions: str | None = None,
        debug: bool = False,
        **kwargs: Any,
    ) -> tuple[ConvosInstance, dict]:
        """Create a new XMTP conversation."""
        args = ["conversations", "create"]
        if name:
            args.extend(["--name", name])
        if profile_name:
            args.extend(["--profile-name", profile_name])
        if description:
            args.extend(["--description", description])
        if image_url:
            args.extend(["--image-url", image_url])
        if permissions:
            args.extend(["--permissions", permissions])

        tmp = cls(conversation_id="", identity_id="", env=env, debug=debug)
        data = await tmp._exec_json(args)

        instance = cls(
            conversation_id=data["conversationId"],
            identity_id=data["identityId"],
            env=env,
            debug=debug,
            **kwargs,
        )
        instance.inbox_id = data.get("inboxId")
        instance.label = name

        result = {
            "conversationId": data["conversationId"],
            "inviteSlug": (data.get("invite") or {}).get("slug", ""),
            "inviteUrl": (data.get("invite") or {}).get("url", ""),
        }
        return instance, result

    @classmethod
    async def join_conversation(
        cls,
        env: str,
        invite_url: str,
        *,
        profile_name: str = os.environ.get("DEFAULT_AGENT_NAME", "Assistant"),
        profile_image: str | None = None,
        metadata: dict[str, str] | None = None,
        timeout: int = 60,
        debug: bool = False,
        **kwargs: Any,
    ) -> tuple[ConvosInstance | None, str, str | None]:
        """Join an existing conversation. Returns (instance, status, conversation_id)."""
        args = ["conversations", "join", invite_url]
        if profile_name:
            args.extend(["--profile-name", profile_name])
        if profile_image:
            args.extend(["--profile-image", profile_image])
        if metadata:
            for key, value in metadata.items():
                args.extend(["--metadata", f"{key}={value}"])
        args.extend(["--timeout", str(timeout)])

        tmp = cls(conversation_id="", identity_id="", env=env, debug=debug)

        try:
            data = await tmp._exec_json(args)
        except RuntimeError as err:
            msg = str(err)
            if "Already joined" in msg:
                # Parse identity and conversation from error
                import re
                identity_match = re.search(r"Identity:\s*([a-f0-9]+)", msg)
                conv_match = re.search(r"Conversation:\s*([a-f0-9]+)", msg)
                if identity_match and conv_match:
                    instance = cls(
                        conversation_id=conv_match.group(1),
                        identity_id=identity_match.group(1),
                        env=env,
                        debug=debug,
                        **kwargs,
                    )
                    return instance, "joined", conv_match.group(1)
                if identity_match and "(pending)" in msg:
                    return None, "pending", None
            raise

        if data.get("status") == "joined" and data.get("conversationId"):
            instance = cls(
                conversation_id=data["conversationId"],
                identity_id=data["identityId"],
                env=env,
                debug=debug,
                **kwargs,
            )
            instance.inbox_id = data.get("inboxId")
            instance.label = data.get("conversationName")
            return instance, "joined", data["conversationId"]

        return None, "waiting_for_acceptance", None

    # ---- Lifecycle ----

    async def start(self) -> ReadyEvent:
        if self._running:
            raise RuntimeError("Instance already running")
        self._running = True
        self._restart_count = 0
        self._ready_event.clear()
        self._ready_info = None
        self._ready_error = None

        try:
            await self._spawn_agent_serve()
        except Exception:
            self._running = False
            raise

        # Wait for ready event
        await self._ready_event.wait()
        if self._ready_error:
            self._running = False
            raise self._ready_error
        assert self._ready_info is not None

        await self.refresh_member_names()
        if self.debug:
            logger.info(f"Started: {self.conversation_id[:12]}... (inbox: {self.inbox_id})")
        return self._ready_info

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False

        if self._process and self._process.stdin:
            try:
                self._write_command({"type": "stop"})
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    self._process.terminate()
            except Exception:
                pass
            self._process = None

        if self._stdout_task:
            self._stdout_task.cancel()
            self._stdout_task = None
        if self._stderr_task:
            self._stderr_task.cancel()
            self._stderr_task = None

        # Reject pending sends
        for fut in self._pending_sends.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Instance stopped"))
        self._pending_sends.clear()

        if self.debug:
            logger.info(f"Stopped: {self.conversation_id[:12]}...")

    def is_running(self) -> bool:
        return self._running

    def is_streaming(self) -> bool:
        return self._running and self._process is not None and self._process.returncode is None

    # ---- Member cache ----

    async def refresh_member_names(self) -> None:
        try:
            await self.refresh_member_names_strict()
        except Exception as err:
            logger.error(f"Failed to refresh member names: {err}")

    async def refresh_member_names_strict(self) -> list[dict[str, Any]]:
        try:
            data = await self._exec_json(["conversation", "profiles", self.conversation_id])
        except Exception:
            raise

        profiles = data.get("profiles", [])
        self._member_names.clear()
        for p in profiles:
            self._member_names[p["inboxId"]] = p.get("name") or "anonymous"
        if self.debug:
            logger.info(f"Refreshed member names: {len(self._member_names)} members")
        return profiles

    def set_attestation(self, attestation: str, ts: str, kid: str) -> None:
        """Store attestation values to pass as env vars to agent serve."""
        self.attestation_env = {
            "CONVOS_ATTESTATION": attestation,
            "CONVOS_ATTESTATION_TS": ts,
            "CONVOS_ATTESTATION_KID": kid,
        }

    def set_member_name(self, inbox_id: str, name: str) -> None:
        if inbox_id and name:
            self._member_names[inbox_id] = name

    def get_own_name(self) -> str | None:
        return self._member_names.get(self.inbox_id)

    def get_group_members(self) -> str | None:
        if not self._member_names:
            return None
        # Mark the agent's own entry with "(you)" so it knows which member is itself
        return ", ".join(
            f"{name or 'anonymous'} (you)" if iid == self.inbox_id else (name or "anonymous")
            for iid, name in self._member_names.items()
        )

    # ---- Operations (via stdin commands) ----

    async def send_message(self, text: str, reply_to: str | None = None) -> dict:
        self._assert_running()
        cmd: dict[str, Any] = {"type": "send", "text": text}
        if reply_to:
            cmd["replyTo"] = reply_to
        return await self._send_and_wait(cmd)

    async def react(self, message_id: str, emoji: str, action: str = "add") -> dict:
        self._assert_running()
        self._write_command({"type": "react", "messageId": message_id, "emoji": emoji, "action": action})
        return {"success": True, "action": "added" if action == "add" else "removed"}

    async def send_read_receipt(self) -> None:
        self._assert_running()
        self._write_command({"type": "read-receipt"})

    async def rename(self, name: str) -> None:
        self._assert_running()
        self._write_command({"type": "rename", "name": name})

    async def lock(self) -> None:
        self._assert_running()
        self._write_command({"type": "lock"})

    async def unlock(self) -> None:
        self._assert_running()
        self._write_command({"type": "unlock"})

    async def update_profile(
        self,
        *,
        name: str | None = None,
        image: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Update profile via stdin (v0.4.1+). Uses the running agent serve process."""
        self._assert_running()
        cmd: dict[str, Any] = {"type": "update-profile"}
        if name is not None:
            cmd["name"] = name
        if image is not None:
            cmd["image"] = image
        if metadata is not None:
            cmd["metadata"] = metadata
        self._write_command(cmd)

    async def explode(self) -> None:
        self._assert_running()
        self._write_command({"type": "explode"})

    async def send_attachment(self, file_path: str) -> dict:
        self._assert_running()
        return await self._send_and_wait({"type": "attach", "file": file_path})

    async def download_attachment(self, message_id: str, output_path: str) -> str:
        await self._exec([
            "conversation", "download-attachment",
            self.conversation_id, message_id,
            "--output", output_path,
        ])
        return output_path

    # ---- Private: process management ----

    async def _spawn_agent_serve(self) -> None:
        bin_path = _resolve_convos_bin()
        args = ["agent", "serve", self.conversation_id, "--env", self.env, "--json"]
        if self.heartbeat_seconds > 0:
            args.extend(["--heartbeat", str(self.heartbeat_seconds)])

        if bin_path == "convos":
            cmd = ["convos", *args]
        else:
            cmd = ["node", bin_path, *args]

        if self.debug:
            logger.info(f"spawn: {' '.join(cmd)}")

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "CONVOS_ENV": self.env, **self.attestation_env},
        )
        self._last_start_time = time.monotonic()

        self._stdout_task = asyncio.create_task(self._read_stdout())
        self._stderr_task = asyncio.create_task(self._read_stderr())

        # Monitor process exit for auto-restart
        asyncio.create_task(self._monitor_exit())

    async def _read_stdout(self) -> None:
        assert self._process and self._process.stdout
        stdout = self._process.stdout
        while True:
            line = await stdout.readline()
            if not line:
                break
            try:
                await self._handle_event(line.decode().strip())
            except Exception as err:
                logger.error(f"Error handling event: {err}")

    async def _read_stderr(self) -> None:
        assert self._process and self._process.stderr
        stderr = self._process.stderr
        while True:
            line = await stderr.readline()
            if not line:
                break
            logger.warning(f"[convos:stderr] {line.decode().strip()}")

    async def _monitor_exit(self) -> None:
        assert self._process
        code = await self._process.wait()
        self._process = None

        # Reject pending sends
        for fut in self._pending_sends.values():
            if not fut.done():
                fut.set_exception(RuntimeError(f"Process exited with code {code}"))
        self._pending_sends.clear()

        # Reject ready if still pending
        if not self._ready_event.is_set():
            self._ready_error = RuntimeError(f"Process exited with code {code} before ready")
            self._ready_event.set()

        if self._on_exit:
            try:
                self._on_exit(code)
            except Exception:
                logger.exception("Error in _on_exit callback")

        # Auto-restart if still supposed to be running
        if self._running:
            if time.monotonic() - self._last_start_time > RESTART_RESET_AFTER_S:
                self._restart_count = 0

            self._restart_count += 1
            if self._restart_count <= MAX_RESTARTS:
                delay = RESTART_BASE_DELAY_S * self._restart_count
                logger.warning(
                    f"Process exited with code {code}, restarting in {delay}s "
                    f"(attempt {self._restart_count}/{MAX_RESTARTS})"
                )
                await asyncio.sleep(delay)
                if self._running:
                    self._ready_event.clear()
                    self._ready_info = None
                    self._ready_error = None
                    await self._spawn_agent_serve()
            else:
                logger.error(f"Max restarts reached ({MAX_RESTARTS}), giving up")
                self._running = False

    async def _handle_event(self, line: str) -> None:
        if not line:
            return
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            if self.debug:
                logger.debug(f"non-JSON: {line}")
            return

        event = data.get("event", "")

        if self.debug:
            logger.debug(f"event: {event} {json.dumps(data)}")

        if event == "ready":
            info = ReadyEvent(
                conversation_id=data.get("conversationId", ""),
                identity_id=data.get("identityId", ""),
                inbox_id=data.get("inboxId", ""),
                address=data.get("address", ""),
                name=data.get("name", ""),
                invite_url=data.get("inviteUrl"),
                invite_slug=data.get("inviteSlug"),
            )
            self.inbox_id = info.inbox_id
            self._ready_info = info
            self._ready_event.set()
            if self._on_ready:
                await self._on_ready(info)

        elif event == "message":
            content_type = data.get("contentType", "text")
            if isinstance(content_type, dict):
                content_type = content_type.get("typeId", "text")

            msg = InboundMessage(
                conversation_id=self.conversation_id,
                message_id=data.get("id", ""),
                sender_id=data.get("senderInboxId", ""),
                sender_name=(data.get("senderProfile") or {}).get("name", ""),
                content=data.get("content", ""),
                content_type=content_type,
                timestamp=time.time(),
                catchup=data.get("catchup", False),
            )
            if data.get("sentAt"):
                try:
                    from datetime import datetime
                    msg.timestamp = datetime.fromisoformat(data["sentAt"].replace("Z", "+00:00")).timestamp()
                except Exception:
                    pass

            if self._on_message:
                asyncio.create_task(self._on_message(msg))

        elif event == "member_joined":
            if self._on_member_joined:
                asyncio.create_task(self._on_member_joined({
                    "joinerInboxId": data.get("inboxId", ""),
                    "conversationId": data.get("conversationId", self.conversation_id),
                    "catchup": data.get("catchup", False),
                }))

        elif event == "sent":
            info = SentEvent(
                id=data.get("id"),
                text=data.get("text"),
                type=data.get("type"),
                message_id=data.get("messageId"),
                emoji=data.get("emoji"),
                action=data.get("action"),
                name=data.get("name"),
                conversation_id=data.get("conversationId"),
            )

            # Resolve the first pending send
            if info.id and self._pending_sends:
                key = next(iter(self._pending_sends))
                fut = self._pending_sends.pop(key)
                if not fut.done():
                    fut.set_result({"success": True, "messageId": info.id})

            if self._on_sent:
                await self._on_sent(info)

        elif event == "heartbeat":
            pass  # Silently consume heartbeats

        elif event == "error":
            message = data.get("message", "Unknown error")
            logger.error(f"error event: {message}")

        else:
            if self.debug:
                logger.debug(f"unknown event: {event}")

    def _write_command(self, cmd: dict) -> None:
        if not self._process or not self._process.stdin:
            raise RuntimeError("Agent serve process not running or stdin not writable")
        if self.debug:
            logger.debug(f"stdin: {json.dumps(cmd)}")
        data = json.dumps(cmd) + "\n"
        self._process.stdin.write(data.encode())

    async def _send_and_wait(self, cmd: dict) -> dict:
        self._send_counter += 1
        key = self._send_counter
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[dict] = loop.create_future()
        self._pending_sends[key] = fut

        self._write_command(cmd)

        try:
            return await asyncio.wait_for(fut, timeout=SEND_TIMEOUT_S)
        except asyncio.TimeoutError:
            self._pending_sends.pop(key, None)
            return {"success": False, "messageId": None}

    def _assert_running(self) -> None:
        if not self._running:
            raise RuntimeError("Convos instance not running")
