// pool/src/attestation.ts
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { config } from "./config";

export interface AttestationResult {
  attestation: string;      // base64url-encoded 64-byte Ed25519 signature
  attestation_ts: string;   // ISO 8601 UTC timestamp
  attestation_kid: string;  // key ID from config
}

/**
 * Sign an attestation for an agent's inbox ID.
 * message = sha256(inboxId || timestamp)
 * signature = Ed25519.sign(message, privateKey)
 */
export function signAttestation(inboxId: string): AttestationResult {
  const pem = config.attestationPrivateKeyPem;
  if (!pem) throw new Error("ATTESTATION_PRIVATE_KEY_PEM not configured");

  const kid = config.attestationKid;
  const timestamp = new Date().toISOString();
  const message = createHash("sha256").update(`${inboxId}${timestamp}`).digest();
  const privateKey = createPrivateKey(pem);
  const signature = sign(null, message, privateKey);

  return {
    attestation: signature.toString("base64url"),
    attestation_ts: timestamp,
    attestation_kid: kid,
  };
}

/**
 * Build JWKS JSON for hosting at .well-known/agents.json.
 * Derives the public key from the configured private key.
 */
export function buildJwksFromConfig(): { keys: Array<Record<string, string>> } {
  const pem = config.attestationPrivateKeyPem;
  if (!pem) throw new Error("ATTESTATION_PRIVATE_KEY_PEM not configured");

  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  // Ed25519 DER public key is 44 bytes: 12-byte header + 32-byte key
  const x = publicKeyDer.subarray(12).toString("base64url");

  return {
    keys: [{
      kid: config.attestationKid,
      kty: "OKP",
      crv: "Ed25519",
      x,
      use: "sig",
      issuer: "convos",
    }],
  };
}
