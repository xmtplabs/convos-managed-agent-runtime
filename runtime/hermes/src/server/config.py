"""Configuration loader — maps existing pool env vars to Hermes config."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field


@dataclass
class RuntimeConfig:
    # LLM
    openrouter_api_key: str = ""
    model: str = "@preset/assistants-pro"

    # XMTP
    xmtp_env: str = "dev"

    # HTTP server
    port: int = 8080
    gateway_token: str = ""

    # Pool manager integration
    pool_url: str = ""
    instance_id: str = ""

    # Telemetry
    posthog_api_key: str = ""
    posthog_host: str = "https://us.i.posthog.com"

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

        # Model is read from config.yaml at runtime; this is just the initial default.
        model = os.environ.get("HERMES_MODEL", "@preset/assistants-pro")

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
            posthog_api_key=os.environ.get("POSTHOG_API_KEY", ""),
            posthog_host=os.environ.get("POSTHOG_HOST", "https://us.i.posthog.com"),
            hermes_home=hermes_home,
            workspace_dir=workspace_dir,
        )

    # ── Derived paths (all relative to hermes_home) ────────────────────────
    @property
    def soul_path(self) -> str:
        return os.path.join(self.hermes_home, "SOUL.md")

    @property
    def config_yaml_path(self) -> str:
        return os.path.join(self.hermes_home, "config.yaml")

    @property
    def injected_context_path(self) -> str:
        return os.path.join(self.workspace_dir, "INJECTED_CONTEXT.md")

    @property
    def skills_dir(self) -> str:
        return os.path.join(self.hermes_home, "skills")

    @property
    def sessions_dir(self) -> str:
        return os.path.join(self.hermes_home, "sessions")

    @property
    def credentials_dir(self) -> str:
        return os.path.join(self.hermes_home, "credentials")

    @property
    def cron_dir(self) -> str:
        return os.path.join(self.hermes_home, "cron")

    @property
    def media_dir(self) -> str:
        return os.path.join(self.hermes_home, "media")

    @property
    def state_db_path(self) -> str:
        return os.path.join(self.hermes_home, "state.db")

    @staticmethod
    def workspace_path(hermes_home: str, filename: str) -> str:
        """Resolve a workspace file path. Use this instead of constructing paths inline."""
        return os.path.join(hermes_home, "workspace", filename)

    def validate(self) -> list[str]:
        errors = []
        if not self.openrouter_api_key:
            errors.append("OPENROUTER_API_KEY is required")
        return errors
