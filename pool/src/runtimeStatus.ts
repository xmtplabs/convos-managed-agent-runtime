type RuntimeStatusConversation = {
  id?: string | null;
} | null;

type RuntimeStatusMain = {
  conversationId?: string | null;
} | null;

export type RuntimeStatusResponse = {
  ready?: boolean;
  conversation?: RuntimeStatusConversation;
  main?: RuntimeStatusMain;
  reusable?: boolean;
  dirtyReasons?: unknown;
};

export type ParsedRuntimeStatus = {
  conversationId: string | null;
  reusable: boolean | null;
  dirtyReasons: string[];
};

export function parseRuntimeStatus(status: RuntimeStatusResponse): ParsedRuntimeStatus {
  const conversationId =
    typeof status.main?.conversationId === "string"
      ? status.main.conversationId
      : typeof status.conversation?.id === "string"
        ? status.conversation.id
        : null;

  return {
    conversationId,
    reusable: typeof status.reusable === "boolean" ? status.reusable : null,
    dirtyReasons: Array.isArray(status.dirtyReasons)
      ? status.dirtyReasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}
