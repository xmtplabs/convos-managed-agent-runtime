"""
Agent runner — wraps the Hermes AIAgent for conversational message handling.

Used by both production and evals:

  Production: src.main → FastAPI server → AgentRunner.handle_message()
    Full XMTP pipeline with envelope formatting, conversation history,
    and async message handling.

  Evals: bin/hermes → python -m src.server.agent_runner -q "query"
    Single-turn queries via AgentRunner.run_single_query().
    Same AIAgent config, same toolsets, same skills — no wrapper scripts.

Both paths use the same AIAgent setup:
  - hermes-convos toolset (core tools + convos_react, convos_send_attachment)
  - platform="convos"
  - ephemeral_system_prompt from INJECTED_CONTEXT.md

The adapter (convos_adapter.py) handles marker parsing and response routing.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import RuntimeConfig
from typing import Any

logger = logging.getLogger(__name__)

# Match OpenClaw's userTimezone (openclaw.json defaults to "America/New_York").
# Override via USER_TIMEZONE env var; falls back to UTC if the zone is invalid.
_tz_name = os.environ.get("USER_TIMEZONE", "America/New_York")
try:
    _USER_TZ = ZoneInfo(_tz_name)
except KeyError:
    logger.warning("Unknown timezone %r — falling back to UTC", _tz_name)
    _USER_TZ = timezone.utc

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
        from src.convos.convos_tools import register_convos_tools

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


def _load_convos_platform() -> str:
    """Load the Convos platform prompt from workspace or HERMES_HOME."""
    hermes_home = os.environ.get("HERMES_HOME", "")
    candidates = [
        *([] if not hermes_home else [Path(RuntimeConfig.workspace_path(hermes_home, "INJECTED_CONTEXT.md"))]),
        Path(__file__).resolve().parent.parent.parent / "workspace" / "INJECTED_CONTEXT.md",
    ]
    for path in candidates:
        if path.exists():
            return path.read_text().strip()
    logger.warning("INJECTED_CONTEXT.md not found — agent will lack platform context")
    return ""


CONVOS_EPHEMERAL_PROMPT = _load_convos_platform()


class AgentRunner:
    """Manages a Hermes AIAgent instance for one XMTP conversation."""

    def __init__(
        self,
        *,
        model: str = "@preset/assistants-pro",
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
        self._agent_init_lock = threading.Lock()  # protects lazy AIAgent creation

    def _ensure_agent(self) -> Any:
        """Lazily initialize the Hermes AIAgent (thread-safe)."""
        if self._agent is not None:
            return self._agent

        with self._agent_init_lock:
            if self._agent is not None:
                return self._agent
            return self._create_agent()

    @staticmethod
    def _load_config_yaml(hermes_home: str) -> dict:
        """Load config.yaml from HERMES_HOME root."""
        try:
            import yaml
            cfg_path = Path(hermes_home or os.path.expanduser("~/.hermes")) / "config.yaml"
            if cfg_path.exists():
                with open(cfg_path, encoding="utf-8") as f:
                    return yaml.safe_load(f) or {}
        except Exception:
            pass
        return {}

    def _create_agent(self) -> Any:
        """Create the AIAgent instance. Caller must hold _agent_init_lock."""
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

        # Load config.yaml for provider routing, fallback model, and
        # reasoning config — same sections the gateway passes through.
        cfg = self._load_config_yaml(self._hermes_home)
        pr = cfg.get("provider_routing", {}) or {}
        fallback = cfg.get("fallback_providers") or cfg.get("fallback_model") or None

        reasoning_config = None
        try:
            from hermes_constants import parse_reasoning_effort
            effort = str((cfg.get("agent") or {}).get("reasoning_effort", "") or "").strip()
            if not effort:
                effort = os.environ.get("HERMES_REASONING_EFFORT", "")
            if effort:
                reasoning_config = parse_reasoning_effort(effort)
        except Exception:
            pass

        AIAgent = _get_ai_agent_class()
        self._agent = AIAgent(
            model=self._model,
            max_iterations=self._max_iterations,
            enabled_toolsets=["hermes-convos"],
            platform="convos",
            ephemeral_system_prompt=CONVOS_EPHEMERAL_PROMPT,
            quiet_mode=os.path.isfile("/.dockerenv"),
            session_db=self._session_db,
            save_trajectories=True,
            providers_allowed=pr.get("only"),
            providers_ignored=pr.get("ignore"),
            providers_order=pr.get("order"),
            provider_sort=pr.get("sort"),
            provider_require_parameters=pr.get("require_parameters", False),
            provider_data_collection=pr.get("data_collection"),
            fallback_model=fallback,
            reasoning_config=reasoning_config,
        )

        # Fix upstream bug (NousResearch/hermes-agent#4377): Hermes checks
        # bool(getattr(client, "is_closed", False)) but openai SDK's is_closed
        # is a method, not a property — the bound method object is always truthy,
        # causing every API call to recreate the shared client unnecessarily.
        def _is_openai_client_closed_fixed(client):
            from unittest.mock import Mock
            if isinstance(client, Mock):
                return False
            is_closed = getattr(client, "is_closed", False)
            if callable(is_closed):
                is_closed = is_closed()
            if bool(is_closed):
                return True
            http_client = getattr(client, "_client", None)
            return bool(getattr(http_client, "is_closed", False))

        self._agent._is_openai_client_closed = _is_openai_client_closed_fixed
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
        """Format an inbound message with current time and full message ID.

        Uses the same timezone and format as OpenClaw's Intl.DateTimeFormat
        (en-US, weekday short / year numeric / month short / day numeric /
        hour numeric / minute 2-digit / timeZoneName short).
        """
        msg_ts = datetime.fromtimestamp(timestamp, tz=_USER_TZ).strftime("%I:%M %p")
        now = datetime.now(tz=_USER_TZ)
        # Produce "Thu, Mar 20, 2026, 10:30 AM EDT" — matches OpenClaw's Intl output.
        now_str = now.strftime("%a, %b %-d, %Y, %-I:%M %p %Z")
        name = sender_name or sender_id[:12]
        return f"[Current time: {now_str}]\n[{message_id} {msg_ts}] {name}: {content}"

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

        # Detect credit exhaustion (HTTP 402) — run_conversation() returns
        # final_response=None on non-retryable errors, so the outbound policy
        # never sees the error text.  Surface the credit top-up message directly.
        if result.get("failed"):
            from .outbound_policy import _is_credit_error, _build_credit_message
            error_text = result.get("error", "")
            if _is_credit_error(error_text):
                logger.warning("Credit error detected in agent response: %s", error_text[:200])
                return _build_credit_message()
            logger.error("Agent failed (non-credit): %s", error_text[:200])
            return "I hit a temporary issue — give me a moment and try again."

        response = result.get("final_response", "")
        was_interrupted = result.get("interrupted", False)

        # Extract reasoning texts: assistant messages from tool-calling turns.
        # These are intermediate narration the model produced alongside tool
        # calls — e.g. "Let me search for that..." before a web_search call.
        # The third-party agent runner discards them from final_response but
        # they're preserved in the messages list.
        #
        # To expose reasoning in the UI instead of suppressing it, the
        # adapter (_dispatch_response in convos_adapter.py) can send these
        # before the final response using either:
        #
        #   (a) <think> tags — wrap text so the Convos client can parse and
        #       render differently (collapsible, dimmed, italic, etc.):
        #         for text in agent._last_reasoning_texts:
        #             await inst.send_message(f"<think>{text}</think>")
        #
        #   (b) XMTP content type — send as a distinct content type so the
        #       client can render a dedicated reasoning bubble:
        #         await inst.send_content_type("reasoning", text)
        #       (requires Convos client + protocol support for the new type)
        reasoning_texts: list[str] = []
        for msg_entry in result.get("messages", []):
            if msg_entry.get("role") != "assistant":
                continue
            if not msg_entry.get("tool_calls"):
                continue
            content = (msg_entry.get("content") or "").strip()
            if content:
                reasoning_texts.append(content)
        if reasoning_texts:
            logger.info(
                "[reasoning] %d intermediate text(s) from tool-calling turns: %s",
                len(reasoning_texts),
                [t[:60] for t in reasoning_texts],
            )
        self._last_reasoning_texts = reasoning_texts

        # Normalize SILENT: the agent chose not to reply. Strip the marker
        # so it never appears in conversation history as assistant text.
        is_silent = bool(response and "SILENT" in response.strip().splitlines())

        # Append to shared history after the call completes.
        # Hermes handles context window management internally via
        # ContextCompressor and session splitting.
        # Always record the user message so the agent sees what was said.
        # Skip the assistant response for interrupted turns — the partial
        # "Operation interrupted" diagnostic is not a real reply.
        async with self._history_lock:
            self._conversation_history.append({"role": "user", "content": envelope})
            if response and not is_silent and not was_interrupted:
                self._conversation_history.append({
                    "role": "assistant",
                    "content": response,
                })

        if was_interrupted or is_silent or not response or not response.strip():
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
        """Clear conversation history and invalidate the cached system prompt.

        The system prompt contains a frozen memory snapshot captured at first
        turn.  Between eval phases (store → recall) the memory files on disk
        change, so we must force a rebuild so the next turn picks up the new
        snapshot.
        """
        self._conversation_history.clear()
        if self._agent is not None:
            self._agent._invalidate_system_prompt()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("-q", "--query", required=True)
    args, _ = parser.parse_known_args()

    model = os.environ.get("HERMES_MODEL") or "@preset/assistants-pro"

    warm_imports()
    runner = AgentRunner(model=model, hermes_home=os.environ.get("HERMES_HOME", ""))
    response = runner.run_single_query(args.query)
    if response:
        print(response)
