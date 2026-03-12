import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { provision } from "./provision";

describe("provision", () => {
  it("forwards profileImage to the runtime provision payload", async () => {
    const authFetchMock = mock.fn(async (_url: string, init?: RequestInit & { gatewayToken?: string | null }) => {
      return new Response(
        JSON.stringify({
          conversationId: "conversation-123",
          inviteUrl: "https://runtime.example/invite",
          joined: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const result = await provision(
      {
        agentName: "Profile Agent",
        instructions: "Keep the picture fresh",
        joinUrl: "https://convos.example/join",
        profileImage: "https://images.example/pfp.png",
        source: "test",
      },
      {
        hasActiveInviteUrl: async () => false,
        claimIdle: async () => ({
          id: "instance-123",
          name: "Instance 123",
          url: "https://runtime.example",
          status: "claiming",
          agentName: null,
          conversationId: null,
          inviteUrl: null,
          instructions: null,
          createdAt: new Date(0).toISOString(),
          claimedAt: null,
        }),
        getGatewayToken: async () => "gateway-token",
        completeClaim: async () => {},
        updateStatus: async () => {},
        authFetch: authFetchMock,
      },
    );

    assert.deepEqual(result, {
      inviteUrl: "https://runtime.example/invite",
      conversationId: "conversation-123",
      instanceId: "instance-123",
      joined: false,
      gatewayUrl: "https://runtime.example",
      agentName: "Profile Agent",
    });

    assert.equal(authFetchMock.mock.calls.length, 1);
    const [_url, init] = authFetchMock.mock.calls[0].arguments;
    assert.equal(init?.gatewayToken, "gateway-token");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      agentName: "Profile Agent",
      instructions: "Keep the picture fresh",
      joinUrl: "https://convos.example/join",
      profileImage: "https://images.example/pfp.png",
    });
  });
});
