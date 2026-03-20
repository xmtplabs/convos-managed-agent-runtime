import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import type { ConvosInstance } from "./sdk-client.js";
import { applyOutboundTextPolicy } from "./outbound-policy.js";
import { getConvosRuntime } from "./runtime.js";
import { stats } from "./stats.js";

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

  // Resolve delivery target for cron announce and sub-agent delivery.
  // Single-conversation process: always route to the bound conversation.
  resolveTarget: ({ to }) => {
    const inst = instance;
    if (!inst) {
      return { ok: false, error: new Error(`${TAG} resolveTarget failed — no instance running`) };
    }
    if (to && to !== inst.conversationId) {
      console.warn(`${TAG} resolveTarget: target ${to} differs from bound ${inst.conversationId} — routing to bound conversation`);
    }
    return { ok: true, to: inst.conversationId };
  },

  sendText: async ({ to, text }) => {
    if (!instance) {
      throw new Error(`${TAG} sendText failed — no instance running. Is the gateway started?`);
    }
    // Single-conversation process: any target resolves to the bound conversation.
    // normalizeTarget already maps non-ID strings, but cron announce delivery
    // and sub-agents may bypass it — log a warning instead of throwing.
    if (to && to !== instance.conversationId) {
      console.warn(`${TAG} sendText: target ${to} differs from bound ${instance.conversationId} — routing to bound conversation`);
    }
    console.log(`${TAG} sendText to=${to ?? "(bound)"} conv=${instance.conversationId} len=${text.length}`);

    const policy = await applyOutboundTextPolicy(text);
    if (policy.suppress) {
      console.log(`${TAG} suppressed outbound text to=${to ?? "(bound)"} conv=${instance.conversationId}`);
      return {
        channel: "convos",
        messageId: `convos-suppressed-${Date.now()}`,
      };
    }

    const result = await instance.sendMessage(policy.text);
    stats.increment("messages_out");
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
    if (to && to !== instance.conversationId) {
      console.warn(`${TAG} sendMedia: target ${to} differs from bound ${instance.conversationId} — routing to bound conversation`);
    }
    console.log(`${TAG} sendMedia to=${to ?? "(bound)"} conv=${instance.conversationId} url=${mediaUrl ?? "(none)"}`);
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
