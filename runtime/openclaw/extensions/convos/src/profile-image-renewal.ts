import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PROFILE_IMAGE_RENEW_AFTER_MS = 29 * 24 * 60 * 60 * 1000;

export type PersistedProfileImageState = {
  sourceUrl: string;
  refreshedAtMs: number;
};

type ProfileImageRenewalOptions = {
  conversationId?: string;
  statePath?: string;
  renewAfterMs?: number;
  now?: () => number;
};

function resolveStatePath(conversationId: string): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "credentials", `convos-profile-image-${conversationId}.json`);
}

function parseState(raw: string): PersistedProfileImageState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedProfileImageState>;
    if (
      typeof parsed.sourceUrl !== "string" ||
      !parsed.sourceUrl.trim() ||
      typeof parsed.refreshedAtMs !== "number" ||
      Number.isNaN(parsed.refreshedAtMs)
    ) {
      return null;
    }
    return {
      sourceUrl: parsed.sourceUrl.trim(),
      refreshedAtMs: parsed.refreshedAtMs,
    };
  } catch {
    return null;
  }
}

export class ProfileImageRenewal {
  private readonly statePath: string | null;
  private readonly renewAfterMs: number;
  private readonly now: () => number;
  private state: PersistedProfileImageState | null;

  constructor(options: ProfileImageRenewalOptions = {}) {
    const conversationId = options.conversationId?.trim();
    this.statePath = options.statePath ?? (conversationId ? resolveStatePath(conversationId) : null);
    this.renewAfterMs = Math.max(0, options.renewAfterMs ?? DEFAULT_PROFILE_IMAGE_RENEW_AFTER_MS);
    this.now = options.now ?? Date.now;
    this.state = this.loadState();
  }

  currentSource(): string | null {
    return this.state?.sourceUrl ?? null;
  }

  recordAppliedImage(sourceUrl: string, refreshedAtMs = this.now()): void {
    const trimmed = sourceUrl.trim();
    if (!trimmed) {
      return;
    }
    this.state = { sourceUrl: trimmed, refreshedAtMs };
    this.persistState();
  }

  getSourceToRenew(nowMs = this.now()): string | null {
    if (!this.state) {
      return null;
    }
    if (nowMs - this.state.refreshedAtMs < this.renewAfterMs) {
      return null;
    }
    return this.state.sourceUrl;
  }

  clear(): void {
    this.state = null;
    if (!this.statePath) {
      return;
    }
    try {
      fs.unlinkSync(this.statePath);
    } catch {
      // Nothing to delete.
    }
  }

  private loadState(): PersistedProfileImageState | null {
    if (!this.statePath) {
      return null;
    }
    try {
      const raw = fs.readFileSync(this.statePath, "utf-8");
      return parseState(raw);
    } catch {
      return null;
    }
  }

  private persistState(): void {
    if (!this.statePath || !this.state) {
      return;
    }
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2) + "\n");
  }
}
