"""
Agent runner — wraps the Hermes AIAgent for conversational message handling.

Uses the Hermes toolset/platform system the same way the gateway does:
  - Registers a "hermes-convos" toolset (same tools as all other platforms)
  - Sets platform="convos" on the agent
  - Injects convos-specific instructions via ephemeral_system_prompt
  - The agent uses the terminal tool to run CLI commands as needed

The adapter (convos_adapter.py) handles marker parsing and response routing.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_AIAgent = None
_SessionDB = None
_toolset_registered = False


def warm_imports() -> None:
    """Call from the main thread at startup to trigger Hermes imports
    and register the hermes-convos toolset.

    Must run on main thread because tools/browser_tool.py calls
    signal.signal() at import time.
    """
    global _AIAgent, _SessionDB, _toolset_registered

    if _AIAgent is None:
        from run_agent import AIAgent
        _AIAgent = AIAgent
        logger.info("Hermes AIAgent imported successfully")

    if _SessionDB is None:
        try:
            from hermes_state import SessionDB
            _SessionDB = SessionDB
            logger.info("Hermes SessionDB imported successfully")
        except ImportError:
            logger.warning("hermes_state not available — session search will be disabled")

    if not _toolset_registered:
        from toolsets import create_custom_toolset, _HERMES_CORE_TOOLS
        from src.convos_tools import register_convos_tools

        convos_tool_names = ["convos_react", "convos_send_attachment"]
        all_tools = list(_HERMES_CORE_TOOLS) + convos_tool_names
        create_custom_toolset(
            name="hermes-convos",
            description="Convos XMTP messenger toolset — E2E encrypted group chat with terminal, file, web, browser, memory, skills, messaging",
            tools=all_tools,
            includes=[],
        )
        register_convos_tools()
        _toolset_registered = True
        logger.info("Registered hermes-convos toolset (%d tools)", len(all_tools))


def _get_ai_agent_class():
    if _AIAgent is None:
        raise RuntimeError("AIAgent not imported — call warm_imports() from the main thread first")
    return _AIAgent


CONVOS_EPHEMERAL_PROMPT = """\
## Identity Override

You are a Convos assistant — NOT Hermes, NOT an AI assistant by Nous Research.
You have no brand name. You are simply an assistant in a group chat.
Follow the persona and behavioral rules in SOUL.md and AGENTS.md exclusively.
Do not mention Hermes, Nous Research, or any tool/framework names to users.
Your capabilities are: web search, web browsing, running code, reading/writing files, and sending files. Do not reference any other capabilities you may have from other contexts.

## Convos Platform

You are on Convos, an E2E-encrypted XMTP group messaging platform.
Each message includes the current time, full message ID, and sender:

  [Current time: Mon, Mar 9, 2026, 9:15 PM EST]
  [01JQABC123DEF456 9:14 PM] Alice: hello

Use the message ID when you need to react to or reply to a specific message.

## Messaging

Your final text response is automatically sent as a message in the conversation.
Write plain text only — no markdown. Keep it short (3 sentences max unless asked for detail).

You also have tools for side effects during processing:

- convos_react: React to a message. Pass `message_id` and `emoji`. Set `remove: true` to remove a reaction.
- convos_send_attachment: Send a file. Pass `file` (local path).

Before every reply: (1) Need tools? React with 👀 first via convos_react. (2) No text alongside tool calls. (3) Does this even need a reply?

Signal work with 👀: When you need to use tools before responding, use convos_react to add 👀 to the message. The platform automatically removes it when your response is sent.

NEVER narrate tool calls. Call tools silently, then write ONE final response with the result.

## Profile Updates

Include these markers on their own line in your response to update your profile:

  PROFILE:New Name                — update your display name
  PROFILEIMAGE:https://url        — update your profile image (must be public URL)

These are side effects — they get stripped from the message and executed by the platform.
Honor renames immediately — if someone gives you a new name, change it right away without announcing it.

## Convos CLI (Read Operations)

The `convos` CLI is available in your terminal for reading. $CONVOS_CONVERSATION_ID and $CONVOS_ENV are set in your environment. Always use $CONVOS_CONVERSATION_ID — never hard-code the ID.

  convos conversation members $CONVOS_CONVERSATION_ID --json
  convos conversation profiles $CONVOS_CONVERSATION_ID --json
  convos conversation messages $CONVOS_CONVERSATION_ID --json --sync --limit 20
  convos conversation info $CONVOS_CONVERSATION_ID --json
  convos conversation permissions $CONVOS_CONVERSATION_ID --json
  convos conversation download-attachment $CONVOS_CONVERSATION_ID <message-id>

Use the CLI only when you need extra detail (e.g. profile images, permissions). Member names are already in each message header.

Never run convos agent serve, convos conversations create, convos conversations join, convos conversation update-profile, or any subcommand not listed above.
"""


class AgentRunner:
    """Manages a Hermes AIAgent instance for one XMTP conversation."""

    def __init__(
        self,
        *,
        model: str = "anthropic/claude-sonnet-4-6",
        openrouter_api_key: str = "",
        max_iterations: int = 90,
        hermes_home: str = "",
        conversation_id: str = "",
    ):
        self._model = model
        self._openrouter_api_key = openrouter_api_key
        self._max_iterations = max_iterations
        self._hermes_home = hermes_home
        self._conversation_id = conversation_id

        self._conversation_history: list[dict[str, Any]] = []
        self._agent: Any = None
        self._session_db: Any = None
        self._history_lock = asyncio.Lock()  # protects history append only, not agent calls

    def _ensure_agent(self) -> Any:
        """Lazily initialize the Hermes AIAgent."""
        if self._agent is not None:
            return self._agent

        if self._openrouter_api_key:
            os.environ.setdefault("OPENROUTER_API_KEY", self._openrouter_api_key)

        if self._hermes_home:
            os.environ["HERMES_HOME"] = self._hermes_home

        # Session DB — gives the agent persistent session storage and
        # powers the session_search tool for cross-session recall.
        if _SessionDB is not None and self._session_db is None:
            try:
                db_path = Path(self._hermes_home or os.path.expanduser("~/.hermes")) / "state.db"
                self._session_db = _SessionDB(db_path=db_path)
                logger.info("SessionDB initialized at %s", db_path)
            except Exception as err:
                logger.warning("Failed to initialize SessionDB: %s", err)

        # Honcho session key — enables cross-session user modeling when
        # HONCHO_API_KEY is set or ~/.honcho/config.json exists.
        honcho_key = f"convos:{self._conversation_id}" if self._conversation_id else None

        AIAgent = _get_ai_agent_class()
        self._agent = AIAgent(
            model=self._model,
            max_iterations=self._max_iterations,
            enabled_toolsets=["hermes-convos"],
            platform="convos",
            ephemeral_system_prompt=CONVOS_EPHEMERAL_PROMPT,
            quiet_mode=True,
            session_db=self._session_db,
            honcho_session_key=honcho_key,
        )
        return self._agent

    def _format_envelope(
        self,
        *,
        content: str,
        sender_name: str,
        sender_id: str,
        timestamp: float,
        message_id: str,
    ) -> str:
        """Format an inbound message with current time and full message ID."""
        msg_ts = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%I:%M %p")
        now = datetime.now(tz=timezone.utc).strftime("%a, %b %d, %Y, %I:%M %p %Z")
        name = sender_name or sender_id[:12]
        return f"[Current time: {now}]\n[{message_id} {msg_ts}] {name}: {content}"

    async def handle_message(
        self,
        *,
        content: str,
        sender_name: str,
        sender_id: str,
        timestamp: float,
        conversation_id: str,
        message_id: str,
        group_members: str | None = None,
    ) -> str | None:
        """
        Process an inbound message through the Hermes agent.
        Returns the raw response text (with markers), or None if no response.
        The adapter handles marker parsing and routing.
        """
        envelope = self._format_envelope(
            content=content,
            sender_name=sender_name,
            sender_id=sender_id,
            timestamp=timestamp,
            message_id=message_id,
        )

        # Snapshot history before the (potentially long) agent call so
        # concurrent messages don't block each other — same pattern as OpenClaw.
        async with self._history_lock:
            history_snapshot = list(self._conversation_history)

        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None,
                self._run_agent_sync,
                envelope,
                history_snapshot,
            )
        except Exception as err:
            logger.error(f"Agent error: {err}")
            return "I encountered an error processing your message. Please try again."

        # Append to shared history after the call completes.
        # Hermes handles context window management internally via
        # ContextCompressor and session splitting.
        async with self._history_lock:
            self._conversation_history.append({"role": "user", "content": envelope})
            if result.get("final_response"):
                self._conversation_history.append({
                    "role": "assistant",
                    "content": result["final_response"],
                })

        response = result.get("final_response", "")
        if not response or not response.strip():
            return None

        return response

    def _run_agent_sync(self, user_message: str, history: list[dict]) -> dict:
        """Synchronous wrapper — runs in thread pool.

        Takes a history snapshot so concurrent calls don't block each other.
        History append happens back in the async caller.
        """
        agent = self._ensure_agent()
        return agent.run_conversation(
            user_message=user_message,
            conversation_history=history,
        )

    def reset_history(self) -> None:
        """Clear conversation history (used on session reset)."""
        self._conversation_history.clear()
