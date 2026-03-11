type RuntimeStatusConversation = {
  id?: string | null;
} | null;

type RuntimeStatusMain = {
  conversationId?: string | null;
} | null;

type RuntimeStatusProvision = {
  state?: string | null;
} | null;

export type RuntimeStatusResponse = {
  ready?: boolean;
  conversation?: RuntimeStatusConversation;
  main?: RuntimeStatusMain;
  clean?: boolean;
  provision?: RuntimeStatusProvision;
  dirtyReasons?: unknown;
};

export type ParsedRuntimeStatus = {
  conversationId: string | null;
  clean: boolean | null;
  provisionState: string | null;
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
    clean: typeof status.clean === "boolean" ? status.clean : null,
    provisionState: typeof status.provision?.state === "string" ? status.provision.state : null,
    dirtyReasons: Array.isArray(status.dirtyReasons)
      ? status.dirtyReasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}
