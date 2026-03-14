"""Configuration loader — maps existing pool env vars to Hermes config."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field


@dataclass
class RuntimeConfig:
    # LLM
    openrouter_api_key: str = ""
    model: str = "anthropic/claude-sonnet-4-6"

    # XMTP
    xmtp_env: str = "dev"

    # HTTP server
    port: int = 8080
    gateway_token: str = ""

    # Pool manager integration
    pool_url: str = ""
    instance_id: str = ""

    # Hermes
    hermes_home: str = ""
    workspace_dir: str = ""

    # Agent behavior
    max_iterations: int = 90

    @classmethod
    def from_env(cls) -> RuntimeConfig:
        gateway_token = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
        if not gateway_token:
            gateway_token = secrets.token_hex(32)
            os.environ["OPENCLAW_GATEWAY_TOKEN"] = gateway_token

        model = os.environ.get("OPENCLAW_PRIMARY_MODEL", "")
        if not model:
            model = os.environ.get("HERMES_MODEL", "anthropic/claude-sonnet-4-6")
        # OpenClaw uses "openrouter/" prefix as provider namespace; Hermes
        # calls OpenRouter directly and expects bare model IDs.
        if model.startswith("openrouter/"):
            model = model.removeprefix("openrouter/")

        hermes_home = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
        workspace_dir = os.environ.get("HERMES_WORKSPACE", os.path.join(hermes_home, "workspace"))

        return cls(
            openrouter_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
            model=model,
            xmtp_env=os.environ.get("XMTP_ENV", "dev"),
            port=int(os.environ.get("PORT", "8080")),
            gateway_token=gateway_token,
            pool_url=os.environ.get("POOL_URL", ""),
            instance_id=os.environ.get("INSTANCE_ID", ""),
            hermes_home=hermes_home,
            workspace_dir=workspace_dir,
        )

    def validate(self) -> list[str]:
        errors = []
        if not self.openrouter_api_key:
            errors.append("OPENROUTER_API_KEY is required")
        return errors
