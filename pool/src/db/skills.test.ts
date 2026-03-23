import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./skills";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    assert.equal(slugify("The Tab Keeper"), "the-tab-keeper");
  });

  it("strips non-alphanumeric characters", () => {
    assert.equal(slugify("Hello World! #1"), "hello-world-1");
  });

  it("trims leading/trailing hyphens", () => {
    assert.equal(slugify("--test--"), "test");
  });

  it("handles emoji in names", () => {
    assert.equal(slugify("🎾 Tennis Bot"), "tennis-bot");
  });
});
