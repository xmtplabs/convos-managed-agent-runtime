import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AGENT_PREFIX, serviceName, isAgentService, parseInstanceId } from "./naming.js";

describe("naming", () => {
  describe("AGENT_PREFIX", () => {
    it("equals convos-agent-", () => {
      assert.equal(AGENT_PREFIX, "convos-agent-");
    });
  });

  describe("serviceName", () => {
    it("builds prefix + instanceId", () => {
      assert.equal(serviceName("abc123"), "convos-agent-abc123");
    });
  });

  describe("isAgentService", () => {
    it("returns true for agent services", () => {
      assert.equal(isAgentService("convos-agent-abc123"), true);
    });

    it("returns false for pool-manager", () => {
      assert.equal(isAgentService("convos-agent-pool-manager"), false);
    });

    it("returns false for unrelated names", () => {
      assert.equal(isAgentService("my-web-app"), false);
      assert.equal(isAgentService(""), false);
    });
  });

  describe("parseInstanceId", () => {
    it("strips prefix", () => {
      assert.equal(parseInstanceId("convos-agent-abc123"), "abc123");
    });

    it("returns input unchanged if no prefix", () => {
      assert.equal(parseInstanceId("my-web-app"), "my-web-app");
    });
  });
});
