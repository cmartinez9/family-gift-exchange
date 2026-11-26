import {createCipheriv, createDecipheriv, createHmac, randomBytes} from "node:crypto";
import type {Pairs} from "./solver";

type Binding = {
  familyId: string;
  exchangeId: string;
  giverId: string;
  version: number;
} & (
  {field: "assignment"} |
  {field: "question-recipient" | "question-text" | "question-answer"; questionId: string}
);

function authenticatedData(binding: Binding) {
  return Buffer.from(JSON.stringify([
    "fge-v2", binding.field, binding.familyId, binding.exchangeId, binding.giverId, binding.version,
    binding.field === "assignment" ? null : binding.questionId,
  ]));
}

export function encryptionKey() {
  const value = process.env.ASSIGNMENT_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error("ASSIGNMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function sealText(key: Buffer, binding: Binding, text: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(authenticatedData(binding));
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function openText(key: Buffer, binding: Binding, sealed: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12), {authTagLength: 16});
  decipher.setAAD(authenticatedData(binding));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8");
}

export function drawSeal(
  key: Buffer,
  familyId: string,
  exchangeId: string,
  version: number,
  pairs: Pairs,
) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const sorted = [...pairs].sort(([a], [b]) => a.localeCompare(b));
  const digest = createHmac("sha256", key)
    .update(JSON.stringify(["fge-v2-seal", familyId, exchangeId, version, sorted]))
    .digest();
  let bits = digest.readUIntBE(0, 5);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code = alphabet[bits % 32] + code;
    bits = Math.floor(bits / 32);
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
