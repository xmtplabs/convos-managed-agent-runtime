import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { convosMessageActions } from "./actions.js";
import { convosPlugin, deliverConvosReply, handleInboundMessage } from "./channel.js";
import { setConvosInstance } from "./outbound.js";
import { ConvosInstance } from "./sdk-client.js";

afterEach(() => {
  setConvosInstance(null);
});

describe("convosMessageActions send", () => {
  it("rejects send actions during tool execution", async () => {
    setConvosInstance({
      sendMessage: async () => ({ success: true, messageId: "unexpected" }),
      sendAttachment: async () => ({ success: true, messageId: "attachment-1" }),
      react: async () => ({ success: true, action: "added" as const }),
    } as unknown as ConvosInstance);

    await assert.rejects(
      () => convosMessageActions.handleAction({
        action: "send",
        params: { message: "Now let me find an image" },
      }),
      /action=send is disabled/i,
    );
  });

  it("rejects profile update send actions too", async () => {
    setConvosInstance({
      sendMessage: async () => ({ success: true, messageId: "unexpected" }),
      sendAttachment: async () => ({ success: true, messageId: "attachment-1" }),
      react: async () => ({ success: true, action: "added" as const }),
    } as unknown as ConvosInstance);

    await assert.rejects(
      () => convosMessageActions.handleAction({
        action: "send",
        params: {
          message: "/update-profile --name \"Whiteclaw\"",
        },
      }),
      /action=send is disabled/i,
    );
  });
});

describe("ConvosInstance.sendMessage", () => {
  it("intercepts /update-profile name updates without sending chat text", async () => {
    let updated: { name?: string; image?: string } | undefined;
    let sendAndWaitCalls = 0;

    const result = await ConvosInstance.prototype.sendMessage.call({
      assertRunning() {},
      async updateProfile(name?: string, image?: string) {
        updated = { name, image };
      },
      async sendAndWait() {
        sendAndWaitCalls += 1;
        return { success: true, messageId: "unexpected" };
      },
    }, "/update-profile --name \"Whiteclaw\"");

    assert.deepEqual(updated, { name: "Whiteclaw", image: undefined });
    assert.equal(sendAndWaitCalls, 0);
    assert.deepEqual(result, { success: true, messageId: undefined });
  });

  it("intercepts /update-profile image updates without sending chat text", async () => {
    let updated: { name?: string; image?: string } | undefined;
    let sendAndWaitCalls = 0;

    const result = await ConvosInstance.prototype.sendMessage.call({
      assertRunning() {},
      async updateProfile(name?: string, image?: string) {
        updated = { name, image };
      },
      async sendAndWait() {
        sendAndWaitCalls += 1;
        return { success: true, messageId: "unexpected" };
      },
    }, "/update-profile --name \"Whiteclaw\" --image \"https://example.com/can.png\"");

    assert.deepEqual(updated, {
      name: "Whiteclaw",
      image: "https://example.com/can.png",
    });
    assert.equal(sendAndWaitCalls, 0);
    assert.deepEqual(result, { success: true, messageId: undefined });
  });
});

describe("deliverConvosReply", () => {
  function makeRuntime() {
    return {
      config: {
        loadConfig: () => ({}),
      },
      channel: {
        text: {
          convertMarkdownTables: (text: string) => text,
          resolveTextChunkLimit: () => 4000,
          chunkMarkdownText: (text: string) => [text],
        },
      },
    };
  }

  it("uses replyToCurrent for the final reply path", async () => {
    const sent: Array<{ text: string; replyTo?: string }> = [];
    setConvosInstance({
      sendMessage: async (text: string, replyTo?: string) => {
        sent.push({ text, replyTo });
        return { success: true, messageId: "msg-1" };
      },
    } as unknown as ConvosInstance);

    await deliverConvosReply({
      payload: { text: "On it.", replyToCurrent: true } as never,
      accountId: "default",
      runtime: makeRuntime() as never,
      triggerMessageId: "01JCURRENT",
    });

    assert.deepEqual(sent, [{ text: "On it.", replyTo: "01JCURRENT" }]);
  });

  it("uses explicit replyToId for the final reply path", async () => {
    const sent: Array<{ text: string; replyTo?: string }> = [];
    setConvosInstance({
      sendMessage: async (text: string, replyTo?: string) => {
        sent.push({ text, replyTo });
        return { success: true, messageId: "msg-2" };
      },
    } as unknown as ConvosInstance);

    await deliverConvosReply({
      payload: { text: "Following up.", replyToId: "01JEXPLICIT" } as never,
      accountId: "default",
      runtime: makeRuntime() as never,
    });

    assert.deepEqual(sent, [{ text: "Following up.", replyTo: "01JEXPLICIT" }]);
  });

  it("applies a final-response profile directive without leaking it into chat", async () => {
    const sent: Array<{ text: string; replyTo?: string }> = [];
    let updated: { name?: string; image?: string } | undefined;
    setConvosInstance({
      sendMessage: async (text: string, replyTo?: string) => {
        sent.push({ text, replyTo });
        return { success: true, messageId: "msg-3" };
      },
      updateProfile: async (name?: string, image?: string) => {
        updated = { name, image };
      },
    } as unknown as ConvosInstance);

    await deliverConvosReply({
      payload: {
        text: "[[convos_update_profile name=\"Whiteclaw\" image=\"https://example.com/can.png\"]]\nDone.",
      } as never,
      accountId: "default",
      runtime: makeRuntime() as never,
    });

    assert.deepEqual(updated, {
      name: "Whiteclaw",
      image: "https://example.com/can.png",
    });
    assert.deepEqual(sent, [{ text: "Done.", replyTo: undefined }]);
  });
});

describe("Convos reply filtering", () => {
  it("does not advertise block streaming support", () => {
    assert.equal(convosPlugin.capabilities.blockStreaming, false);
  });

  it("uses the normal reply dispatcher with block streaming disabled", async () => {
    const dispatchCalls: Array<{
      ctx: unknown;
      cfg: unknown;
      dispatcher: unknown;
      replyOptions: Record<string, unknown>;
    }> = [];

    setConvosInstance({
      conversationId: "conv-1",
      label: "chat",
      getGroupMembers: () => [],
      setMemberName() {},
    } as unknown as ConvosInstance);

    const runtime = {
      config: {
        loadConfig: () => ({ session: {} }),
      },
      channel: {
        routing: {
          resolveAgentRoute: () => ({ agentId: "agent", accountId: "default", sessionKey: "session-1" }),
        },
        session: {
          resolveStorePath: () => "/tmp/session-store",
          readSessionUpdatedAt: () => undefined,
          recordInboundSession: async () => {},
        },
        reply: {
          resolveEnvelopeFormatOptions: () => ({}),
          formatAgentEnvelope: ({ body }: { body: string }) => body,
          finalizeInboundContext: (ctx: unknown) => ctx,
          createReplyDispatcherWithTyping: () => ({
            dispatcher: Symbol("dispatcher"),
            replyOptions: { existing: true },
            markDispatchIdle() {},
          }),
          dispatchReplyFromConfig: async (params: {
            ctx: unknown;
            cfg: unknown;
            dispatcher: unknown;
            replyOptions: Record<string, unknown>;
          }) => {
            dispatchCalls.push(params);
          },
        },
        text: {
          resolveMarkdownTableMode: () => "auto",
        },
      },
    };

    await handleInboundMessage(
      {
        accountId: "default",
        debug: false,
        config: {},
      } as never,
      {
        content: "Hello",
        contentType: "text",
        conversationId: "conv-1",
        senderId: "sender-1",
        senderName: "Saul",
        messageId: "01JMSG",
        timestamp: new Date("2026-03-12T05:00:00.000Z"),
      } as never,
      runtime as never,
      {
        info() {},
        error() {},
      },
    );

    assert.equal(dispatchCalls.length, 1);
    assert.equal(dispatchCalls[0]?.replyOptions.disableBlockStreaming, true);
    assert.equal(dispatchCalls[0]?.replyOptions.existing, true);
  });
});
