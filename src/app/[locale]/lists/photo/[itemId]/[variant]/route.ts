import {requireViewer} from "@/server/auth";
import {getListPhoto, ListError} from "@/server/lists";
import {PHOTO_CONTENT_TYPE} from "@/server/lists/photo-storage";

export async function GET(_request: Request, {params}: {params: Promise<{itemId: string; variant: string}>}) {
  const viewer = await requireViewer();
  const {itemId, variant} = await params;
  if (variant !== "photo" && variant !== "icon") return new Response(null, {status: 404});
  try {
    const photo = await getListPhoto(viewer, itemId, variant);
    if (!photo) return new Response(null, {status: 404});
    return new Response(photo, {headers: {
      "Content-Type": PHOTO_CONTENT_TYPE,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    }});
  } catch (error) {
    if (error instanceof ListError) {
      return new Response(null, {status: error.code === "storage-unavailable" ? 503 : 404});
    }
    throw error;
  }
}
