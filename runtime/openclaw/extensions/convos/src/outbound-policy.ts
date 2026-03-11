import { buildCreditErrorMessage, checkCreditsLow, isContextOverflowText } from "./openrouter.js";

type OutboundTextPolicyResult = {
  suppress: boolean;
  text: string;
};

const HEARTBEAT_ACK = "HEARTBEAT_OK";

export async function applyOutboundTextPolicy(text: string): Promise<OutboundTextPolicyResult> {
  if (text.trim() === HEARTBEAT_ACK) {
    return { suppress: true, text: "" };
  }

  if (text.includes("limit exceeded") || text.includes("openrouter.ai/settings") || text.includes("afford")) {
    return { suppress: false, text: buildCreditErrorMessage() };
  }

  if (isContextOverflowText(text) && await checkCreditsLow()) {
    return { suppress: false, text: buildCreditErrorMessage() };
  }

  return { suppress: false, text };
}
