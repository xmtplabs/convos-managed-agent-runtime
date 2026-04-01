"""Outbound text policy — rewrite or suppress agent text before sending to users.

Rules loaded from convos-platform/outbound-policy.json so both runtimes
share the same patterns, thresholds, and messages.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# ── Load shared policy ──────────────────────────────────────────────────

_POLICY_PATHS = [
    Path("/app/convos-platform/outbound-policy.json"),
    Path(__file__).resolve().parent.parent.parent.parent / "convos-platform" / "outbound-policy.json",
]

_policy: dict = {}
for _p in _POLICY_PATHS:
    if _p.exists():
        _policy = json.loads(_p.read_text())
        break

LOW_CREDIT_THRESHOLD = _policy.get("lowCreditThreshold", 0.50)
_OVERLOADED_PATTERNS = _policy.get("overloadedPatterns", [])
_RATE_LIMIT_PATTERNS = _policy.get("rateLimitPatterns", [])
_CREDIT_PATTERNS = _policy.get("creditPatterns", [])
_CONTEXT_OVERFLOW_PREFIX = _policy.get("contextOverflowPrefix", "Context overflow:")
_SUPPRESS_TOKENS = set(_policy.get("suppressTokens", []))
_CREDIT_MSG_TEMPLATE = _policy.get("creditMessageTemplate", "Hey! I'm out of credits. You can top up here: {{servicesUrl}}")


@dataclass
class PolicyResult:
    suppress: bool
    text: str


# ── Analysis scratchpad stripping ────────────────────────────────────────

_ANALYSIS_RE = re.compile(r"<analysis>[\s\S]*?</analysis>")
_SUMMARY_TAG_RE = re.compile(r"</?summary>")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")


def strip_analysis_scratchpad(text: str) -> str:
    """Strip ``<analysis>…</analysis>`` scratchpad blocks from sub-agent output.

    Unwrap ``<summary>…</summary>`` tags (keep inner content).
    If neither tag is present, return text unchanged (backward compat).
    """
    if "<analysis>" not in text:
        return text
    result = _ANALYSIS_RE.sub("", text)
    result = _SUMMARY_TAG_RE.sub("", result)
    return _MULTI_NEWLINE_RE.sub("\n\n", result).strip()


# ── Helpers ──────────────────────────────────────────────────────────────

def _is_overloaded(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in _OVERLOADED_PATTERNS)


def _is_rate_limited(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in _RATE_LIMIT_PATTERNS)


def _is_credit_error(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in _CREDIT_PATTERNS)


def _is_context_overflow(text: str) -> bool:
    return text.startswith(_CONTEXT_OVERFLOW_PREFIX)


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
    return _CREDIT_MSG_TEMPLATE.replace("{{servicesUrl}}", f"{base}/web-tools/services")


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
    trimmed = text.strip()

    if trimmed in _SUPPRESS_TOKENS:
        return PolicyResult(suppress=True, text="")

    # Rate-limit check BEFORE credit check — "rate limit exceeded" contains
    # the substring "limit exceeded" which would false-positive on creditPatterns.
    if _is_rate_limited(text):
        return PolicyResult(suppress=True, text="")

    if _is_credit_error(text):
        return PolicyResult(suppress=False, text=_build_credit_message())

    if _is_context_overflow(text) and await _check_credits_low():
        return PolicyResult(suppress=False, text=_build_credit_message())

    if _is_overloaded(text):
        return PolicyResult(suppress=True, text="")

    return PolicyResult(suppress=False, text=strip_analysis_scratchpad(text))
