import { randomBytes } from "crypto";

/** Generate a random gateway token (64 hex chars). */
export function generateGatewayToken(): string {
  return randomBytes(32).toString("hex");
}

/** Generate a random setup password (32 hex chars). */
export function generateSetupPassword(): string {
  return randomBytes(16).toString("hex");
}

/** Generate a random Ethereum wallet private key (0x + 64 hex chars). */
export function generatePrivateWalletKey(): string {
  return "0x" + randomBytes(32).toString("hex");
}
