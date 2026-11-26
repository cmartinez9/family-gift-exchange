import "server-only";
import {createHmac, timingSafeEqual} from "node:crypto";
import type {Viewer} from "../../auth";
import type {LinkPreview} from ".";

const draftLifetime = 15 * 60 * 1000;
const maxTokenLength = 560_000;
type SignedPreview = Omit<LinkPreview, "image" | "favicon"> & {image?: string; favicon?: string};

function signature(payload: string) {
  const secret = process.env.AUTH_SECRET;
  return secret && createHmac("sha256", secret).update("wishlist-link-preview\0").update(payload).digest();
}

export function signLinkDraft(viewer: Viewer, input: string, preview: LinkPreview) {
  const payload = Buffer.from(JSON.stringify({
    familyId: viewer.familyId, sessionId: viewer.sessionId, ownerId: viewer.actingAs,
    input: input.trim(), expires: Date.now() + draftLifetime,
    preview: {...preview, image: preview.image?.toString("base64"), favicon: preview.favicon?.toString("base64")},
  })).toString("base64url");
  const mac = signature(payload);
  if (!mac) return;
  return `${payload}.${mac.toString("base64url")}`;
}

export function readLinkDraft(viewer: Viewer, input: string, ticket: string | undefined): LinkPreview | undefined {
  if (!ticket || ticket.length > maxTokenLength) return;
  const [payload, encodedMac, extra] = ticket.split(".");
  if (!payload || !encodedMac || extra !== undefined) return;
  const expected = signature(payload);
  const mac = Buffer.from(encodedMac, "base64url");
  if (!expected || mac.length !== expected.length || !timingSafeEqual(mac, expected)) return;
  const draft = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    familyId: string; sessionId: string; ownerId: string; input: string; expires: number; preview: SignedPreview;
  };
  if (draft.familyId !== viewer.familyId || draft.sessionId !== viewer.sessionId ||
    draft.ownerId !== viewer.actingAs || draft.input !== input.trim() || draft.expires <= Date.now()) return;
  const {preview} = draft;
  return {
    ...preview,
    image: preview.image ? Buffer.from(preview.image, "base64") : undefined,
    favicon: preview.favicon ? Buffer.from(preview.favicon, "base64") : undefined,
  };
}
