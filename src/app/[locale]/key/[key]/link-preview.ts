import "server-only";
import {parseLinkKey} from "@/server/auth/access";
import {keyPreview} from "@/server/auth/key-preview";
import {withFamily} from "@/server/db/client";

/** The key link's preview (1.1), or null for the generic one. Read only: see keyPreview. */
export async function linkPreview(raw: string) {
  const key = parseLinkKey(raw);
  return key ? withFamily(key.familyId, (tx) => keyPreview(tx, key.familyId, key.token, new Date())) : null;
}
