"""Identity management — writes SOUL.md into HERMES_HOME for the agent persona."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from .config import RuntimeConfig


def write_instructions(hermes_home: str, raw_instructions: str | None) -> None:
    """Write custom instructions into HERMES_HOME/SOUL.md.

    Hermes reads SOUL.md as the agent's persona and identity.
    """
    if not raw_instructions or not raw_instructions.strip():
        return

    soul_path = Path(hermes_home) / "SOUL.md"
    soul_path.parent.mkdir(parents=True, exist_ok=True)

    base = ""
    if soul_path.exists():
        base = soul_path.read_text()

    marker = "## Custom Instructions"
    idx = base.find(marker)
    if idx != -1:
        import re
        base = re.sub(r"\n---\s*\n*$", "", base[:idx])

    if base.strip():
        content = f"{base.strip()}\n\n---\n\n{marker}\n\n{raw_instructions}"
    else:
        content = f"{marker}\n\n{raw_instructions}"

    soul_path.write_text(content)


def ensure_workspace(workspace_dir: str) -> None:
    """Create workspace directory with default files if missing."""
    ws = Path(workspace_dir)
    ws.mkdir(parents=True, exist_ok=True)

    bundled = Path(__file__).resolve().parent.parent.parent / "workspace"
    if bundled.exists():
        for f in bundled.iterdir():
            dest = ws / f.name
            if not dest.exists():
                if f.is_file():
                    shutil.copy2(f, dest)
                elif f.is_dir():
                    shutil.copytree(f, dest)
