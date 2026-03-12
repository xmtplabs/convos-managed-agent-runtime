from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import RuntimeConfig
from src import server


class ServerProfileImagePlumbingTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        server._adapter = None
        server._config = RuntimeConfig(
            openrouter_api_key="test-key",
            xmtp_env="dev",
        )

    async def asyncTearDown(self) -> None:
        server._adapter = None
        server._config = None

    async def test_pool_provision_create_forwards_profile_image_to_runtime_start(self) -> None:
        body = server.ProvisionRequest(
            agentName="Agent Smith",
            instructions="Stay helpful",
            profileImage="https://example.com/profile-create.png",
        )
        create_instance = SimpleNamespace(identity_id="identity-create")
        ready_info = SimpleNamespace(invite_url="https://example.com/runtime-invite")

        with (
            patch("src.server.write_instructions") as write_instructions,
            patch(
                "src.server.ConvosInstance.create_conversation",
                new=AsyncMock(
                    return_value=(
                        create_instance,
                        {
                            "conversationId": "conversation-create",
                            "inviteUrl": "https://example.com/fallback-invite",
                        },
                    )
                ),
            ),
            patch(
                "src.server.start_wired_instance",
                new=AsyncMock(return_value=ready_info),
            ) as start_wired_instance,
        ):
            result = await server.pool_provision(body)

        write_instructions.assert_called_once_with(server._config.hermes_home, "Stay helpful")
        start_wired_instance.assert_awaited_once_with(
            conversation_id="conversation-create",
            identity_id="identity-create",
            env="dev",
            name="Agent Smith",
            profile_image="https://example.com/profile-create.png",
            debug=True,
        )
        self.assertEqual(
            result,
            {
                "ok": True,
                "conversationId": "conversation-create",
                "inviteUrl": "https://example.com/runtime-invite",
                "joined": False,
            },
        )

    async def test_pool_provision_join_forwards_profile_image_to_runtime_start(self) -> None:
        body = server.ProvisionRequest(
            agentName="Agent Smith",
            joinUrl="https://example.com/join",
            profileImage="https://example.com/profile-join.png",
        )
        join_instance = SimpleNamespace(identity_id="identity-join")

        with (
            patch(
                "src.server.ConvosInstance.join_conversation",
                new=AsyncMock(
                    return_value=(join_instance, "joined", "conversation-join")
                ),
            ),
            patch(
                "src.server.start_wired_instance",
                new=AsyncMock(return_value=None),
            ) as start_wired_instance,
        ):
            result = await server.pool_provision(body)

        start_wired_instance.assert_awaited_once_with(
            conversation_id="conversation-join",
            identity_id="identity-join",
            env="dev",
            profile_image="https://example.com/profile-join.png",
            debug=True,
        )
        self.assertEqual(
            result,
            {
                "ok": True,
                "conversationId": "conversation-join",
                "inviteUrl": "https://example.com/join",
                "joined": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
