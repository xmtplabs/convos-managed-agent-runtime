"""Centralized path resolution for Hermes runtime resources.

Instead of counting parent directories from __file__, this module
resolves roots by walking up to well-known anchor files.  This is
immune to directory-level changes (the bug class from #803 / #810).

Two roots are resolved at import time:

  HERMES_ROOT   — the hermes package directory.
                  Docker: /app   Local: runtime/hermes/
                  Anchor: requirements.txt

  PLATFORM_ROOT — the directory that contains convos-platform/.
                  Docker: /app   Local: runtime/
                  Anchor: convos-platform/ directory
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_HERE = Path(__file__).resolve().parent


def _find_ancestor(start: Path, marker: str) -> Path | None:
    """Walk up from *start* to find the nearest ancestor containing *marker*."""
    current = start
    for _ in range(10):
        if (current / marker).exists():
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


HERMES_ROOT: Path = (
    Path(os.environ["HERMES_ROOT"]).resolve() if "HERMES_ROOT" in os.environ
    else _find_ancestor(_HERE, "requirements.txt") or _HERE
)

PLATFORM_ROOT: Path = (
    Path(os.environ["PLATFORM_ROOT"]).resolve() if "PLATFORM_ROOT" in os.environ
    else _find_ancestor(_HERE, "convos-platform") or HERMES_ROOT
)

logger.info("Resolved paths: HERMES_ROOT=%s  PLATFORM_ROOT=%s", HERMES_ROOT, PLATFORM_ROOT)
