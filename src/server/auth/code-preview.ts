import {keyedHash} from "./pin";
import {digest, equalDigests} from "./session";

type PreviewKey = {id: string; personId: string};

export function createCodePreview(pepper: string, familyId: string, key: PreviewKey, code: string, deviceHash: string) {
  const body = [key.id, key.personId, digest(code), deviceHash].join(".");
  return `${body}.${keyedHash(pepper, "code-preview", `${familyId}.${body}`)}`;
}

export function validCodePreview(
  preview: string, pepper: string, familyId: string, key: PreviewKey, code: string, deviceHash: string,
) {
  const [keyId, personId, codeHash, hash, signature, extra] = preview.split(".");
  if (extra !== undefined || keyId !== key.id || personId !== key.personId || codeHash !== digest(code)
    || hash !== deviceHash
    || !/^[0-9a-f]{64}$/.test(signature ?? "")) return false;
  const body = [keyId, personId, codeHash, hash].join(".");
  return equalDigests(signature, keyedHash(pepper, "code-preview", `${familyId}.${body}`));
}
