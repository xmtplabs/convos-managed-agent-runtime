from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable

DEFAULT_PROFILE_IMAGE_RENEW_AFTER_SECONDS = 29 * 24 * 60 * 60


class ProfileImageRenewalStore:
    def __init__(
        self,
        state_dir: str,
        conversation_id: str | None,
        *,
        renew_after_seconds: int = DEFAULT_PROFILE_IMAGE_RENEW_AFTER_SECONDS,
        now: Callable[[], float] | None = None,
    ) -> None:
        conversation = (conversation_id or "").strip()
        self._state_path = (
            Path(state_dir) / "profile-image" / f"{conversation}.json"
            if conversation
            else None
        )
        self._renew_after_seconds = max(0, renew_after_seconds)
        self._now = now or time.time
        self._state = self._load()

    def current_source(self) -> str | None:
        if not self._state:
            return None
        return self._state["sourceUrl"]

    def record_applied_image(self, source_url: str, applied_at: float | None = None) -> None:
        source = source_url.strip()
        if not source:
            return

        self._state = {
            "sourceUrl": source,
            "refreshedAt": applied_at if applied_at is not None else self._now(),
        }
        self._persist()

    def due_source(self, now_value: float | None = None) -> str | None:
        if not self._state:
            return None

        current = now_value if now_value is not None else self._now()
        if current - self._state["refreshedAt"] < self._renew_after_seconds:
            return None
        return self._state["sourceUrl"]

    def clear(self) -> None:
        self._state = None
        if not self._state_path:
            return
        try:
            self._state_path.unlink()
        except FileNotFoundError:
            pass

    def _load(self) -> dict[str, float | str] | None:
        if not self._state_path:
            return None

        try:
            data = json.loads(self._state_path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None

        source = data.get("sourceUrl")
        refreshed_at = data.get("refreshedAt")
        if not isinstance(source, str) or not source.strip():
            return None
        if not isinstance(refreshed_at, int | float):
            return None

        return {
            "sourceUrl": source.strip(),
            "refreshedAt": float(refreshed_at),
        }

    def _persist(self) -> None:
        if not self._state_path or not self._state:
            return
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(json.dumps(self._state, indent=2) + "\n")
