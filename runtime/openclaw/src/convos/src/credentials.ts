import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CREDENTIALS_FILE = "convos-identity.json";

export type ConvosCredentials = {
  identityId: string;
  ownerConversationId: string;
};

function credentialsPath(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "credentials", CREDENTIALS_FILE);
}

export function loadConvosCredentials(): ConvosCredentials | null {
  const p = credentialsPath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    if (data.identityId && data.ownerConversationId) {
      return { identityId: data.identityId, ownerConversationId: data.ownerConversationId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveConvosCredentials(creds: ConvosCredentials): void {
  const p = credentialsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(creds, null, 2) + "\n");
}

export function clearConvosCredentials(): void {
  try {
    fs.unlinkSync(credentialsPath());
  } catch {
    // File doesn't exist, nothing to clear
  }
}
