/**
 * Persist/load Convos XMTP identity under state dir (no keys in config).
 */

import fs from "node:fs";
import path from "node:path";

const IDENTITY_FILENAME = "identity.json";

export function getIdentityFilePath(stateDir: string, accountId: string): string {
  return path.join(stateDir, "convos", accountId, IDENTITY_FILENAME);
}

export type IdentityPayload = {
  privateKey: string;
  inboxId?: string;
};

export function loadIdentity(
  stateDir: string,
  accountId: string,
): IdentityPayload | null {
  const filePath = getIdentityFilePath(stateDir, accountId);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object" || typeof (data as IdentityPayload).privateKey !== "string") {
      return null;
    }
    const payload = data as IdentityPayload;
    return { privateKey: payload.privateKey, inboxId: payload.inboxId };
  } catch {
    return null;
  }
}

export function saveIdentity(
  stateDir: string,
  accountId: string,
  payload: IdentityPayload,
): void {
  const dir = path.join(stateDir, "convos", accountId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, IDENTITY_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 0), "utf8");
}
