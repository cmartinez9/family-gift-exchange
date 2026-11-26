import "server-only";
import {notFound} from "next/navigation";
import {getWishlist, ListError} from "@/server/lists";
import type {Viewer} from "@/server/auth";

export async function loadWishlist(viewer: Viewer, personId: string, editing = false) {
  try {
    const list = await getWishlist(viewer, personId);
    if (editing && !list.canEdit) notFound();
    return list;
  } catch (error) {
    if (error instanceof ListError && (error.code === "not-found" || error.code === "forbidden")) notFound();
    throw error;
  }
}
