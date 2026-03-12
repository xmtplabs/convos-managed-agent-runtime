from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import RuntimeConfig
from src.convos_adapter import ConvosAdapter


class ProfileImageRenewalTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.config = RuntimeConfig(
            openrouter_api_key="test-key",
            profile_image_renewal_seconds=3600,
        )
        self.adapter = ConvosAdapter(self.config)
        self.adapter._instance = AsyncMock()

    async def asyncTearDown(self) -> None:
        await self.adapter.stop()

    async def test_profile_image_source_applies_immediately_and_schedules_refresh(self) -> None:
        image = "https://example.com/pfp.png"

        await self.adapter._set_profile_image_source(image, apply_now=True)

        self.assertEqual(self.adapter._profile_image_source, image)
        self.adapter._instance.update_profile.assert_awaited_once_with(name=None, image=image)
        self.assertIsNotNone(self.adapter._profile_image_refresh_task)

    async def test_refresh_loop_reuses_latest_profile_image_source(self) -> None:
        image = "https://example.com/renew.png"
        self.adapter._profile_image_refresh_task = None
        self.adapter._instance.update_profile.reset_mock()

        sleep_calls = 0

        async def fake_sleep(_seconds: float) -> None:
            nonlocal sleep_calls
            sleep_calls += 1
            if sleep_calls > 1:
                raise asyncio.CancelledError

        with patch("src.convos_adapter.asyncio.sleep", new=fake_sleep):
            await self.adapter._set_profile_image_source(image, apply_now=False)
            task = self.adapter._profile_image_refresh_task
            self.assertIsNotNone(task)

            try:
                await task
            except asyncio.CancelledError:
                pass

        self.adapter._instance.update_profile.assert_awaited_once_with(image=image)
        self.assertEqual(self.adapter._profile_image_source, image)

    async def test_profileimage_marker_replaces_source_without_duplicate_refresh_task(self) -> None:
        original = "https://example.com/original.png"
        replacement = "https://example.com/replacement.png"

        await self.adapter._set_profile_image_source(original, apply_now=False)
        refresh_task = self.adapter._profile_image_refresh_task

        self.adapter._instance.update_profile.reset_mock()

        await self.adapter._dispatch_response(f"PROFILEIMAGE:{replacement}")

        self.assertIs(self.adapter._profile_image_refresh_task, refresh_task)
        self.assertEqual(self.adapter._profile_image_source, replacement)
        self.adapter._instance.update_profile.assert_awaited_once_with(
            name=None,
            image=replacement,
        )


if __name__ == "__main__":
    unittest.main()
