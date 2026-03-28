import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk";
import { listConvosAccountIds, type CoreConfig } from "./accounts.js";
import { applyOutboundTextPolicy } from "./outbound-policy.js";
import { getConvosInstance } from "./outbound.js";

// --- Local replacements for helpers dropped from openclaw/plugin-sdk/core ---

function toSnakeCaseKey(key: string): string {
  return key.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function readParamRaw(params: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(params, key)) return params[key];
  const snakeKey = toSnakeCaseKey(key);
  if (snakeKey !== key && Object.hasOwn(params, snakeKey)) return params[snakeKey];
}

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; trim?: boolean; label?: string; allowEmpty?: boolean } = {},
): string | undefined {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;
  const raw = readParamRaw(params, key);
  if (typeof raw !== "string") {
    if (required) throw new Error(`${label} required`);
    return;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) throw new Error(`${label} required`);
    return;
  }
  return value;
}

function readReactionParams(
  params: Record<string, unknown>,
  options: { emojiKey?: string; removeKey?: string; removeErrorMessage: string },
): { emoji: string | undefined; remove: boolean; isEmpty: boolean } {
  const emojiKey = options.emojiKey ?? "emoji";
  const removeKey = options.removeKey ?? "remove";
  const remove = typeof params[removeKey] === "boolean" ? (params[removeKey] as boolean) : false;
  const emoji = readStringParam(params, emojiKey, { required: true, allowEmpty: true });
  if (remove && !emoji) throw new Error(options.removeErrorMessage);
  return { emoji, remove, isEmpty: !emoji };
}

function jsonResult(payload: unknown): { content: { type: "text"; text: string }[]; details: unknown } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], details: payload };
}

export const convosMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: ({ cfg }) => {
    const ids = listConvosAccountIds(cfg as CoreConfig);
    if (ids.length === 0) return null;
    return {
      actions: ["send", "react", "sendAttachment"],
    };
  },

  handleAction: async ({ action, params }) => {
    const inst = getConvosInstance();
    if (!inst) {
      throw new Error("Convos instance not running");
    }

    if (action === "send") {
      const message = readStringParam(params, "message", { required: true, allowEmpty: true });
      const replyTo = readStringParam(params, "replyTo");
      const policy = await applyOutboundTextPolicy(message);
      if (policy.suppress) {
        return jsonResult({ ok: true, suppressed: true, messageId: `convos-suppressed-${Date.now()}` });
      }
      const result = await inst.sendMessage(policy.text, replyTo);
      return jsonResult({ ok: true, messageId: result.messageId ?? `convos-${Date.now()}` });
    }

    if (action === "sendAttachment") {
      const file = readStringParam(params, "file", { required: true });
      const result = await inst.sendAttachment(file);
      return jsonResult({ ok: true, messageId: result.messageId ?? `convos-${Date.now()}` });
    }

    if (action === "react") {
      const messageId = readStringParam(params, "messageId", { required: true });
      const { emoji, remove } = readReactionParams(params, {
        removeErrorMessage: "Emoji is required to remove a Convos reaction.",
      });
      const result = await inst.react(messageId, emoji, remove ? "remove" : "add");
      return jsonResult({ ok: true, action: result.action, emoji });
    }

    throw new Error(`Action "${action}" is not supported for Convos.`);
  },
};
