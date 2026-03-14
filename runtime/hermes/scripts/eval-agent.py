#!/usr/bin/env python3
"""
Eval entrypoint — thin CLI wrapper around the production AgentRunner.

No custom AIAgent setup. Uses the same code path as the production server.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def setup_paths() -> None:
    runtime_dir = Path(__file__).resolve().parent.parent
    candidates = [
        os.environ.get("HERMES_AGENT_DIR"),
        str(runtime_dir / ".hermes-dev" / "hermes-agent"),
        "/opt/hermes-agent",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        if Path(candidate).exists():
            sys.path.insert(0, candidate)
    sys.path.insert(0, str(runtime_dir))


def main() -> int:
    setup_paths()

    parser = argparse.ArgumentParser()
    parser.add_argument("-q", "--query", required=True)
    args, _ = parser.parse_known_args()

    from src.agent_runner import AgentRunner, warm_imports

    model = os.environ.get("OPENCLAW_PRIMARY_MODEL") or os.environ.get("HERMES_MODEL") or "anthropic/claude-sonnet-4-6"
    if model.startswith("openrouter/"):
        model = model.removeprefix("openrouter/")

    warm_imports()
    runner = AgentRunner(
        model=model,
        hermes_home=os.environ.get("HERMES_HOME", ""),
    )
    response = runner.run_single_query(args.query)
    if response:
        print(response)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
