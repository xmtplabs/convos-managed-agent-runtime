"""Outbound text policy — rewrite or suppress agent text before sending to users.

Mirrors the openclaw outbound-policy.ts layer so both runtimes present
the same user-facing messages for provider errors, credit exhaustion, etc.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

LOW_CREDIT_THRESHOLD = 0.50


@dataclass
class PolicyResult:
    suppress: bool
    text: str


# ── Pattern lists ────────────────────────────────────────────────────────

_OVERLOADED_PATTERNS = [
    "temporarily overloaded",
    "overloaded_error",
    "service unavailable",
    "high demand",
]

_CREDIT_PATTERNS = [
    "limit exceeded",
    "openrouter.ai/settings",
    "afford",
]


# ── Helpers ──────────────────────────────────────────────────────────────

def _is_overloaded(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in _OVERLOADED_PATTERNS)


def _is_credit_error(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in _CREDIT_PATTERNS)


def _is_context_overflow(text: str) -> bool:
    return text.startswith("Context overflow:")


def _build_credit_message() -> str:
    domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")
    ngrok = os.environ.get("NGROK_URL", "")
    port = os.environ.get("POOL_SERVER_PORT") or os.environ.get("PORT") or "18789"
    if domain:
        base = f"https://{domain}"
    elif ngrok:
        base = ngrok.rstrip("/")
    else:
        base = f"http://127.0.0.1:{port}"
    return f"Hey! I'm out of credits. You can top up here: {base}/web-tools/services"


async def _check_credits_low() -> bool:
    instance_id = os.environ.get("INSTANCE_ID", "")
    gateway_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
    pool_url = os.environ.get("POOL_URL", "")
    if not instance_id or not gateway_token or not pool_url:
        return False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.post(
                f"{pool_url}/api/pool/credits-check",
                json={"instanceId": instance_id, "gatewayToken": gateway_token},
            )
        if res.status_code != 200:
            return False
        remaining = res.json().get("remaining", float("inf"))
        return remaining < LOW_CREDIT_THRESHOLD
    except Exception:
        return False


# ── Public API ───────────────────────────────────────────────────────────

async def apply_outbound_policy(text: str) -> PolicyResult:
    """Apply rewrite rules to outbound text before sending to the user."""
    if _is_credit_error(text):
        return PolicyResult(suppress=False, text=_build_credit_message())

    if _is_context_overflow(text) and await _check_credits_low():
        return PolicyResult(suppress=False, text=_build_credit_message())

    if _is_overloaded(text):
        return PolicyResult(
            suppress=False,
            text="I'm having trouble with my AI provider right now \u2014 please try again in a moment.",
        )

    return PolicyResult(suppress=False, text=text)
