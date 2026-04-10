"""
Agent runner — wraps the Hermes AIAgent for conversational message handling.

Used by both production and evals:

  Production: src.main → FastAPI server → AgentRunner.handle_message()
    Full XMTP pipeline with envelope formatting, async message handling,
    and disk-backed conversation history (resumed from state.db on restart
    via $HERMES_HOME/convos_session.json).

  Evals: bin/hermes → python -m src.server.agent_runner -q "query"
    Single-turn queries via AgentRunner.run_single_query().
    Same AIAgent config, same toolsets, same skills — no wrapper scripts.

Both paths use the same AIAgent setup:
  - hermes-convos toolset (core tools + convos_react, convos_send_attachment)
  - platform="convos"
  - ephemeral_system_prompt from INJECTED_CONTEXT.md

The adapter (channel.py) handles marker parsing and response routing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
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
        from src.convos.actions import register_convos_tools

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
    from .paths import HERMES_ROOT

    hermes_home = os.environ.get("HERMES_HOME", "")
    candidates = [
        *([] if not hermes_home else [Path(RuntimeConfig.workspace_path(hermes_home, "INJECTED_CONTEXT.md"))]),
        HERMES_ROOT / "workspace" / "INJECTED_CONTEXT.md",
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

        # Conversation history is NOT held in-memory.  The upstream Hermes
        # AIAgent already persists every message (including tool calls and
        # tool results) to ``state.db`` via its session DB on every turn.
        # We read it back via ``get_messages_as_conversation`` at the start
        # of each turn, which means:
        #   - tool-call history is visible across turns (no more re-sending
        #     attachments because the model can't see its own hands)
        #   - the conversation survives process restarts
        #   - todo state hydration works
        # See ``$HERMES_HOME/convos_session.json`` for the conversation_id
        # → session_id pointer that lets us resume after a restart.
        self._agent: Any = None
        self._session_db: Any = None
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

    # ── Resumable session pointer ──────────────────────────────────────
    # The upstream AIAgent persists messages to ``state.db`` keyed by an
    # auto-generated ``session_id``.  Without an external mapping, every
    # process restart mints a fresh session_id and the prior history is
    # orphaned in the DB (still there, never read).  We persist a tiny
    # ``conversation_id → session_id`` pointer alongside ``state.db`` so
    # the runtime can resume the right session after a restart.  The
    # pointer is also rewritten after every turn because compression can
    # roll the session_id forward mid-process (run_agent.py:6090).

    @staticmethod
    def _session_pointer_path(hermes_home: str) -> Path:
        return Path(hermes_home or os.path.expanduser("~/.hermes")) / "convos_session.json"

    @classmethod
    def _read_session_pointer(cls, hermes_home: str, conversation_id: str) -> str | None:
        """Return the persisted session_id for ``conversation_id``, or None."""
        if not conversation_id:
            return None
        try:
            path = cls._session_pointer_path(hermes_home)
            if not path.exists():
                return None
            data = json.loads(path.read_text())
        except Exception as err:
            logger.warning("Failed to read convos session pointer: %s", err)
            return None
        if data.get("conversation_id") != conversation_id:
            # Pointer belongs to a different conversation — ignore it.
            # The runtime hosts one conversation per process, so a mismatch
            # means the volume was reused; starting fresh is correct.
            return None
        sid = data.get("session_id")
        return sid if isinstance(sid, str) and sid else None

    @classmethod
    def _write_session_pointer(cls, hermes_home: str, conversation_id: str, session_id: str) -> None:
        """Atomically persist ``conversation_id → session_id``.

        Tolerates failures (logs and returns) — losing the pointer just
        means the next restart starts a fresh session, not data corruption.
        """
        if not conversation_id or not session_id:
            return
        try:
            path = cls._session_pointer_path(hermes_home)
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {"conversation_id": conversation_id, "session_id": session_id}
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=path.parent,
                prefix=".convos_session.",
                suffix=".tmp",
                delete=False,
            ) as tmp:
                json.dump(payload, tmp)
                tmp.flush()
                os.fsync(tmp.fileno())
                tmp_path = tmp.name
            os.replace(tmp_path, path)
        except Exception as err:
            logger.warning("Failed to write convos session pointer: %s", err)

    @classmethod
    def _clear_session_pointer(cls, hermes_home: str) -> None:
        try:
            cls._session_pointer_path(hermes_home).unlink(missing_ok=True)
        except Exception as err:
            logger.warning("Failed to clear convos session pointer: %s", err)

    def _create_agent(self) -> Any:
        """Create the AIAgent instance. Caller must hold _agent_init_lock."""
        if self._openrouter_api_key:
            os.environ.setdefault("OPENROUTER_API_KEY", self._openrouter_api_key)

        if self._hermes_home:
            os.environ["HERMES_HOME"] = self._hermes_home
            os.environ.setdefault("SKILLS_ROOT", str(Path(self._hermes_home) / "skills"))
            os.environ.setdefault("WORKSPACE_SKILLS", str(Path(self._hermes_home) / "workspace" / "skills"))

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

        # Resume the prior session if a pointer exists for this conversation.
        # ``create_session`` in the upstream library uses INSERT OR IGNORE so
        # passing an existing session_id is a safe no-op for the DB row.
        resumed_session_id = self._read_session_pointer(self._hermes_home, self._conversation_id)
        if resumed_session_id:
            logger.info(
                "Resuming convos session %s for conversation %s",
                resumed_session_id,
                (self._conversation_id or "")[:12],
            )

        AIAgent = _get_ai_agent_class()
        self._agent = AIAgent(
            model=self._model,
            max_iterations=self._max_iterations,
            enabled_toolsets=["hermes-convos"],
            platform="convos",
            ephemeral_system_prompt=CONVOS_EPHEMERAL_PROMPT,
            quiet_mode=os.path.isfile("/.dockerenv"),
            session_db=self._session_db,
            session_id=resumed_session_id,  # None → library auto-generates
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

        # Persist the pointer immediately so a crash before the first reply
        # still records the mapping.  Captures auto-generated IDs too.
        self._write_session_pointer(
            self._hermes_home, self._conversation_id, self._agent.session_id
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
        group_members: str | None = None,
        agent_name: str | None = None,
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
        header = f"[Current time: {now_str}]"
        if agent_name:
            header += f"\n[AgentName: {agent_name}]"
        if group_members:
            header += f"\n[Group members: {group_members}]"
        return f"{header}\n[{message_id} {msg_ts}] {name}: {content}"

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
        agent_name: str | None = None,
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
            group_members=group_members,
            agent_name=agent_name,
        )

        # All agent-state work for this turn (creation if needed, history
        # load, run_conversation, pointer write) is delegated to
        # _run_agent_sync inside the executor.  This keeps handle_message
        # itself free of any direct self._agent access — the only place in
        # agent_runner.py that calls _ensure_agent is _run_agent_sync.
        # (channel.py has its own _ensure_agent calls for interrupt control;
        # all calls share the same double-checked lock so duplicate-creation
        # is impossible regardless of which thread invokes them.)
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(
                None,
                self._run_agent_sync,
                envelope,
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
        # adapter (_dispatch_response in channel.py) can send these
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

        if was_interrupted or not response or not response.strip():
            return None

        return response

    def _run_agent_sync(self, user_message: str) -> dict:
        """Synchronous wrapper — runs in thread pool.

        Owns the full agent lifecycle for one turn:
          1. Materialize (or reuse) the AIAgent.
          2. Load the rich message trajectory from state.db for the agent's
             current session_id.  The upstream library has been writing
             every prior message (including tool calls and tool results)
             via _persist_session, so reading it back gives the model
             visibility into its own tool history.
          3. Run the conversation turn.
          4. Persist the (possibly compression-rolled) session_id to the
             on-disk pointer so the next process resumes the right session.

        Centralizing this in one place keeps _run_agent_sync the single
        owner of agent-state writes within agent_runner.py.  (channel.py
        also calls _ensure_agent directly for interrupt control — that's
        a pre-existing call site protected by the same double-checked lock.)
        """
        agent = self._ensure_agent()

        # Load history for the current session.  Falls back to empty if the
        # session DB is unavailable (degraded but functional) or the read
        # fails for any reason.
        history: list[dict] = []
        if self._session_db is not None:
            try:
                history = self._session_db.get_messages_as_conversation(agent.session_id)
            except Exception as err:
                logger.warning(
                    "Failed to load history for session %s: %s — starting empty",
                    agent.session_id, err,
                )

        try:
            return agent.run_conversation(
                user_message=user_message,
                conversation_history=history,
            )
        finally:
            # ContextCompressor may have rolled the session_id forward
            # mid-turn by mutating agent.session_id in place
            # (run_agent.py:6090).  Persist the latest ID even on failure
            # paths so the next process resumes the post-compression session.
            self._write_session_pointer(
                self._hermes_home, self._conversation_id, agent.session_id
            )

    def run_single_query(self, query: str) -> str:
        """Run a single query.  Returns response text.

        Note: this still loads any prior history for the current session
        from state.db, same as handle_message.  Eval callers that need a
        clean slate should call ``reset_history()`` first.
        """
        result = self._run_agent_sync(query)
        text = (result.get("final_response", "") if isinstance(result, dict) else str(result))
        return text.strip()

    def reset_history(self) -> None:
        """Start a fresh session for the next message.

        Used between eval phases (store → recall) where the memory files on
        disk change and the agent must rebuild its system prompt to pick up
        the new snapshot.

        Ends the current session in the DB, drops the on-disk pointer, and
        clears the cached AIAgent.  The next call to ``_ensure_agent`` will
        construct a new agent with a fresh session_id and rebuild the system
        prompt from disk.
        """
        with self._agent_init_lock:
            if self._agent is not None and self._session_db is not None:
                try:
                    self._session_db.end_session(self._agent.session_id, "user_reset")
                except Exception as err:
                    logger.warning(
                        "Failed to end session %s: %s", self._agent.session_id, err
                    )
            self._clear_session_pointer(self._hermes_home)
            self._agent = None  # next _ensure_agent() mints a fresh one


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
