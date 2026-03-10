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
from dataclasses import dataclass, field
from typing import Any

from .xmtp_bridge import ConvosInstance, InboundMessage
from .agent_runner import AgentRunner
from .config import RuntimeConfig

logger = logging.getLogger(__name__)

XMTP_MESSAGE_LIMIT = 4000


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


def parse_response(raw: str) -> ParsedResponse:
    """Extract all markers from the agent's response text."""
    result = ParsedResponse(text="")
    lines = raw.split("\n")
    text_lines = []

    for line in lines:
        stripped = line.strip()

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

        self._agent = AgentRunner(
            model=self._config.model,
            openrouter_api_key=self._config.openrouter_api_key,
            max_iterations=self._config.max_iterations,
            hermes_home=self._config.hermes_home,
        )

        self._instance = ConvosInstance(
            conversation_id=conversation_id,
            env=env,
            identity_id=identity_id,
            debug=debug,
            on_message=self._handle_message,
            on_member_joined=self._handle_member_joined(name),
        )

        # Wire convos tools to the bridge so they execute mid-processing
        from .convos_tools import set_bridge
        set_bridge(
            react=self._instance.react,
            send_attachment=self._instance.send_attachment,
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
        if self._instance:
            await self._instance.stop()
            self._instance = None
        self._agent = None

    # ---- Message pipeline ----

    async def _handle_message(self, msg: InboundMessage) -> None:
        """Full message pipeline: eyes -> agent -> parse -> execute -> send -> remove eyes."""
        if msg.content_type in ("group_updated", "reaction"):
            return

        inst = self._instance
        agent = self._agent
        if not inst or not agent:
            logger.warning("Message received but no instance/agent active")
            return

        # Update member name cache
        if msg.sender_id and msg.sender_name and msg.sender_id != "system":
            inst.set_member_name(msg.sender_id, msg.sender_name)

        logger.info(f"Inbound [{msg.message_id[:12]}] from {msg.sender_name or msg.sender_id[:12]}: {msg.content[:80]}")

        try:
            response = await agent.handle_message(
                content=msg.content,
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

        if response:
            await self._dispatch_response(response)

        # Auto-remove eyes reaction after dispatch (agent adds it mid-processing via convos_react)
        if msg.message_id:
            try:
                await inst.react(msg.message_id, "\U0001f440", "remove")
            except Exception:
                pass  # silently ignore if eyes weren't placed



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

        # Send media attachments
        for media_path in parsed.media:
            try:
                await inst.send_attachment(media_path)
            except Exception as err:
                logger.error(f"Send attachment failed: {err}")

        # Send text message (either as reply or new message)
        text = strip_markdown(parsed.text)
        if text:
            chunks = chunk_text(text)
            for chunk in chunks:
                try:
                    await inst.send_message(chunk, reply_to=parsed.reply_to)
                except Exception as err:
                    logger.error(f"Send message failed: {err}")



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
    ) -> None:
        """Update conversation profile via stdin (v0.4.1+ update-profile command)."""
        inst = self._instance
        if not inst:
            return

        try:
            await inst.update_profile(name=name, image=image)
            logger.info(f"Profile updated: name={name}, image={image}")
        except Exception as err:
            logger.error(f"Profile update failed: {err}")

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
