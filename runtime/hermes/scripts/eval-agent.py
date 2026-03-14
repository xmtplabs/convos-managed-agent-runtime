#!/usr/bin/env python3
"""
Eval entrypoint — mirrors production agent_runner.py AIAgent setup.

Uses the same AIAgent configuration as production:
  - enabled_toolsets=["hermes-convos"]
  - platform="convos"
  - ephemeral_system_prompt from CONVOS_PROMPT.md
  - quiet_mode=True

Does NOT go through hermes_cli/main.py, so no sync_skills() runs
and no bundled skills are injected. Only workspace skills in
HERMES_HOME/skills/ are available — matching the Docker production image.
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
    parser.add_argument("-Q", "--quiet", action="store_true")
    args, _ = parser.parse_known_args()

    from src.agent_runner import warm_imports, CONVOS_EPHEMERAL_PROMPT

    warm_imports()

    from run_agent import AIAgent

    model = os.environ.get("OPENCLAW_PRIMARY_MODEL") or os.environ.get("HERMES_MODEL") or "anthropic/claude-sonnet-4-6"
    if model.startswith("openrouter/"):
        model = model.removeprefix("openrouter/")

    agent = AIAgent(
        model=model,
        enabled_toolsets=["hermes-convos"],
        platform="convos",
        ephemeral_system_prompt=CONVOS_EPHEMERAL_PROMPT,
        quiet_mode=True,
    )

    result = agent.run_conversation(user_message=args.query)
    response = result.get("final_response", "") if isinstance(result, dict) else str(result)

    if response:
        print(response)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
