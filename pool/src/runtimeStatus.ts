export type RuntimeStatusResponse = {
  ready?: boolean;
  conversation?: { id?: string | null } | null;
  streaming?: boolean;
  clean?: boolean;
  provisionState?: string | null;
  dirtyReasons?: unknown;
};

export type ParsedRuntimeStatus = {
  conversationId: string | null;
  clean: boolean | null;
  provisionState: string | null;
  dirtyReasons: string[];
};

export function parseRuntimeStatus(status: RuntimeStatusResponse): ParsedRuntimeStatus {
  return {
    conversationId: typeof status.conversation?.id === "string" ? status.conversation.id : null,
    clean: typeof status.clean === "boolean" ? status.clean : null,
    provisionState: typeof status.provisionState === "string" ? status.provisionState : null,
    dirtyReasons: Array.isArray(status.dirtyReasons)
      ? status.dirtyReasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}
