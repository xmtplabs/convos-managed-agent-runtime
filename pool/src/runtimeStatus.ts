export type RuntimeStatusResponse = {
  conversationId?: string | null;
  pending?: boolean;
  clean?: boolean;
};

export type ParsedRuntimeStatus = {
  conversationId: string | null;
  pending: boolean;
  clean: boolean | null;
};

export function parseRuntimeStatus(status: RuntimeStatusResponse): ParsedRuntimeStatus {
  return {
    conversationId: typeof status.conversationId === "string" ? status.conversationId : null,
    pending: status.pending === true,
    clean: typeof status.clean === "boolean" ? status.clean : null,
  };
}
