import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import type { ConvosInstance } from "./sdk-client.js";
import { getConvosRuntime } from "./runtime.js";
import { isContextOverflowText, checkCreditsLow, buildCreditErrorMessage } from "./openrouter.js";

const TAG = "[convos/outbound]";

// Single instance — this process has one conversation
let instance: ConvosInstance | null = null;

export function setConvosInstance(inst: ConvosInstance | null): void {
  console.log(`${TAG} instance ${inst ? `bound to conversation ${inst.conversationId}` : "cleared"}`);
  instance = inst;
}

export function getConvosInstance(): ConvosInstance | null {
  return instance;
}

export const convosOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getConvosRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  sendText: async ({ to, text }) => {
    if (!instance) {
      throw new Error(`${TAG} sendText failed — no instance running. Is the gateway started?`);
    }
    console.log(`${TAG} sendText to=${to ?? "(bound)"} conv=${instance.conversationId} len=${text.length}`);
    if (to && to !== instance.conversationId) {
      throw new Error(`${TAG} routing mismatch: bound to ${instance.conversationId}, but target is ${to}`);
    }

    // OpenClaw misclassifies OpenRouter 402 (credit exhaustion) as context
    // overflow.  When we see that rewritten text, verify against the pool
    // server and swap in the correct "out of credits" message.
    let outText = text;
    if (isContextOverflowText(text)) {
      const low = await checkCreditsLow();
      if (low) {
        outText = buildCreditErrorMessage();
        console.log(`${TAG} rewriting context-overflow to credit error (credits low)`);
      }
    }

    const result = await instance.sendMessage(outText);
    const mid = result.messageId ?? `convos-${Date.now()}`;
    console.log(`${TAG} sendText delivered mid=${mid}`);
    return {
      channel: "convos",
      messageId: mid,
    };
  },

  sendMedia: async ({ to, mediaUrl }) => {
    if (!instance) {
      throw new Error(`${TAG} sendMedia failed — no instance running. Is the gateway started?`);
    }
    console.log(`${TAG} sendMedia to=${to ?? "(bound)"} conv=${instance.conversationId} url=${mediaUrl ?? "(none)"}`);
    if (to && to !== instance.conversationId) {
      throw new Error(`${TAG} routing mismatch: bound to ${instance.conversationId}, but target is ${to}`);
    }
    if (!mediaUrl) {
      throw new Error(`${TAG} sendMedia failed — no mediaUrl provided`);
    }
    const result = await instance.sendAttachment(mediaUrl);
    const mid = result.messageId ?? `convos-${Date.now()}`;
    console.log(`${TAG} sendMedia delivered mid=${mid}`);
    return {
      channel: "convos",
      messageId: mid,
    };
  },
};
