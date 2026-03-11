import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeStatus } from "./runtimeStatus";

describe("parseRuntimeStatus", () => {
  it("prefers the new main.conversationId field", () => {
    assert.deepEqual(
      parseRuntimeStatus({
        main: { conversationId: "convo-main" },
        conversation: { id: "convo-legacy" },
        reusable: false,
        dirtyReasons: ["active_conversation"],
      }),
      {
        conversationId: "convo-main",
        reusable: false,
        dirtyReasons: ["active_conversation"],
      },
    );
  });

  it("falls back to the legacy conversation field", () => {
    assert.deepEqual(
      parseRuntimeStatus({
        conversation: { id: "convo-legacy" },
      }),
      {
        conversationId: "convo-legacy",
        reusable: null,
        dirtyReasons: [],
      },
    );
  });

  it("treats missing reusable as unknown", () => {
    assert.deepEqual(
      parseRuntimeStatus({
        ready: true,
        conversation: null,
        dirtyReasons: [1, "custom_instructions", null],
      }),
      {
        conversationId: null,
        reusable: null,
        dirtyReasons: ["custom_instructions"],
      },
    );
  });
});
