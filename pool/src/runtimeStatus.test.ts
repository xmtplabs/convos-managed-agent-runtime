import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeStatus } from "./runtimeStatus";

describe("parseRuntimeStatus", () => {
  it("reads the flat schema", () => {
    assert.deepEqual(
      parseRuntimeStatus({
        conversation: { id: "convo-1" },
        streaming: false,
        clean: false,
        provisionState: "active",
        dirtyReasons: ["active_conversation"],
      }),
      { conversationId: "convo-1", clean: false, provisionState: "active", dirtyReasons: ["active_conversation"] },
    );
  });

  it("handles null conversation", () => {
    assert.deepEqual(
      parseRuntimeStatus({ conversation: null, clean: true, provisionState: "idle", dirtyReasons: [] }),
      { conversationId: null, clean: true, provisionState: "idle", dirtyReasons: [] },
    );
  });

  it("treats missing fields as unknown/null", () => {
    assert.deepEqual(
      parseRuntimeStatus({ ready: true }),
      { conversationId: null, clean: null, provisionState: null, dirtyReasons: [] },
    );
  });

  it("filters non-string dirty reasons", () => {
    assert.deepEqual(
      parseRuntimeStatus({ dirtyReasons: [1, "custom_instructions", null, "cli_identity"] }),
      { conversationId: null, clean: null, provisionState: null, dirtyReasons: ["custom_instructions", "cli_identity"] },
    );
  });
});
