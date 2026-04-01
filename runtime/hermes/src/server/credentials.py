"""
Convos credential persistence — saves identity + conversation to disk
so Hermes can auto-resume after a restart.

File convention matches OpenClaw: $STATE_DIR/credentials/convos-identity.json
Schema: {identityId, conversationId, env}
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

CREDENTIALS_FILE = "convos-identity.json"


class ConvosCredentials(TypedDict):
    identityId: str
    conversationId: str
    env: str


def _credentials_path(hermes_home: str) -> Path:
    return Path(hermes_home) / "credentials" / CREDENTIALS_FILE


def load_credentials(hermes_home: str) -> ConvosCredentials | None:
    p = _credentials_path(hermes_home)
    try:
        data = json.loads(p.read_text())
        if data.get("identityId") and data.get("conversationId") and data.get("env"):
            return ConvosCredentials(
                identityId=data["identityId"],
                conversationId=data["conversationId"],
                env=data["env"],
            )
        return None
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return None


def save_credentials(hermes_home: str, creds: ConvosCredentials) -> None:
    p = _credentials_path(hermes_home)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(creds, indent=2) + "\n")
    logger.info("Saved convos credentials: conversation=%s", creds["conversationId"][:12])


def clear_credentials(hermes_home: str) -> None:
    p = _credentials_path(hermes_home)
    try:
        p.unlink(missing_ok=True)
        logger.info("Cleared convos credentials")
    except Exception as err:
        logger.warning("Failed to clear convos credentials: %s", err)
