"""
Custom Hermes tools for Convos — registered in the agent's tool loop.

convos_react executes mid-processing so the agent can add eyes (thinking
indicator) before doing tool work, and react to messages at any time.
convos_send_attachment sends files during processing.
convos_background_task kicks off a long-running task in the background —
the tool returns immediately so the agent's turn ends, and results are
injected as a system notification when the work completes.

The agent's final text response is dispatched by the adapter — there is no
convos_send tool. This avoids the empty-response retry problem since Hermes
always expects a non-empty final response from the model.

The adapter sets callbacks via set_bridge() before the agent starts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Callable

from tools.registry import registry

logger = logging.getLogger(__name__)

_react: Callable[..., Any] | None = None
_send_attachment: Callable[..., Any] | None = None
_spawn_background_task: Callable[..., Any] | None = None
_check_background_task: Callable[..., Any] | None = None
_main_loop: asyncio.AbstractEventLoop | None = None


def set_bridge(
    *,
    react: Callable[..., Any],
    send_attachment: Callable[..., Any] | None = None,
    spawn_background_task: Callable[..., Any] | None = None,
    check_background_task: Callable[..., Any] | None = None,
) -> None:
    """Wire bridge callbacks. Called by ConvosAdapter.start() on the main thread."""
    global _react, _send_attachment, _spawn_background_task, _check_background_task, _main_loop
    _react = react
    _send_attachment = send_attachment
    _spawn_background_task = spawn_background_task
    _check_background_task = check_background_task
    _main_loop = asyncio.get_event_loop()


def _run_async(coro) -> Any:
    """Schedule an async coroutine on the main event loop from a worker thread."""
    if _main_loop is None:
        raise RuntimeError("Bridge not connected — call set_bridge() first")
    future = asyncio.run_coroutine_threadsafe(coro, _main_loop)
    return future.result(timeout=30)


# ---- convos_react ----

REACT_SCHEMA = {
    "name": "convos_react",
    "description": (
        "React to a message with an emoji. "
        "Use this to signal you're working (react with eyes emoji), "
        "acknowledge messages, or express reactions."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "message_id": {
                "type": "string",
                "description": "The message ID to react to.",
            },
            "emoji": {
                "type": "string",
                "description": "The emoji to react with (e.g. 👀, 👍, ❤️).",
            },
            "remove": {
                "type": "boolean",
                "description": "Set to true to remove the reaction instead of adding it.",
            },
        },
        "required": ["message_id", "emoji"],
    },
}


def _handle_react(args: dict, **kwargs) -> str:
    if not _react:
        return json.dumps({"error": "Bridge not connected"})
    message_id = args.get("message_id", "")
    emoji = args.get("emoji", "")
    remove = args.get("remove", False)
    action = "remove" if remove else "add"
    if not message_id or not emoji:
        return json.dumps({"error": "message_id and emoji are required"})
    try:
        _run_async(_react(message_id, emoji, action))
        return json.dumps({"success": True, "action": action, "emoji": emoji})
    except Exception as err:
        logger.error(f"convos_react failed: {err}")
        return json.dumps({"error": str(err)})


# ---- convos_send_attachment ----

ATTACHMENT_SCHEMA = {
    "name": "convos_send_attachment",
    "description": "Send a file attachment in the Convos conversation.",
    "parameters": {
        "type": "object",
        "properties": {
            "file": {
                "type": "string",
                "description": "Path to the file to send.",
            },
        },
        "required": ["file"],
    },
}


def _handle_send_attachment(args: dict, **kwargs) -> str:
    if not _send_attachment:
        return json.dumps({"error": "Bridge not connected"})
    file_path = args.get("file", "")
    if not file_path:
        return json.dumps({"error": "file path is required"})
    try:
        _run_async(_send_attachment(file_path))
        return json.dumps({"success": True, "file": file_path})
    except Exception as err:
        logger.error(f"convos_send_attachment failed: {err}")
        return json.dumps({"error": str(err)})


# ---- convos_background_task ----

BACKGROUND_TASK_SCHEMA = {
    "name": "convos_background_task",
    "description": (
        "Kick off a long-running task in the background. "
        "Returns immediately so your turn ends and the user can keep chatting. "
        "You will be notified with results when the task completes. "
        "Use this for web browsing, research, or any multi-step work that "
        "would block the conversation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": (
                    "Clear description of what the background worker should accomplish. "
                    "The worker starts with a blank slate — include ALL necessary context."
                ),
            },
            "context": {
                "type": "string",
                "description": (
                    "Supporting context the worker needs: URLs, constraints, "
                    "file paths, prior findings. Be specific — the worker "
                    "cannot see your conversation history."
                ),
            },
        },
        "required": ["goal", "context"],
    },
}

MAX_BACKGROUND_TASKS = 3


def _handle_background_task(args: dict, **kwargs) -> str:
    if not _spawn_background_task:
        return json.dumps({"error": "Background tasks not available"})
    goal = args.get("goal", "").strip()
    context = args.get("context", "").strip()
    if not goal:
        return json.dumps({"error": "goal is required"})
    task_id = f"bg-{uuid.uuid4().hex[:8]}"
    try:
        _run_async(_spawn_background_task(task_id, goal, context))
        return json.dumps({
            "queued": True,
            "task_id": task_id,
            "instructions": (
                "The task is running in the background. You will be notified "
                "automatically when it completes. "
                "Do not duplicate this task's work. "
                "Briefly tell the user what you launched and end your response. "
                "If the user asks about progress, use convos_check_background_task."
            ),
        })
    except Exception as err:
        logger.error(f"convos_background_task failed: {err}")
        return json.dumps({"error": str(err)})


# ---- convos_check_background_task ----

CHECK_BACKGROUND_TASK_SCHEMA = {
    "name": "convos_check_background_task",
    "description": (
        "Check the status and progress of background tasks. "
        "Call with a task_id to check a specific task, or omit to list all running tasks."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The task ID to check (e.g. 'bg-abc12345'). Omit to list all.",
            },
        },
    },
}


def _handle_check_background_task(args: dict, **kwargs) -> str:
    if not _check_background_task:
        return json.dumps({"error": "Background tasks not available"})
    task_id = args.get("task_id", "").strip() or None
    try:
        result = _check_background_task(task_id)
        return json.dumps(result)
    except Exception as err:
        logger.error(f"convos_check_background_task failed: {err}")
        return json.dumps({"error": str(err)})


# ---- Registration ----

def register_convos_tools() -> None:
    """Register Convos tools in the Hermes tool registry."""
    registry.register(
        name="convos_react",
        toolset="hermes-convos",
        schema=REACT_SCHEMA,
        handler=_handle_react,
        check_fn=lambda: _react is not None,
    )
    registry.register(
        name="convos_send_attachment",
        toolset="hermes-convos",
        schema=ATTACHMENT_SCHEMA,
        handler=_handle_send_attachment,
        check_fn=lambda: _send_attachment is not None,
    )
    registry.register(
        name="convos_background_task",
        toolset="hermes-convos",
        schema=BACKGROUND_TASK_SCHEMA,
        handler=_handle_background_task,
        check_fn=lambda: _spawn_background_task is not None,
    )
    registry.register(
        name="convos_check_background_task",
        toolset="hermes-convos",
        schema=CHECK_BACKGROUND_TASK_SCHEMA,
        handler=_handle_check_background_task,
        check_fn=lambda: _check_background_task is not None,
    )
    logger.info("Registered convos tools (convos_react, convos_send_attachment, convos_background_task, convos_check_background_task)")
