"""
Stats accumulator — collects usage counters and posts directly to PostHog.

Usage:
    from .stats import stats
    stats.increment("messages_in")
    stats.set("group_member_count", 4)
    stats.start(posthog_api_key="phc_...", posthog_host="https://us.i.posthog.com",
                instance_id="abc", agent_name="Bankr", runtime="hermes")
    # ... on shutdown:
    await stats.shutdown()
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
FLUSH_INTERVAL_S = 60
FLUSH_TIMEOUT_S = 5


class StatsAccumulator:
    def __init__(self) -> None:
        self._counters: dict[str, int] = {}
        self._gauges: dict[str, float] = {}
        self._last_message_in_at: float = 0.0
        self._posthog_api_key: str = ""
        self._posthog_host: str = ""
        self._instance_id: str = ""
        self._agent_name: str = ""
        self._runtime: str = "hermes"
        self._environment: str = ""
        self._task: asyncio.Task | None = None
        self._started: bool = False

    def increment(self, metric: str, value: int = 1) -> None:
        self._counters[metric] = self._counters.get(metric, 0) + value
        if metric == "messages_in":
            self._last_message_in_at = time.time()

    def set(self, metric: str, value: float) -> None:
        self._gauges[metric] = value

    def _build_posthog_batch(self) -> dict:
        now = time.time()
        seconds_since = (
            int(now - self._last_message_in_at) if self._last_message_in_at > 0 else -1
        )
        ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        return {
            "api_key": self._posthog_api_key,
            "batch": [{
                "event": "instance_stats",
                "distinct_id": f"instance:{self._instance_id}",
                "timestamp": ts,
                "properties": {
                    "schema_version": SCHEMA_VERSION,
                    "instance_id": self._instance_id,
                    "runtime": self._runtime,
                    "messages_in": self._counters.get("messages_in", 0),
                    "messages_out": self._counters.get("messages_out", 0),
                    "tools_invoked": self._counters.get("tools_invoked", 0),
                    "skills_invoked": self._counters.get("skills_invoked", 0),
                    "group_member_count": int(self._gauges.get("group_member_count", 0)),
                    "environment": self._environment,
                    "seconds_since_last_message_in": seconds_since,
                    "$set": {
                        "agent_name": self._agent_name,
                        "runtime": self._runtime,
                    },
                },
            }],
            "sent_at": ts,
        }

    def flush(self) -> dict:
        batch = self._build_posthog_batch()
        self._counters = {}
        return batch

    async def _send(self, batch: dict) -> None:
        if not self._posthog_api_key:
            return
        url = f"{self._posthog_host}/batch/"
        try:
            async with httpx.AsyncClient(timeout=FLUSH_TIMEOUT_S) as client:
                resp = await client.post(url, json=batch)
                if resp.status_code >= 400:
                    logger.warning("Stats flush failed: %d", resp.status_code)
        except Exception as err:
            logger.debug("Stats flush error (will retry next tick): %s", err)

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            batch = self.flush()
            await self._send(batch)

    def start(
        self,
        *,
        posthog_api_key: str,
        posthog_host: str = "https://us.i.posthog.com",
        instance_id: str,
        agent_name: str = "",
        runtime: str = "hermes",
        environment: str = "",
    ) -> None:
        if self._started:
            return
        self._posthog_api_key = posthog_api_key
        self._posthog_host = posthog_host.rstrip("/")
        self._instance_id = instance_id
        self._agent_name = agent_name
        self._runtime = runtime
        self._environment = environment
        self._started = True
        self._task = asyncio.create_task(self._tick_loop())
        logger.info("Stats started (instance=%s, interval=%ds)", instance_id, FLUSH_INTERVAL_S)

    async def shutdown(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        batch = self.flush()
        await self._send(batch)
        self._started = False
        logger.info("Stats shut down (final flush sent)")


# Module-level singleton
stats = StatsAccumulator()
