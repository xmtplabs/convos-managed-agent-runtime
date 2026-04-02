"""
Convos platform adapter — follows the Hermes gateway adapter pattern.

Handles the full message pipeline:
  inbound XMTP message -> agent -> parse markers -> execute side effects -> send

Marker syntax (agent includes these in its response text):
  REACT:messageId:emoji           — react to a message
  REACT:messageId:emoji:remove    — remove a reaction
  REPLY:messageId                 — send the response as a reply to that message
  MEDIA:/path/to/file             — send a file attachment
  PROFILE:New Name                — update the agent's profile name
  PROFILEIMAGE:https://url        — update the agent's profile image

Rules:
  - One message per turn (plain text or REPLY, not both)
  - REACT, MEDIA, PROFILE, PROFILEIMAGE are side effects (stripped from text)
  - If REPLY:msgId is present, remaining text is sent as a reply to that message
  - If no REPLY, remaining text is sent as a new message
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .xmtp_bridge import ConvosInstance, InboundMessage
from ..server.agent_runner import AgentRunner
from ..server.config import RuntimeConfig
from ..server.profile_image_renewal import ProfileImageRenewalStore
from ..server.credentials import clear_credentials
from ..server.outbound_policy import apply_outbound_policy
from ..server.stats import stats

logger = logging.getLogger(__name__)

XMTP_MESSAGE_LIMIT = 4000
GROUP_UPDATE_SEPARATOR_RE = re.compile(r"\s*;\s*")
COMPANION_SETTLE_S = 1.5
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".heic", ".heif", ".avif"}
ATTACHMENT_FILENAME_RE = re.compile(r"\[(?:remote )?attachment:\s*(\S+)")
CONVOS_IMG_MAX_AGE_S = 60 * 60  # 1 hour
PRUNE_THROTTLE_S = 5 * 60  # at most once per 5 minutes
_last_prune_at = 0.0
GROUP_EXPIRATION_UPDATE_RE = re.compile(r"\bset conversation expiration to ([^;]+)(?:;|$)", re.IGNORECASE)
GROUP_EXPIRATION_CLEARED_RE = re.compile(r"\bcleared conversation expiration(?:;|$)", re.IGNORECASE)
EXPLOSION_IMMEDIATE_SKEW_S = 3.0
_expiration_timer: asyncio.TimerHandle | None = None
_expiration_at_s: float | None = None

async def _notify_pool_self_destruct() -> None:
    """Tell the pool manager to destroy this instance."""
    instance_id = os.environ.get("INSTANCE_ID")
    pool_url = os.environ.get("POOL_URL")
    gateway_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN")

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


@dataclass
class ParsedMarker:
    type: str  # react, reply, media, profile, profileimage
    value: str  # emoji, path, name, url
    message_id: str | None = None
    action: str = "add"  # for react: add/remove


@dataclass
class ParsedResponse:
    """Result of parsing markers from agent response text."""
    text: str  # cleaned text (markers stripped)
    reply_to: str | None = None  # message ID to reply to
    reactions: list[ParsedMarker] = field(default_factory=list)
    media: list[str] = field(default_factory=list)
    profile_name: str | None = None
    profile_image: str | None = None
    profile_metadata: dict[str, str] = field(default_factory=dict)
    silent: bool = False  # agent explicitly chose not to reply


def parse_response(raw: str) -> ParsedResponse:
    """Extract all markers from the agent's response text."""
    result = ParsedResponse(text="")
    lines = raw.split("\n")
    text_lines = []

    for line in lines:
        stripped = line.strip()

        # SILENT — agent explicitly chose not to reply
        # Also catch markdown-wrapped variants like **SILENT**, `SILENT`, etc.
        bare = re.sub(r"[\*_`~]+", "", stripped)
        if bare == "SILENT":
            result.silent = True
            continue

        # REACT:messageId:emoji or REACT:messageId:emoji:remove
        m = re.match(r'^REACT:([^:\s]+):([^:\s]+)(?::(remove))?$', stripped)
        if m:
            result.reactions.append(ParsedMarker(
                type="react",
                value=m.group(2),
                message_id=m.group(1),
                action="remove" if m.group(3) else "add",
            ))
            continue

        # REPLY:messageId — remaining text becomes the reply
        m = re.match(r'^REPLY:(\S+)$', stripped)
        if m:
            result.reply_to = m.group(1)
            continue

        # PROFILE:name
        m = re.match(r'^PROFILE:(.+)$', stripped)
        if m:
            result.profile_name = m.group(1).strip()
            continue

        # PROFILEIMAGE:url
        m = re.match(r'^PROFILEIMAGE:(https?://\S+)$', stripped)
        if m:
            result.profile_image = m.group(1).strip()
            continue

        # METADATA:key=value
        m = re.match(r'^METADATA:(\w+)=(.+)$', stripped)
        if m:
            result.profile_metadata[m.group(1)] = m.group(2).strip()
            continue

        # MEDIA:/path — can be inline, extract and keep rest of line
        media_match = re.search(r'MEDIA:(/\S+)', line)
        if media_match:
            result.media.append(media_match.group(1))
            line = line[:media_match.start()] + line[media_match.end():]
            line = line.strip()
            if not line:
                continue

        text_lines.append(line)

    result.text = "\n".join(text_lines).strip()
    return result


def strip_markdown(text: str) -> str:
    """Strip heavy Markdown formatting for chat output."""
    text = re.sub(r"```[^\n]*\n([\s\S]*?)```", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\*{1,3}(.*?)\*{1,3}", r"\1", text)
    text = re.sub(r"~~(.*?)~~", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    return text


def chunk_text(text: str, limit: int = XMTP_MESSAGE_LIMIT) -> list[str]:
    """Split text into chunks respecting paragraph boundaries."""
    if len(text) <= limit:
        return [text]

    chunks = []
    while text:
        if len(text) <= limit:
            chunks.append(text)
            break

        idx = text.rfind("\n\n", 0, limit)
        if idx == -1:
            idx = text.rfind("\n", 0, limit)
        if idx == -1:
            idx = text.rfind(" ", 0, limit)
        if idx == -1:
            idx = limit

        chunks.append(text[:idx])
        text = text[idx:].lstrip()

    return chunks


def split_group_update_segments(content: str) -> list[str]:
    return [segment.strip() for segment in GROUP_UPDATE_SEPARATOR_RE.split(content) if segment.strip()]


def is_member_removal_group_update(content: str) -> bool:
    for segment in split_group_update_segments(content):
        if re.search(r"\bleft the group$", segment, flags=re.IGNORECASE):
            return True
        if (
            re.match(r"^[^;]+ removed [^;]+$", segment, flags=re.IGNORECASE)
            and not re.search(r"\bwas removed$", segment, flags=re.IGNORECASE)
            and not re.search(r"\bremoved .+ as admin$", segment, flags=re.IGNORECASE)
            and not re.search(r"\bremoved .+ as super admin$", segment, flags=re.IGNORECASE)
            and not re.search(r"\bremoved their profile photo$", segment, flags=re.IGNORECASE)
        ):
            return True
    return False


def _parse_conversation_expiration(content: str) -> tuple[str, float] | tuple[str, None] | None:
    """Parse a group_updated message for expiration info.

    Returns ("cleared", None) if expiration was cleared,
    (raw_timestamp_str, epoch_seconds) if set, or None if not an expiration update.
    """
    if GROUP_EXPIRATION_CLEARED_RE.search(content):
        return ("cleared", None)

    m = GROUP_EXPIRATION_UPDATE_RE.search(content)
    if not m:
        return None

    raw = m.group(1).strip()
    try:
        from datetime import datetime
        expires_at = datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except (ValueError, OverflowError):
        return None

    return (raw, expires_at)


def _clear_expiration_timer() -> None:
    global _expiration_timer, _expiration_at_s
    if _expiration_timer is not None:
        _expiration_timer.cancel()
        _expiration_timer = None
    _expiration_at_s = None


def is_inactive_group_error(err: Exception) -> bool:
    return bool(re.search(r"\bgroup is inactive\b", str(err), flags=re.IGNORECASE))


_REACTION_TARGET_RE = re.compile(r"^(?:reacted|removed)\s+\S+\s+to\s+(\S+)$")


def _parse_reaction_target_id(content: str) -> str | None:
    """Extract the target message ID from a reaction content string."""
    m = _REACTION_TARGET_RE.match(content)
    return m.group(1) if m else None


def is_attachment_message(msg: InboundMessage) -> bool:
    return msg.content_type in ("attachment", "remoteStaticAttachment")


def _extract_attachment_filename(content: str) -> str | None:
    """Extract filename from normalized attachment content like '[remote attachment: photo.png ...]'."""
    m = ATTACHMENT_FILENAME_RE.search(content)
    return m.group(1) if m else None


def _is_image_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


def _prune_stale_convos_images(media_dir: Path) -> None:
    """Remove convos-img-* temp files older than 1 hour. Throttled to at most once per 5 minutes."""
    global _last_prune_at
    import time as _time
    now = _time.time()
    if now - _last_prune_at < PRUNE_THROTTLE_S:
        return
    _last_prune_at = now
    if not media_dir.exists():
        return
    for entry in media_dir.iterdir():
        if not entry.name.startswith("convos-img-"):
            continue
        try:
            if now - entry.stat().st_mtime > CONVOS_IMG_MAX_AGE_S:
                entry.unlink(missing_ok=True)
        except Exception:
            pass


def attachment_hold_key(msg: InboundMessage) -> str | None:
    if not msg.conversation_id or not msg.sender_id:
        return None
    return f"{msg.conversation_id}:{msg.sender_id}"


def merge_attachment_with_message(attachment_msg: InboundMessage, msg: InboundMessage) -> InboundMessage:
    # If the attachment was downloaded to a local file (set by _download_image_attachment),
    # tell the agent the file path so it can use vision_analyze.
    local_path = getattr(attachment_msg, "_local_image_path", None)
    if local_path:
        attachment_context = f"[Image attached: {local_path}] Use your vision_analyze tool with this file path to see the image."
    else:
        attachment_context = f"Attachment reference {attachment_msg.message_id}: {attachment_msg.content}"
    merged_content = f"{attachment_context}\n{msg.content}".strip()
    return InboundMessage(
        conversation_id=msg.conversation_id,
        message_id=msg.message_id,
        sender_id=msg.sender_id,
        sender_name=msg.sender_name,
        content=merged_content,
        content_type=msg.content_type,
        timestamp=msg.timestamp,
        catchup=msg.catchup,
    )


class ConvosAdapter:
    """
    Convos XMTP platform adapter.

    Follows the Hermes gateway adapter pattern:
    - Receives inbound messages from xmtp_bridge
    - Runs them through the Hermes AIAgent
    - Parses markers from the response
    - Routes actions through xmtp_bridge
    """

    def __init__(self, config: RuntimeConfig):
        self._config = config
        self._instance: ConvosInstance | None = None
        self._agent: AgentRunner | None = None
        self._profile_image_renewal: ProfileImageRenewalStore | None = None
        self._pending_attachments: dict[str, tuple[InboundMessage, asyncio.Task[None], asyncio.Task[None] | None]] = {}
        self._greeting_done = asyncio.Event()  # gates message processing until greeting completes
        # Interrupt-and-queue: tracks whether an agent call is in-flight and
        # holds the latest pending message so we can interrupt + replay.
        self._agent_running = False
        self._pending_message: InboundMessage | None = None
        self._skipped_content: list[str] = []  # messages superseded while queued
        self._sent_message_ids: set[str] = set()  # tracks agent-sent IDs for "own" reaction detection

    @property
    def instance(self) -> ConvosInstance | None:
        return self._instance

    @property
    def agent(self) -> AgentRunner | None:
        return self._agent

    async def start(
        self,
        *,
        conversation_id: str,
        env: str,
        name: str | None = None,
        identity_id: str = "",
        debug: bool = False,
    ):
        """Create and start a ConvosInstance + AgentRunner. Returns the ReadyEvent."""
        os.environ["CONVOS_CONVERSATION_ID"] = conversation_id
        os.environ["CONVOS_ENV"] = env
        # Tag session so cron jobs record origin as convos + this conversation.
        # The cronjob_tools read these to set job["origin"] for delivery routing.
        os.environ["HERMES_SESSION_PLATFORM"] = "convos"
        os.environ["HERMES_SESSION_CHAT_ID"] = conversation_id

        self._agent = AgentRunner(
            model=self._config.model,
            openrouter_api_key=self._config.openrouter_api_key,
            max_iterations=self._config.max_iterations,
            hermes_home=self._config.hermes_home,
            conversation_id=conversation_id,
        )

        self._instance = ConvosInstance(
            conversation_id=conversation_id,
            env=env,
            identity_id=identity_id,
            debug=debug,
            on_message=self._handle_message,
            on_member_joined=self._handle_member_joined(name),
            on_sent=self._handle_sent,
        )

        # Wire convos tools to the bridge so they execute mid-processing
        from .convos_tools import set_bridge
        set_bridge(
            react=self._instance.react,
            send_attachment=self._instance.send_attachment,
        )

        self._profile_image_renewal = ProfileImageRenewalStore(
            self._config.hermes_home,
            conversation_id,
        )

        ready_info = await self._instance.start()

        if name:
            try:
                await self._instance.rename(name)
            except Exception as err:
                logger.error(f"Initial rename failed: {err}")

        return ready_info

    async def stop(self) -> None:
        """Stop the ConvosInstance."""
        for _, flush_task, download_task in self._pending_attachments.values():
            flush_task.cancel()
            if download_task:
                download_task.cancel()
        self._pending_attachments.clear()

        _clear_expiration_timer()

        if self._instance:
            await self._instance.stop()
            self._instance = None
        self._profile_image_renewal = None
        self._agent = None

    # ---- Message pipeline ----

    async def _handle_message(self, msg: InboundMessage) -> None:
        """Route attachments through the hold/merge system, then process."""
        hold_key = attachment_hold_key(msg)

        if is_attachment_message(msg):
            # Start download in the background — do NOT await before holding.
            # The hold entry must be visible immediately so a companion text
            # message that arrives while the download is in progress can merge.
            download_task = asyncio.create_task(self._download_image_attachment(msg))
            await self._hold_attachment(hold_key, msg, download_task)
            return

        if hold_key:
            held, download_task = self._pop_held_attachment(hold_key)
            if held:
                if download_task:
                    await download_task  # wait for download to finish before merging
                msg = merge_attachment_with_message(held, msg)

        await self._process_message(msg)

    async def _process_message(self, msg: InboundMessage) -> None:
        """Full message pipeline: eyes -> agent -> parse -> execute -> send -> remove eyes.

        Interrupt-and-queue: if the agent is already processing a message,
        interrupt it and stash this message as pending.  When the interrupted
        turn finishes, the pending message is picked up automatically so the
        agent responds to the latest context instead of racing.
        """
        # Reactions to the agent's own messages trigger a full agent turn (e.g.
        # thumbs-up to answer a yes/no question). Reactions to other users'
        # messages are silently dropped — no turn, no history recording.
        if msg.content_type == "reaction":
            target_id = _parse_reaction_target_id(msg.content)
            if target_id and target_id in self._sent_message_ids:
                logger.info(f"Own-message reaction — dispatching agent turn")
                # Fall through to normal message processing below
            else:
                return

        inst = self._instance
        agent = self._agent
        if not inst or not agent:
            logger.warning("Message received but no instance/agent active")
            return

        if msg.content_type == "group_updated":
            parsed = _parse_conversation_expiration(msg.content)
            if parsed is not None:
                raw, expires_at = parsed
                if raw == "cleared":
                    _clear_expiration_timer()
                    logger.info("Conversation expiration cleared")
                elif expires_at is not None:
                    import time
                    now = time.time()
                    if expires_at <= now + EXPLOSION_IMMEDIATE_SKEW_S:
                        logger.info(f"Conversation exploded, self-destructing (expiration reached at {raw})")
                        await self._self_destruct_and_exit()
                        return
                    else:
                        self._schedule_expiration_timer(expires_at, raw)

            termination_reason = await self._detect_membership_termination_reason(msg)
            if termination_reason:
                logger.info(f"Membership ended, self-destructing ({termination_reason})")
                await self._self_destruct_and_exit()
                return

        if not msg.catchup:
            try:
                await self._renew_profile_image_on_activity()
            except Exception as err:
                logger.error(f"Profile image renewal on inbound activity failed: {err}")

            # TEMPORARILY DISABLED — read receipts causing issues
            # if msg.content_type not in ("group_updated", "reaction"):
            #     try:
            #         await inst.send_read_receipt()
            #     except Exception:
            #         pass  # silent

        if msg.content_type == "group_updated":
            return

        # Wait for greeting to finish before processing real messages.
        # Messages that arrive during the greeting's LLM call queue here
        # so they see the greeting in history instead of empty context.
        await self._greeting_done.wait()

        # ── Interrupt-and-queue: if agent is busy, interrupt and stash ──
        if self._agent_running:
            if self._pending_message is not None:
                # Previous pending is being superseded — preserve its content
                pm = self._pending_message
                self._skipped_content.append(
                    f"[{pm.sender_name or pm.sender_id[:12]}]: {pm.content}"
                )
            self._pending_message = msg  # latest wins
            ai_agent = agent._ensure_agent()
            ai_agent.interrupt(msg.content)
            logger.info(f"Interrupted running agent — pending [{msg.message_id[:12]}] from {msg.sender_name or msg.sender_id[:12]}")
            return

        await self._run_agent_turn(msg)

    async def _run_agent_turn(self, msg: InboundMessage) -> None:
        """Execute a single agent turn, then drain any pending message."""
        inst = self._instance
        agent = self._agent
        if not inst or not agent:
            return

        # Update member name cache
        if msg.sender_id and msg.sender_name and msg.sender_id != "system":
            inst.set_member_name(msg.sender_id, msg.sender_name)

        # If this is a standalone image attachment (no companion text), rewrite content
        # to tell the agent where the file is so it can use vision_analyze.
        local_path = getattr(msg, "_local_image_path", None)
        content = msg.content
        if local_path and is_attachment_message(msg):
            content = f"[Image attached: {local_path}] Use your vision_analyze tool with this file path to see the image."

        # Prepend any messages that were skipped while the agent was busy
        if self._skipped_content:
            skipped = "\n".join(self._skipped_content)
            content = (
                f"[Messages that arrived while you were responding:]\n{skipped}\n\n"
                f"[Latest message:]\n{content}"
            )
            self._skipped_content.clear()

        if not msg.catchup:
            stats.increment("messages_in")
            if self._instance:
                members = self._instance.get_group_members()
                if members:
                    stats.set("group_member_count", len(members.split(", ")))

        logger.info(f"Inbound [{msg.message_id[:12]}] from {msg.sender_name or msg.sender_id[:12]}: {content[:80]}")

        # Clear interrupt state from any previous cycle so the agent starts clean.
        ai_agent = agent._ensure_agent()
        ai_agent.clear_interrupt()
        self._agent_running = True

        try:
            try:
                response = await agent.handle_message(
                    content=content,
                    sender_name=msg.sender_name,
                    sender_id=msg.sender_id,
                    timestamp=msg.timestamp,
                    conversation_id=msg.conversation_id,
                    message_id=msg.message_id,
                    group_members=inst.get_group_members(),
                )
            except Exception as err:
                logger.error(f"Agent error: {err}")
                response = "I encountered an error. Please try again."

            # If the agent was interrupted, skip sending the partial response —
            # the pending message will get a fresh turn below.
            was_interrupted = ai_agent.is_interrupted
            ai_agent.clear_interrupt()

            if response and not was_interrupted:
                await self._dispatch_response(response)

            # Auto-remove eyes reaction after dispatch
            if msg.message_id:
                try:
                    await inst.react(msg.message_id, "\U0001f440", "remove")
                except Exception:
                    pass  # silently ignore if eyes weren't placed

            # ── Drain pending message ──
            pending = self._pending_message
            if pending:
                self._pending_message = None
                logger.info(f"Draining pending message [{pending.message_id[:12]}]")
                await self._run_agent_turn(pending)
                return  # recursive call handles clearing _agent_running
        finally:
            self._agent_running = False

    # ---- Attachment download + hold/merge ----

    async def _download_image_attachment(self, msg: InboundMessage) -> None:
        """If the attachment is an image, download it and stash the local path on the message."""
        filename = _extract_attachment_filename(msg.content)
        if not filename or not _is_image_filename(filename):
            return

        inst = self._instance
        if not inst:
            return

        media_dir = Path(self._config.media_dir)
        media_dir.mkdir(parents=True, exist_ok=True)
        _prune_stale_convos_images(media_dir)
        ext = Path(filename).suffix.lower() or ".jpg"
        local_path = media_dir / f"convos-img-{msg.message_id[:16]}{ext}"

        try:
            await inst.download_attachment(msg.message_id, str(local_path))
            # Stash the path on the message object so merge_attachment_with_message can use it.
            msg._local_image_path = str(local_path)  # type: ignore[attr-defined]
            logger.info(f"Downloaded image attachment to {local_path}")
        except Exception as err:
            logger.error(f"Failed to download image attachment {msg.message_id}: {err}")

    async def _hold_attachment(
        self,
        hold_key: str | None,
        msg: InboundMessage,
        download_task: asyncio.Task[None] | None = None,
    ) -> None:
        """Hold an attachment message, waiting for a companion text message to merge with."""
        if not hold_key:
            if download_task:
                await download_task
            await self._process_message(msg)
            return

        existing, existing_download = self._pop_held_attachment(hold_key)
        if existing:
            async def _process_evicted(msg: InboundMessage, dl: asyncio.Task[None] | None) -> None:
                if dl:
                    await dl  # wait for download so _local_image_path is set
                await self._process_message(msg)
            asyncio.create_task(_process_evicted(existing, existing_download))

        async def flush_attachment() -> None:
            try:
                await asyncio.sleep(COMPANION_SETTLE_S)
                current = self._pending_attachments.get(hold_key)
                if not current or current[0].message_id != msg.message_id:
                    return
                self._pending_attachments.pop(hold_key, None)
                if download_task:
                    await download_task  # ensure download is done before processing
                await self._process_message(msg)
            except asyncio.CancelledError:
                return

        self._pending_attachments[hold_key] = (msg, asyncio.create_task(flush_attachment()), download_task)

    def _pop_held_attachment(self, hold_key: str) -> tuple[InboundMessage | None, asyncio.Task[None] | None]:
        """Cancel flush timer and return (held attachment, download task) for the given key."""
        entry = self._pending_attachments.pop(hold_key, None)
        if not entry:
            return None, None
        attachment_msg, flush_task, download_task = entry
        flush_task.cancel()
        return attachment_msg, download_task

    async def _self_destruct_and_exit(self) -> None:
        _clear_expiration_timer()
        await stats.shutdown()
        await self.stop()
        clear_credentials(self._config.hermes_home)
        await _notify_pool_self_destruct()
        if not os.environ.get("EVAL_MODE"):
            sys.exit(0)

    def _schedule_expiration_timer(self, expires_at_s: float, raw: str) -> None:
        global _expiration_timer, _expiration_at_s
        # Already scheduled for the same time — no-op
        if _expiration_at_s == expires_at_s and _expiration_timer is not None:
            return

        _clear_expiration_timer()
        _expiration_at_s = expires_at_s

        import time
        delay = max(0.0, expires_at_s - time.time())
        logger.info(f"Scheduled conversation expiration check for {raw} (in {delay:.1f}s)")

        loop = asyncio.get_event_loop()

        def _on_expire() -> None:
            global _expiration_timer, _expiration_at_s
            _expiration_timer = None
            _expiration_at_s = None

            import time as _t
            if expires_at_s > _t.time() + EXPLOSION_IMMEDIATE_SKEW_S:
                return

            logger.info(f"Conversation expiration reached, self-destructing (expiration reached at {raw})")
            asyncio.ensure_future(self._self_destruct_and_exit())

        _expiration_timer = loop.call_later(delay, _on_expire)

    async def _detect_membership_termination_reason(self, msg: InboundMessage) -> str | None:
        inst = self._instance
        if not inst or msg.content_type != "group_updated" or not is_member_removal_group_update(msg.content):
            return None

        try:
            profiles = await inst.refresh_member_names_strict()
        except Exception as err:
            if is_inactive_group_error(err):
                return "removed from group"
            logger.error(f"Unexpected error checking membership: {err}")
            return None

        if not profiles:
            return None

        agent_still_present = any(
            profile.get("isMe") is True or (bool(inst.inbox_id) and profile.get("inboxId") == inst.inbox_id)
            for profile in profiles
        )
        if not agent_still_present:
            return "removed from group"

        if len(profiles) == 1:
            return "last member in group"

        return None



    async def _dispatch_response(self, raw_response: str) -> None:
        """Parse markers and route actions through xmtp_bridge."""
        inst = self._instance
        if not inst:
            return

        parsed = parse_response(raw_response)

        # Execute side-effect markers first (reactions, profile updates)
        for reaction in parsed.reactions:
            try:
                await inst.react(reaction.message_id, reaction.value, reaction.action)
            except Exception as err:
                logger.error(f"React failed: {err}")

        if parsed.profile_name:
            try:
                await self._update_profile(name=parsed.profile_name)
            except Exception as err:
                logger.error(f"Profile name update failed: {err}")

        if parsed.profile_image:
            try:
                await self._update_profile(image=parsed.profile_image)
            except Exception as err:
                logger.error(f"Profile image update failed: {err}")

        if parsed.profile_metadata:
            try:
                await self._update_profile(metadata=parsed.profile_metadata)
            except Exception as err:
                logger.error(f"Profile metadata update failed: {err}")

        # Send media attachments
        for media_path in parsed.media:
            try:
                await inst.send_attachment(media_path)
            except Exception as err:
                logger.error(f"Send attachment failed: {err}")

        # Renew profile image on any outbound activity (before SILENT check
        # so media-only sends still trigger renewal)
        raw_text = strip_markdown(parsed.text)
        policy = await apply_outbound_policy(raw_text)
        text = policy.text
        if parsed.media or text:
            try:
                await self._renew_profile_image_on_activity()
            except Exception as err:
                logger.error(f"Profile image renewal on outbound activity failed: {err}")

        # Agent explicitly chose silence — side effects above still fire, but no text
        if parsed.silent:
            logger.info("Agent chose SILENT — suppressing text reply")
            return

        if policy.suppress:
            logger.info("Outbound policy suppressed text reply")
            return

        if text:
            chunks = chunk_text(text)
            for chunk in chunks:
                try:
                    await inst.send_message(chunk, reply_to=parsed.reply_to)
                    stats.increment("messages_out")
                except Exception as err:
                    logger.error(f"Send message failed: {err}")



    async def _handle_sent(self, info) -> None:
        """Track all sent message IDs for own-reaction detection."""
        mid = getattr(info, "id", None)
        if mid:
            self._sent_message_ids.add(mid)

    def _handle_member_joined(self, name: str | None):
        """Return a member_joined callback that renames + refreshes."""
        async def on_member_joined(info: dict) -> None:
            logger.info(f"Join accepted: {info.get('joinerInboxId', '')}")
            inst = self._instance
            if inst:
                if name:
                    try:
                        await inst.rename(name)
                    except Exception as err:
                        logger.error(f"Rename after join failed: {err}")
                await inst.refresh_member_names()

        return on_member_joined

    # ---- Profile management ----

    async def _update_profile(
        self,
        name: str | None = None,
        image: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Update conversation profile via stdin (v0.4.1+ update-profile command)."""
        inst = self._instance
        if not inst:
            return

        try:
            await inst.update_profile(name=name, image=image, metadata=metadata)
            if image is not None and self._profile_image_renewal is not None:
                self._profile_image_renewal.record_applied_image(image)
            logger.info(f"Profile updated: name={name}, image={image}")
        except Exception as err:
            logger.error(f"Profile update failed: {err}")

    async def _renew_profile_image_on_activity(self) -> None:
        inst = self._instance
        renewal = self._profile_image_renewal
        if not inst or renewal is None:
            return

        source = renewal.due_source()
        if not source:
            return

        await self._update_profile(image=source)
        logger.info("Profile image renewed on activity")

    # ---- Delegated operations (called by server.py pool endpoints) ----

    async def send_message(self, text: str, reply_to: str | None = None) -> None:
        if self._instance:
            await self._instance.send_message(text, reply_to=reply_to)

    async def react(self, message_id: str, emoji: str, action: str = "add") -> None:
        if self._instance:
            await self._instance.react(message_id, emoji, action)

    async def rename(self, name: str) -> None:
        if self._instance:
            await self._instance.rename(name)

    async def lock(self) -> None:
        if self._instance:
            await self._instance.lock()

    async def unlock(self) -> None:
        if self._instance:
            await self._instance.unlock()

    async def explode(self) -> None:
        if self._instance:
            await self._instance.explode()

    async def send_attachment(self, path: str) -> None:
        if self._instance:
            await self._instance.send_attachment(path)

    def reset_history(self) -> None:
        if self._agent:
            self._agent.reset_history()
