"""
Web tools for Convos — replaces Firecrawl-gated tools with OpenRouter + local fetch.

web_search:  Perplexity Sonar via the per-instance OpenRouter key.
web_extract: httpx GET + readability-lxml for HTML→text extraction.

Both re-register over the upstream Firecrawl tools in the Hermes registry,
so the agent sees the same tool names with no config change.
"""

from __future__ import annotations

import json
import logging
import os
from typing import List

import httpx
from openai import OpenAI
from tools.registry import registry

logger = logging.getLogger(__name__)

_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
_SEARCH_MODEL = "@preset/assistants-web-search"
_MAX_EXTRACT_BYTES = 2_000_000  # 2 MB download cap
_MAX_EXTRACT_CHARS = 50_000  # truncate extracted text


def _openrouter_key() -> str:
    return os.environ.get("OPENROUTER_API_KEY", "")


# ---------------------------------------------------------------------------
# web_search — Perplexity Sonar via OpenRouter
# ---------------------------------------------------------------------------

def web_search(query: str, limit: int = 5) -> str:
    """Search the web using Perplexity Sonar through OpenRouter."""
    key = _openrouter_key()
    if not key:
        return json.dumps({"success": False, "error": "OPENROUTER_API_KEY not set"})

    try:
        client = OpenAI(api_key=key, base_url=_OPENROUTER_BASE, timeout=30.0)
        resp = client.chat.completions.create(
            model=_SEARCH_MODEL,
            messages=[{"role": "user", "content": query}],
        )

        answer = resp.choices[0].message.content or ""
        citations: list = getattr(resp, "citations", None) or []

        # Build result list from citations
        results = []
        for i, url in enumerate(citations[:limit]):
            results.append({"title": url, "url": url, "description": "", "position": i + 1})

        return json.dumps({
            "success": True,
            "answer": answer,
            "data": {"web": results},
        })
    except Exception as exc:
        logger.error("web_search failed: %s", exc)
        return json.dumps({"success": False, "error": str(exc)})


# ---------------------------------------------------------------------------
# web_extract — local HTTP fetch + readability
# ---------------------------------------------------------------------------

def _extract_readable(html: str, url: str) -> str:
    """Extract readable text from HTML using readability-lxml."""
    try:
        from readability import Document
        doc = Document(html, url=url)
        # .summary() returns cleaned HTML of the main content
        summary_html = doc.summary()
        title = doc.short_title()

        # Simple HTML→text: strip tags, keep structure
        import re
        text = re.sub(r"<br\s*/?>", "\n", summary_html)
        text = re.sub(r"</(p|div|h[1-6]|li|tr)>", "\n", text)
        text = re.sub(r"<[^>]+>", "", text)
        # Collapse whitespace but keep newlines
        text = re.sub(r"[^\S\n]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

        if title:
            text = f"# {title}\n\n{text}"
        return text
    except ImportError:
        logger.warning("readability-lxml not installed — returning raw text")
        import re
        text = re.sub(r"<[^>]+>", " ", html)
        return re.sub(r"\s+", " ", text).strip()


async def web_extract(urls: List[str]) -> str:
    """Fetch URLs and extract readable content."""
    results = []
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        headers={"User-Agent": "Mozilla/5.0 (compatible; HermesAgent/1.0)"},
    ) as client:
        for url in urls[:5]:
            try:
                resp = await client.get(url, headers={"Accept": "text/html,*/*"})
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "")
                raw = resp.text

                if len(raw) > _MAX_EXTRACT_BYTES:
                    results.append({
                        "url": url,
                        "success": False,
                        "error": f"Page too large ({len(raw):,} bytes)",
                    })
                    continue

                if "html" in content_type:
                    text = _extract_readable(raw, url)
                else:
                    text = raw

                if len(text) > _MAX_EXTRACT_CHARS:
                    text = text[:_MAX_EXTRACT_CHARS] + "\n\n[... truncated ...]"

                results.append({"url": url, "success": True, "content": text})

            except Exception as exc:
                results.append({"url": url, "success": False, "error": str(exc)})

    return json.dumps({"success": True, "results": results})


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

WEB_SEARCH_SCHEMA = {
    "name": "web_search",
    "description": (
        "Search the web for information. Returns an AI-synthesized answer "
        "with source URLs. Use web_extract to get full content from specific URLs."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to look up on the web",
            },
        },
        "required": ["query"],
    },
}

WEB_EXTRACT_SCHEMA = {
    "name": "web_extract",
    "description": (
        "Extract readable content from web page URLs. Returns page text. "
        "Works with HTML pages and plain text. For JavaScript-heavy sites "
        "that return empty content, use the browser tool instead."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "urls": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of URLs to extract content from (max 5)",
                "maxItems": 5,
            },
        },
        "required": ["urls"],
    },
}


# ---------------------------------------------------------------------------
# Registration — overwrites the Firecrawl-gated upstream tools
# ---------------------------------------------------------------------------

def register_convos_web_tools() -> None:
    """Re-register web tools to use OpenRouter + local fetch."""
    registry.register(
        name="web_search",
        toolset="web",
        schema=WEB_SEARCH_SCHEMA,
        handler=lambda args, **kw: web_search(args.get("query", ""), limit=5),
        check_fn=lambda: bool(_openrouter_key()),
    )
    registry.register(
        name="web_extract",
        toolset="web",
        schema=WEB_EXTRACT_SCHEMA,
        handler=lambda args, **kw: web_extract(
            args.get("urls", [])[:5] if isinstance(args.get("urls"), list) else [],
        ),
        check_fn=lambda: True,  # no API key needed
        is_async=True,
    )
    logger.info("Registered convos web tools (web_search via Perplexity Sonar, web_extract via local fetch)")
