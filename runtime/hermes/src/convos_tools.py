"""
Custom Hermes tools for Convos — registered in the agent's tool loop.

convos_react executes mid-processing so the agent can add eyes (thinking
indicator) before doing tool work, and react to messages at any time.
convos_send_attachment sends files during processing.

The agent's final text response is dispatched by the adapter — there is no
convos_send tool. This avoids the empty-response retry problem since Hermes
always expects a non-empty final response from the model.

The adapter sets callbacks via set_bridge() before the agent starts.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from tools.registry import registry

logger = logging.getLogger(__name__)

_react: Callable[..., Any] | None = None
_send_attachment: Callable[..., Any] | None = None
_main_loop: asyncio.AbstractEventLoop | None = None


def set_bridge(
    *,
    react: Callable[..., Any],
    send_attachment: Callable[..., Any] | None = None,
) -> None:
    """Wire bridge callbacks. Called by ConvosAdapter.start() on the main thread."""
    global _react, _send_attachment, _main_loop
    _react = react
    _send_attachment = send_attachment
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
    logger.info("Registered convos tools (convos_react, convos_send_attachment)")
