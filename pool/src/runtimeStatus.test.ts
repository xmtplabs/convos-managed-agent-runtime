import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeStatus } from "./runtimeStatus";

describe("parseRuntimeStatus", () => {
  it("prefers the new main.conversationId field", () => {
    assert.deepEqual(
      parseRuntimeStatus({
        main: { conversationId: "convo-main" },
        conversation: { id: "convo-legacy" },
        clean: false,
        provision: { state: "active" },
        dirtyReasons: ["active_conversation"],
      }),
      { conversationId: "convo-main", clean: false, provisionState: "active", dirtyReasons: ["active_conversation"] },
    );
  });

  it("falls back to the legacy conversation field", () => {
    assert.deepEqual(
      parseRuntimeStatus({ conversation: { id: "convo-legacy" } }),
      { conversationId: "convo-legacy", clean: null, provisionState: null, dirtyReasons: [] },
    );
  });

  it("treats missing clean as unknown", () => {
    assert.deepEqual(
      parseRuntimeStatus({ ready: true, conversation: null, dirtyReasons: [1, "custom_instructions", null] }),
      { conversationId: null, clean: null, provisionState: null, dirtyReasons: ["custom_instructions"] },
    );
  });
});
