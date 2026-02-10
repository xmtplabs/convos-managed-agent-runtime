import * as fs from "node:fs";
import * as path from "node:path";

const BANKR_CONFIG_DIR =
  process.env.BANKR_CONFIG_DIR ?? path.join(process.env.HOME ?? "", ".clawdbot", "skills", "bankr");
const BANKR_CONFIG_PATH = path.join(BANKR_CONFIG_DIR, "config.json");

export type BankrConfig = {
  apiKey: string;
  apiUrl: string;
  privateKey: string;
  address?: string;
};

export function getBankrConfig(): BankrConfig | null {
  let apiKey: string | undefined;
  let apiUrl = "https://api.bankr.bot";
  let privateKey: string | undefined;
  let address: string | undefined;

  if (fs.existsSync(BANKR_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(BANKR_CONFIG_PATH, "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.apiKey === "string") apiKey = data.apiKey;
      if (typeof data.apiUrl === "string") apiUrl = data.apiUrl;
      if (typeof data.privateKey === "string") privateKey = data.privateKey;
      if (typeof data.address === "string" && data.address.length > 0) address = data.address;
    } catch {
      // ignore parse errors
    }
  }

  if (!apiKey && process.env.BANKR_API_KEY) apiKey = process.env.BANKR_API_KEY;
  if (!privateKey && process.env.BANKR_WALLET_PRIVATE_KEY) privateKey = process.env.BANKR_WALLET_PRIVATE_KEY;
  if (!apiKey || !privateKey) return null;

  const pk = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return { apiKey, apiUrl, privateKey: pk, ...(address ? { address } : {}) };
}
