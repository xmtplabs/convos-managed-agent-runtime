from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import RuntimeConfig
from src.convos_adapter import ConvosAdapter
from src.profile_image_renewal import ProfileImageRenewalStore
from src.xmtp_bridge import InboundMessage


class ProfileImageRenewalStoreTest(unittest.TestCase):
    def test_store_persists_and_only_renews_after_window(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            first = ProfileImageRenewalStore(
                temp_dir,
                "conversation-1",
                renew_after_seconds=10,
                now=lambda: 5.0,
            )
            first.record_applied_image("https://example.com/pfp.png")

            second = ProfileImageRenewalStore(
                temp_dir,
                "conversation-1",
                renew_after_seconds=10,
                now=lambda: 20.0,
            )

            self.assertEqual(second.current_source(), "https://example.com/pfp.png")
            self.assertEqual(second.due_source(14.0), None)
            self.assertEqual(second.due_source(15.0), "https://example.com/pfp.png")


class ConvosAdapterProfileImageRenewalTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config = RuntimeConfig(
            openrouter_api_key="test-key",
            hermes_home=self.temp_dir.name,
        )
        self.adapter = ConvosAdapter(self.config)
        self.adapter._instance = Mock()
        self.adapter._instance.update_profile = AsyncMock()
        self.adapter._instance.send_message = AsyncMock()
        self.adapter._instance.send_attachment = AsyncMock()
        self.adapter._instance.react = AsyncMock()
        self.adapter._instance.get_group_members = Mock(return_value=None)
        self.adapter._instance.set_member_name = Mock()
        self.adapter._agent = AsyncMock()
        self.adapter._agent.handle_message = AsyncMock(return_value=None)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_inbound_activity_renews_due_profile_image(self) -> None:
        self.adapter._profile_image_renewal = ProfileImageRenewalStore(
            self.temp_dir.name,
            "conversation-1",
            renew_after_seconds=10,
            now=lambda: 20.0,
        )
        self.adapter._profile_image_renewal.record_applied_image(
            "https://example.com/inbound.png",
            applied_at=0.0,
        )

        message = InboundMessage(
            conversation_id="conversation-1",
            message_id="message-1",
            sender_id="sender-1",
            sender_name="Alice",
            content="hello",
            timestamp=0.0,
        )

        await self.adapter._handle_message(message)

        self.adapter._instance.update_profile.assert_awaited_once_with(
            name=None,
            image="https://example.com/inbound.png",
        )
        self.adapter._agent.handle_message.assert_awaited_once()
        self.assertEqual(
            self.adapter._profile_image_renewal.due_source(20.0),
            None,
        )

    async def test_dispatch_response_renews_before_outbound_text(self) -> None:
        self.adapter._profile_image_renewal = ProfileImageRenewalStore(
            self.temp_dir.name,
            "conversation-2",
            renew_after_seconds=10,
            now=lambda: 20.0,
        )
        self.adapter._profile_image_renewal.record_applied_image(
            "https://example.com/outbound.png",
            applied_at=0.0,
        )

        events: list[tuple[str, str | None, str | None]] = []

        async def record_update_profile(*, name: str | None = None, image: str | None = None) -> None:
            events.append(("update_profile", name, image))

        async def record_send_message(text: str, reply_to: str | None = None) -> None:
            events.append(("send_message", text, reply_to))

        self.adapter._instance.update_profile.side_effect = record_update_profile
        self.adapter._instance.send_message.side_effect = record_send_message

        await self.adapter._dispatch_response("Hello there")

        self.assertEqual(
            events[:2],
            [
                ("update_profile", None, "https://example.com/outbound.png"),
                ("send_message", "Hello there", None),
            ],
        )

    async def test_profileimage_marker_replaces_stored_source(self) -> None:
        self.adapter._profile_image_renewal = ProfileImageRenewalStore(
            self.temp_dir.name,
            "conversation-3",
            renew_after_seconds=10,
            now=lambda: 20.0,
        )
        self.adapter._profile_image_renewal.record_applied_image(
            "https://example.com/original.png",
            applied_at=0.0,
        )

        await self.adapter._dispatch_response("PROFILEIMAGE:https://example.com/replacement.png")

        self.adapter._instance.update_profile.assert_awaited_once_with(
            name=None,
            image="https://example.com/replacement.png",
        )
        self.assertEqual(
            self.adapter._profile_image_renewal.current_source(),
            "https://example.com/replacement.png",
        )


if __name__ == "__main__":
    unittest.main()
