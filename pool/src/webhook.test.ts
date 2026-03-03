import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideAction } from "./webhookLogic";

describe("webhook state machine", () => {

  // ── Claiming guard ──────────────────────────────────────────────────────

  it("ignores events for instances in 'claiming' status", () => {
    assert.deepEqual(decideAction("Deployment.deployed", "claiming", false), { action: "noop" });
    assert.deepEqual(decideAction("Deployment.crashed", "claiming", true), { action: "noop" });
    assert.deepEqual(decideAction("Deployment.slept", "claiming", false), { action: "noop" });
  });

  // ── Deployment.deployed ─────────────────────────────────────────────────

  it("deployed + starting → schedules health check", () => {
    const d = decideAction("Deployment.deployed", "starting", false);
    assert.equal(d.action, "health_check");
  });

  it("deployed + idle → no-op", () => {
    const d = decideAction("Deployment.deployed", "idle", false);
    assert.equal(d.action, "noop");
  });

  it("deployed + claimed → no-op", () => {
    const d = decideAction("Deployment.deployed", "claimed", true);
    assert.equal(d.action, "noop");
  });

  it("deployed + crashed (unclaimed) → no-op", () => {
    const d = decideAction("Deployment.deployed", "crashed", false);
    assert.equal(d.action, "noop");
  });

  it("deployed + crashed (claimed) → schedules health check", () => {
    const d = decideAction("Deployment.deployed", "crashed", true);
    assert.equal(d.action, "health_check");
  });

  it("deployed + sleeping → schedules health check", () => {
    const d = decideAction("Deployment.deployed", "sleeping", false);
    assert.equal(d.action, "health_check");
  });

  // ── Destructive events ──────────────────────────────────────────────────

  it("crashed + unclaimed → dead", () => {
    const d = decideAction("Deployment.crashed", "starting", false);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "dead");
  });

  it("crashed + claimed → crashed", () => {
    const d = decideAction("Deployment.crashed", "claimed", true);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "crashed");
  });

  it("failed + starting → dead", () => {
    const d = decideAction("Deployment.failed", "starting", false);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "dead");
  });

  it("failed + claimed → crashed", () => {
    const d = decideAction("Deployment.failed", "claimed", true);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "crashed");
  });

  it("oom_killed + unclaimed → dead", () => {
    const d = decideAction("Deployment.oom_killed", "starting", false);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "dead");
  });

  it("oom_killed + claimed → crashed", () => {
    const d = decideAction("Deployment.oom_killed", "claimed", true);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "crashed");
  });

  // ── Out-of-order guard ─────────────────────────────────────────────────

  it("crashed + idle → dead (instance genuinely crashed)", () => {
    const d = decideAction("Deployment.crashed", "idle", false);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "dead");
  });

  it("crashed + already dead → no-op", () => {
    const d = decideAction("Deployment.crashed", "dead", false);
    assert.equal(d.action, "noop");
  });

  it("crashed + already crashed → no-op", () => {
    const d = decideAction("Deployment.crashed", "crashed", true);
    assert.equal(d.action, "noop");
  });

  it("crashed + sleeping → dead (real crash)", () => {
    const d = decideAction("Deployment.crashed", "sleeping", false);
    assert.equal(d.action, "set_status");
    assert.equal(d.newStatus, "dead");
  });

  // ── Sleep / resume ──────────────────────────────────────────────────────

  it("slept → sleeping (regardless of prior status)", () => {
    const d1 = decideAction("Deployment.slept", "idle", false);
    assert.equal(d1.action, "set_status");
    assert.equal(d1.newStatus, "sleeping");

    const d2 = decideAction("Deployment.slept", "claimed", true);
    assert.equal(d2.action, "set_status");
    assert.equal(d2.newStatus, "sleeping");
  });

  it("resumed + sleeping → schedules health check", () => {
    const d = decideAction("Deployment.resumed", "sleeping", false);
    assert.equal(d.action, "health_check");
  });

  it("resumed + non-sleeping → no-op", () => {
    const d = decideAction("Deployment.resumed", "idle", false);
    assert.equal(d.action, "noop");
  });

  // ── Unknown events ──────────────────────────────────────────────────────

  it("unknown event type → no-op", () => {
    const d = decideAction("Deployment.some_future_event", "idle", false);
    assert.equal(d.action, "noop");
  });
});
