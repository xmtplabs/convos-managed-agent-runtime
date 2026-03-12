import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk";
import { jsonResult, readStringParam, readReactionParams } from "openclaw/plugin-sdk";
import { listConvosAccountIds, type CoreConfig } from "./accounts.js";
import { getConvosInstance } from "./outbound.js";

const TAG = "[convos/actions]";

function previewText(text: string, maxLen = 80): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, maxLen - 1)}...`;
}

export const convosMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const ids = listConvosAccountIds(cfg as CoreConfig);
    if (ids.length === 0) {
      return [];
    }
    return ["react", "sendAttachment"];
  },

  supportsButtons: () => false,

  handleAction: async ({ action, params }) => {
    const inst = getConvosInstance();
    if (!inst) {
      throw new Error("Convos instance not running");
    }

    if (action === "send") {
      const message = readStringParam(params, "message", { required: true, allowEmpty: true });
      console.warn(
        `${TAG} blocked action=send reason=disabled len=${message.length} preview="${previewText(message)}"`,
      );
      throw new Error(
        "Convos action=send is disabled. Use your final response for chat text and [[convos_update_profile ...]] for profile changes.",
      );
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
