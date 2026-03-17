"""
Agent runner — wraps the Hermes AIAgent for conversational message handling.

Used by both production and evals:

  Production: src.main → FastAPI server → AgentRunner.handle_message()
    Full XMTP pipeline with envelope formatting, conversation history,
    and async message handling.

  Evals: bin/hermes → python -m src.agent_runner -q "query"
    Single-turn queries via AgentRunner.run_single_query().
    Same AIAgent config, same toolsets, same skills — no wrapper scripts.

Both paths use the same AIAgent setup:
  - hermes-convos toolset (core tools + convos_react, convos_send_attachment)
  - platform="convos"
  - ephemeral_system_prompt from CONVOS_PROMPT.md

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
        from src.convos_web_tools import register_convos_web_tools

        convos_tool_names = ["convos_react", "convos_send_attachment"]
        all_tools = list(_HERMES_CORE_TOOLS) + convos_tool_names
        create_custom_toolset(
            name="hermes-convos",
            description="Convos XMTP messenger toolset — E2E encrypted group chat with terminal, file, web, browser, memory, skills, messaging",
            tools=all_tools,
            includes=[],
        )
        register_convos_tools()
        # Overwrite Firecrawl-gated web tools with OpenRouter + local fetch
        register_convos_web_tools()
        _toolset_registered = True
        logger.info("Registered hermes-convos toolset (%d tools)", len(all_tools))


def _get_ai_agent_class():
    if _AIAgent is None:
        raise RuntimeError("AIAgent not imported — call warm_imports() from the main thread first")
    return _AIAgent


def _load_convos_prompt() -> str:
    """Load the Convos platform prompt from workspace or HERMES_HOME."""
    hermes_home = os.environ.get("HERMES_HOME", "")
    candidates = [
        *([] if not hermes_home else [Path(hermes_home) / "CONVOS_PROMPT.md"]),
        Path(__file__).resolve().parent.parent / "workspace" / "CONVOS_PROMPT.md",
    ]
    for path in candidates:
        if path.exists():
            return path.read_text().strip()
    logger.warning("CONVOS_PROMPT.md not found — agent will lack platform context")
    return ""


CONVOS_EPHEMERAL_PROMPT = _load_convos_prompt()


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
            os.environ.setdefault("SKILLS_ROOT", str(Path(self._hermes_home) / "skills"))

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
            quiet_mode=os.path.isfile("/.dockerenv"),
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

        response = result.get("final_response", "")

        # Normalize SILENT: the agent chose not to reply. Strip the marker
        # so it never appears in conversation history as assistant text.
        is_silent = bool(response and "SILENT" in response.strip().splitlines())

        # Append to shared history after the call completes.
        # Hermes handles context window management internally via
        # ContextCompressor and session splitting.
        async with self._history_lock:
            self._conversation_history.append({"role": "user", "content": envelope})
            if response and not is_silent:
                self._conversation_history.append({
                    "role": "assistant",
                    "content": response,
                })

        if is_silent or not response or not response.strip():
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

    def run_single_query(self, query: str) -> str:
        """Run a single query with no conversation history. Returns response text."""
        result = self._run_agent_sync(query, [])
        text = (result.get("final_response", "") if isinstance(result, dict) else str(result))
        return text.strip()

    def reset_history(self) -> None:
        """Clear conversation history (used on session reset)."""
        self._conversation_history.clear()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("-q", "--query", required=True)
    args, _ = parser.parse_known_args()

    model = os.environ.get("OPENCLAW_PRIMARY_MODEL") or os.environ.get("HERMES_MODEL") or "anthropic/claude-sonnet-4-6"
    if model.startswith("openrouter/"):
        model = model.removeprefix("openrouter/")

    warm_imports()
    runner = AgentRunner(model=model, hermes_home=os.environ.get("HERMES_HOME", ""))
    response = runner.run_single_query(args.query)
    if response:
        print(response)
