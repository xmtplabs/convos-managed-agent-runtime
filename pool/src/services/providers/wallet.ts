import { randomBytes } from "crypto";

/** Generate a random gateway token (64 hex chars). */
export function generateGatewayToken(): string {
  return randomBytes(32).toString("hex");
}

