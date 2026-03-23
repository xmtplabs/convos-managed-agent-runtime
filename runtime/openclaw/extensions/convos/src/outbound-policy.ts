import { buildCreditErrorMessage, checkCreditsLow, isContextOverflowText } from "./openrouter.js";

type OutboundTextPolicyResult = {
  suppress: boolean;
  text: string;
};

const HEARTBEAT_ACK = "HEARTBEAT_OK";
const SILENT_TOKEN = "SILENT";

const OVERLOADED_PATTERNS = [
  "temporarily overloaded",
  "overloaded_error",
  "service unavailable",
  "high demand",
];

function isOverloadedText(text: string): boolean {
  const lower = text.toLowerCase();
  return OVERLOADED_PATTERNS.some((p) => lower.includes(p));
}

export async function applyOutboundTextPolicy(text: string): Promise<OutboundTextPolicyResult> {
  const trimmed = text.trim();

  if (trimmed === HEARTBEAT_ACK) {
    return { suppress: true, text: "" };
  }

  // Agent explicitly chose not to reply
  if (trimmed === SILENT_TOKEN) {
    return { suppress: true, text: "" };
  }

  if (text.includes("limit exceeded") || text.includes("openrouter.ai/settings") || text.includes("afford")) {
    return { suppress: false, text: buildCreditErrorMessage() };
  }

  if (isContextOverflowText(text) && await checkCreditsLow()) {
    return { suppress: false, text: buildCreditErrorMessage() };
  }

  // Rewrite raw provider overloaded errors into a user-friendly message
  if (isOverloadedText(text)) {
    return {
      suppress: false,
      text: "I'm having trouble with my AI provider right now — please try again in a moment.",
    };
  }

  return { suppress: false, text };
}
