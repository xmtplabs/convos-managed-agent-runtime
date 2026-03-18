import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeStatus } from "./runtimeStatus";

describe("parseRuntimeStatus", () => {
  it("active conversation", () => {
    assert.deepEqual(
      parseRuntimeStatus({ conversationId: "convo-1", pending: false, clean: false }),
      { conversationId: "convo-1", pending: false, clean: false },
    );
  });

  it("clean idle", () => {
    assert.deepEqual(
      parseRuntimeStatus({ conversationId: null, pending: false, clean: true }),
      { conversationId: null, pending: false, clean: true },
    );
  });

  it("pending acceptance", () => {
    assert.deepEqual(
      parseRuntimeStatus({ pending: true, clean: false }),
      { conversationId: null, pending: true, clean: false },
    );
  });

  it("missing fields default safely", () => {
    assert.deepEqual(
      parseRuntimeStatus({}),
      { conversationId: null, pending: false, clean: null },
    );
  });
});
