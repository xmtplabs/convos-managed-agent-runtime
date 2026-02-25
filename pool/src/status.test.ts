import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus } from "./status.js";

describe("deriveStatus", () => {
  const STUCK_MS = 15 * 60 * 1000;
  const young = new Date(Date.now() - 60_000).toISOString();
  const old = new Date(Date.now() - STUCK_MS - 60_000).toISOString();

  it("BUILDING → starting", () => {
    assert.equal(deriveStatus({ deployStatus: "BUILDING", createdAt: young }), "starting");
  });

  it("DEPLOYING → starting", () => {
    assert.equal(deriveStatus({ deployStatus: "DEPLOYING", createdAt: young }), "starting");
  });

  it("QUEUED → starting", () => {
    assert.equal(deriveStatus({ deployStatus: "QUEUED", createdAt: young }), "starting");
  });

  it("WAITING → starting", () => {
    assert.equal(deriveStatus({ deployStatus: "WAITING", createdAt: young }), "starting");
  });

  it("FAILED → dead", () => {
    assert.equal(deriveStatus({ deployStatus: "FAILED", createdAt: young }), "dead");
  });

  it("CRASHED → dead", () => {
    assert.equal(deriveStatus({ deployStatus: "CRASHED", createdAt: young }), "dead");
  });

  it("REMOVED → dead", () => {
    assert.equal(deriveStatus({ deployStatus: "REMOVED", createdAt: young }), "dead");
  });

  it("SKIPPED → dead", () => {
    assert.equal(deriveStatus({ deployStatus: "SKIPPED", createdAt: young }), "dead");
  });

  it("SLEEPING → sleeping", () => {
    assert.equal(deriveStatus({ deployStatus: "SLEEPING", createdAt: young }), "sleeping");
  });

  it("SUCCESS + healthy + no metadata → idle", () => {
    assert.equal(deriveStatus({ deployStatus: "SUCCESS", healthCheck: { ready: true }, isClaimed: false }), "idle");
  });

  it("SUCCESS + healthy + has metadata → claimed", () => {
    assert.equal(deriveStatus({ deployStatus: "SUCCESS", healthCheck: { ready: true }, isClaimed: true }), "claimed");
  });

  it("SUCCESS + unreachable + young → starting", () => {
    assert.equal(deriveStatus({ deployStatus: "SUCCESS", healthCheck: null, createdAt: young }), "starting");
  });

  it("SUCCESS + unreachable + old → dead", () => {
    assert.equal(deriveStatus({ deployStatus: "SUCCESS", healthCheck: null, createdAt: old }), "dead");
  });

  it("null deploy status + young → starting", () => {
    assert.equal(deriveStatus({ deployStatus: null, createdAt: young }), "starting");
  });

  it("BUILDING + isClaimed → claimed", () => {
    assert.equal(deriveStatus({ deployStatus: "BUILDING", createdAt: young, isClaimed: true }), "claimed");
  });

  it("DEPLOYING + isClaimed → claimed", () => {
    assert.equal(deriveStatus({ deployStatus: "DEPLOYING", createdAt: young, isClaimed: true }), "claimed");
  });

  it("FAILED + isClaimed → crashed", () => {
    assert.equal(deriveStatus({ deployStatus: "FAILED", createdAt: young, isClaimed: true }), "crashed");
  });

  it("SUCCESS + unreachable + isClaimed → claimed", () => {
    assert.equal(deriveStatus({ deployStatus: "SUCCESS", healthCheck: null, createdAt: young, isClaimed: true }), "claimed");
  });
});
