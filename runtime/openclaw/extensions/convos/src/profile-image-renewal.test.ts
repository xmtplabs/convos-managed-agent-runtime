import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConvosInstance } from "./sdk-client.ts";
import { ProfileImageRenewal } from "./profile-image-renewal.ts";

function withTempStateDir(fn: (stateDir: string) => Promise<void> | void): Promise<void> | void {
  const previous = process.env.OPENCLAW_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "convos-pfp-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
  const finalize = () => {
    if (previous === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previous;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  };

  try {
    const result = fn(stateDir);
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(finalize);
    }
    finalize();
  } catch (err) {
    finalize();
    throw err;
  }
}

test("ProfileImageRenewal persists and reloads profile image sources", () =>
  withTempStateDir((stateDir) => {
    const statePath = path.join(stateDir, "state.json");
    const first = new ProfileImageRenewal({ statePath, now: () => 100 });
    first.recordAppliedImage("https://example.com/original.png");

    const second = new ProfileImageRenewal({ statePath, now: () => 100 });
    assert.equal(second.currentSource(), "https://example.com/original.png");
    assert.equal(second.getSourceToRenew(), null);
  }));

test("ProfileImageRenewal stores conversation state under profile-image", () =>
  withTempStateDir((stateDir) => {
    const tracker = new ProfileImageRenewal({
      conversationId: "conversation-1",
      now: () => 100,
    });

    tracker.recordAppliedImage("https://example.com/profile-image.png");

    const expectedPath = path.join(stateDir, "profile-image", "conversation-1.json");
    const legacyPath = path.join(stateDir, "credentials", "convos-profile-image-conversation-1.json");
    assert.equal(fs.existsSync(expectedPath), true);
    assert.equal(fs.existsSync(legacyPath), false);
  }));

test("ProfileImageRenewal only returns a source once the renew window passes", () =>
  withTempStateDir((stateDir) => {
    const tracker = new ProfileImageRenewal({
      statePath: path.join(stateDir, "state.json"),
      renewAfterMs: 1_000,
      now: () => 400,
    });
    tracker.recordAppliedImage("https://example.com/fresh.png", 0);

    assert.equal(tracker.getSourceToRenew(999), null);
    assert.equal(tracker.getSourceToRenew(1_000), "https://example.com/fresh.png");
  }));

test("ProfileImageRenewal clears persisted state cleanly", () =>
  withTempStateDir((stateDir) => {
    const statePath = path.join(stateDir, "state.json");
    const tracker = new ProfileImageRenewal({ statePath, now: () => 100 });
    tracker.recordAppliedImage("https://example.com/clear-me.png");

    tracker.clear();

    assert.equal(tracker.currentSource(), null);
    assert.equal(fs.existsSync(statePath), false);
  }));

test("ConvosInstance renews a due profile image before outbound text", async () =>
  withTempStateDir(async () => {
    const instance = ConvosInstance.fromExisting("conversation-1", "identity-1", "dev");
    const commands: Array<Record<string, unknown>> = [];

    (instance as ConvosInstance & { assertRunning: () => void }).assertRunning = () => {};
    (instance as ConvosInstance & {
      writeCommand: (cmd: Record<string, unknown>) => void;
    }).writeCommand = (cmd) => {
      commands.push(cmd);
    };
    (instance as ConvosInstance & {
      sendAndWait: (cmd: Record<string, unknown>) => Promise<{ success: boolean; messageId?: string }>;
    }).sendAndWait = async (cmd) => {
      commands.push(cmd);
      return { success: true, messageId: "mid-1" };
    };

    (instance as ConvosInstance & { profileImageRenewal: ProfileImageRenewal }).profileImageRenewal =
      new ProfileImageRenewal({
        conversationId: "conversation-1",
        renewAfterMs: 1_000,
        now: () => 5_000,
      });

    (instance as ConvosInstance & { profileImageRenewal: ProfileImageRenewal }).profileImageRenewal
      .recordAppliedImage("https://example.com/renew-me.png", 0);

    await instance.sendMessage("hello");

    assert.deepEqual(commands[0], {
      type: "update-profile",
      image: "https://example.com/renew-me.png",
    });
    assert.deepEqual(commands[1], {
      type: "send",
      text: "hello",
    });
    assert.equal(
      (instance as ConvosInstance & { profileImageRenewal: ProfileImageRenewal }).profileImageRenewal
        .getSourceToRenew(5_000),
      null,
    );
  }));

test("ConvosInstance records explicit profile image changes without an extra renewal", async () =>
  withTempStateDir(async () => {
    const instance = ConvosInstance.fromExisting("conversation-2", "identity-2", "dev");
    const commands: Array<Record<string, unknown>> = [];

    (instance as ConvosInstance & { assertRunning: () => void }).assertRunning = () => {};
    (instance as ConvosInstance & {
      writeCommand: (cmd: Record<string, unknown>) => void;
    }).writeCommand = (cmd) => {
      commands.push(cmd);
    };

    (instance as ConvosInstance & { profileImageRenewal: ProfileImageRenewal }).profileImageRenewal =
      new ProfileImageRenewal({
        conversationId: "conversation-2",
        renewAfterMs: 1_000,
        now: () => 5_000,
      });

    (instance as ConvosInstance & { profileImageRenewal: ProfileImageRenewal }).profileImageRenewal
      .recordAppliedImage("https://example.com/old.png", 0);

    await instance.sendMessage('/update-profile --image "https://example.com/new.png"');

    assert.equal(commands.length, 1);
    assert.deepEqual(commands[0], {
      type: "update-profile",
      image: "https://example.com/new.png",
    });
    assert.equal(
      (instance as ConvosInstance & { profileImageRenewal: ProfileImageRenewal }).profileImageRenewal
        .currentSource(),
      "https://example.com/new.png",
    );
  }));
