import {keyedHash} from "./pin";
import {digest, equalDigests} from "./session";

type PreviewKey = {id: string; personId: string};

export function createCodePreview(pepper: string, familyId: string, key: PreviewKey, code: string, deviceHash: string, now: Date) {
  const body = [key.id, key.personId, digest(code), deviceHash, now.getTime() + 5 * 60_000].join(".");
  return `${body}.${keyedHash(pepper, "code-preview", `${familyId}.${body}`)}`;
}

export function validCodePreview(
  preview: string, pepper: string, familyId: string, key: PreviewKey, code: string, deviceHash: string, now: Date,
) {
  const [keyId, personId, codeHash, hash, expiry, signature, extra] = preview.split(".");
  if (extra !== undefined || keyId !== key.id || personId !== key.personId || codeHash !== digest(code)
    || hash !== deviceHash || !/^\d+$/.test(expiry ?? "") || Number(expiry) <= now.getTime()
    || !/^[0-9a-f]{64}$/.test(signature ?? "")) return false;
  const body = [keyId, personId, codeHash, hash, expiry].join(".");
  return equalDigests(signature, keyedHash(pepper, "code-preview", `${familyId}.${body}`));
}
