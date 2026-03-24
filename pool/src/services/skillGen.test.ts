import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSkillResponse } from "./skillGen";

describe("parseSkillResponse", () => {
  it("parses clean JSON response", () => {
    const result = parseSkillResponse(JSON.stringify({
      agentName: "Test Bot",
      description: "A test",
      prompt: "You are a test bot",
      category: "Work",
      emoji: "🤖",
      tools: ["Search"],
    }));
    assert.equal(result.agentName, "Test Bot");
    assert.equal(result.tools.length, 1);
  });

  it("strips markdown fences", () => {
    const result = parseSkillResponse('```json\n{"agentName": "Test Bot"}\n```');
    assert.equal(result.agentName, "Test Bot");
  });

  it("defaults missing optional fields", () => {
    const result = parseSkillResponse('{"agentName": "Minimal"}');
    assert.equal(result.description, "");
    assert.equal(result.prompt, "");
    assert.deepEqual(result.tools, []);
  });

  it("throws on missing agentName", () => {
    assert.throws(() => parseSkillResponse('{"description": "no name"}'), /missing agentName/i);
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseSkillResponse("not json at all"));
  });
});
