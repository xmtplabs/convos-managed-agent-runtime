import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk";
import { jsonResult, readStringParam, readReactionParams } from "openclaw/plugin-sdk/core";
import { listConvosAccountIds, type CoreConfig } from "./accounts.js";
import { applyOutboundTextPolicy } from "./outbound-policy.js";
import { getConvosInstance } from "./outbound.js";

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
