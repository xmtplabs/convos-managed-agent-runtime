import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import type { ConvosInstance } from "./sdk-client.js";
import { getConvosRuntime } from "./runtime.js";

// Single instance — this process has one conversation
let instance: ConvosInstance | null = null;

// Track recently sent message IDs to filter self-echoes from the stream.
// Capped at 100 entries to avoid unbounded growth.
const recentSentIds = new Set<string>();
const SENT_ID_MAX = 100;

export function addSentMessageId(id: string): void {
  if (!id) return;
  recentSentIds.add(id);
  if (recentSentIds.size > SENT_ID_MAX) {
    const first = recentSentIds.values().next().value;
    if (first !== undefined) recentSentIds.delete(first);
  }
}

export function isSentMessage(id: string): boolean {
  return recentSentIds.has(id);
}

export function setConvosInstance(inst: ConvosInstance | null): void {
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
      throw new Error("Convos instance not running. Is the gateway started?");
    }
    // In 1:1, `to` should match the instance's conversation.
    // Assert to catch misrouting bugs.
    if (to && to !== instance.conversationId) {
      throw new Error(`Convos routing mismatch: expected ${instance.conversationId}, got ${to}`);
    }
    const result = await instance.sendMessage(text);
    const mid = result.messageId ?? `convos-${Date.now()}`;
    addSentMessageId(mid);
    return {
      channel: "convos",
      messageId: mid,
    };
  },

  sendMedia: async () => {
    throw new Error("Media sending not yet implemented in Convos");
  },
};
