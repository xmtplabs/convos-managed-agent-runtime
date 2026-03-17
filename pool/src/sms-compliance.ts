/**
 * 10DLC compliance constants for Telnyx SMS.
 *
 * Campaign: CZL2FYB (Customer Care, P2P exemption)
 * These values must stay in sync with the Telnyx portal campaign settings.
 */

/** Disclosure shown to the user before SMS provisioning (opt-in point). */
export const SMS_DISCLOSURE =
  "By tapping 'Add assistant,' you agree to receive SMS messages sent by the Convos AI " +
  "assistant on your behalf. Message frequency varies. Standard Message and Data Rates " +
  "may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of " +
  "purchase. Your mobile information will not be sold or shared with third parties for " +
  "promotional or marketing purposes.";

/** STOP/HELP/START keyword detection (case-insensitive, full-message match). */
export const KEYWORDS = {
  optOut: ["STOP", "CANCEL", "END", "QUIT", "UNSUBSCRIBE"],
  optIn: ["START", "YES"],
  help: ["HELP", "INFO"],
} as const;

/** Auto-responses sent when a keyword is received. */
export const AUTO_RESPONSES = {
  optOut:
    "You have been unsubscribed. Reply START to resubscribe.",
  optIn:
    "You are now receiving messages from a Convos AI assistant. Reply HELP for help, STOP to opt out. Msg&data rates may apply.",
  help:
    "For support, email support@xmtplabs.com or reply STOP to opt out. Msg&data rates may apply.",
} as const;

/** Check if a message body is a compliance keyword. Returns the category or null. */
export function matchKeyword(text: string): "optOut" | "optIn" | "help" | null {
  const normalized = text.trim().toUpperCase();
  if (KEYWORDS.optOut.includes(normalized as any)) return "optOut";
  if (KEYWORDS.optIn.includes(normalized as any)) return "optIn";
  if (KEYWORDS.help.includes(normalized as any)) return "help";
  return null;
}
