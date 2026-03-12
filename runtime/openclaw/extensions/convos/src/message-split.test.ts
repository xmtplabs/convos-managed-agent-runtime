import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { convosMessageActions } from "./actions.js";
import { deliverConvosReply } from "./channel.js";
import { setConvosInstance } from "./outbound.js";
import { ConvosInstance } from "./sdk-client.js";

afterEach(() => {
  setConvosInstance(null);
});

describe("convosMessageActions send", () => {
  it("allows /update-profile commands to pass through the action gate", async () => {
    const sent: Array<{ text: string; replyTo?: string }> = [];
    setConvosInstance({
      sendMessage: async (text: string, replyTo?: string) => {
        sent.push({ text, replyTo });
        return { success: true, messageId: undefined };
      },
      sendAttachment: async () => ({ success: true, messageId: "attachment-1" }),
      react: async () => ({ success: true, action: "added" as const }),
    } as unknown as ConvosInstance);

    await convosMessageActions.handleAction({
      action: "send",
      params: { message: "/update-profile --name \"Whiteclaw\"" },
    });

    assert.deepEqual(sent, [{ text: "/update-profile --name \"Whiteclaw\"", replyTo: undefined }]);
  });

  it("blocks plain text sends during tool execution", async () => {
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
      /only supports \/update-profile/i,
    );
  });

  it("blocks replyTo on the send action", async () => {
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
          replyTo: "01JTESTMSG",
        },
      }),
      /does not support replyTo/i,
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
});
