import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AGENT_PREFIX, serviceName, isAgentService, parseInstanceId } from "./naming.js";

describe("naming", () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = origEnv;
  });

  describe("AGENT_PREFIX", () => {
    it("equals convos-agent-", () => {
      assert.equal(AGENT_PREFIX, "convos-agent-");
    });
  });

  describe("serviceName", () => {
    it("appends env suffix from RAILWAY_ENVIRONMENT_NAME", () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = "production";
      assert.equal(serviceName("abc123"), "convos-agent-abc123-production");
    });

    it("defaults to staging when env var is unset", () => {
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
      assert.equal(serviceName("abc123"), "convos-agent-abc123-staging");
    });

    it("defaults to staging when env var is empty", () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = "";
      assert.equal(serviceName("abc123"), "convos-agent-abc123-staging");
    });
  });

  describe("isAgentService", () => {
    it("returns true for old-format names", () => {
      assert.equal(isAgentService("convos-agent-abc123"), true);
    });

    it("returns true for new-format names with env suffix", () => {
      assert.equal(isAgentService("convos-agent-abc123-staging"), true);
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
    it("strips prefix and env suffix for new-format names", () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
      assert.equal(parseInstanceId("convos-agent-abc123-staging"), "abc123");
    });

    it("strips only prefix for old-format names (no env suffix)", () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
      assert.equal(parseInstanceId("convos-agent-abc123"), "abc123");
    });

    it("strips correct env suffix for production", () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = "production";
      assert.equal(parseInstanceId("convos-agent-abc123-production"), "abc123");
    });

    it("does not strip mismatched env suffix", () => {
      process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
      assert.equal(parseInstanceId("convos-agent-abc123-production"), "abc123-production");
    });

    it("returns input unchanged if no prefix", () => {
      assert.equal(parseInstanceId("my-web-app"), "my-web-app");
    });
  });
});
