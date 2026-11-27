import {keyPreviewPng} from "@/server/auth/key-preview-image";
import {linkPreview} from "../link-preview";

/**
 * The picture in the key link's preview (1.1). Chat apps fetch it on their own, so it only reads: it never
 * opens, claims, uses up or rate-limits the key. A key that can't be opened gets the generic picture.
 */
export async function GET(_request: Request, {params}: {params: Promise<{key: string}>}) {
  const preview = await linkPreview((await params).key);
  const png = await keyPreviewPng(preview?.name ?? null);
  return new Response(new Uint8Array(png), {headers: {
    "Content-Type": "image/png",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  }});
}
