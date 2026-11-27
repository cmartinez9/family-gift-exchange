"use server";

import {revalidatePath} from "next/cache";
import {after} from "next/server";
import {getLocale} from "next-intl/server";
import {requireViewer} from "@/server/auth";
import {addListItem, ListError} from "@/server/lists";
import {LinkError} from "@/server/lists/link-preview";
import {readLinkDraft} from "@/server/lists/link-preview/draft";
import {MAX_PHOTO_INPUT} from "@/server/lists/photo-storage";

export type FirstThingState = {added?: boolean; pictureComing?: boolean; error?: string};

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Keep the first item (2.7 to 2.9) in onboarding instead of opening the list, so All set comes next. */
export async function addFirstThing(ownerId: string, _: FirstThingState, form: FormData): Promise<FirstThingState> {
  const viewer = await requireViewer({borrowed: "help"});
  const kind = text(form, "kind");
  let pictureComing = false;
  try {
    if (kind === "note") {
      await addListItem(viewer, ownerId, {kind: "note", title: text(form, "title")});
    } else if (kind === "link") {
      const link = text(form, "link");
      if (!link) throw new ListError("invalid-item");
      const draft = readLinkDraft(viewer, link, text(form, "draft"));
      const item = await addListItem(viewer, ownerId, {
        kind: "link", link, note: text(form, "note"), starred: form.get("starred") === "on",
      }, draft ? {resolve: async () => draft} : {later: after});
      pictureComing = item.pictureComing;
    } else if (kind === "photo") {
      const file = form.get("photo");
      if (!file || typeof file === "string" || file.size === 0 || file.size > MAX_PHOTO_INPUT) throw new ListError("invalid-photo");
      await addListItem(viewer, ownerId, {
        kind: "photo", title: text(form, "title"), upload: Buffer.from(await file.arrayBuffer()),
      });
    } else {
      throw new ListError("invalid-item");
    }
  } catch (error) {
    if (error instanceof ListError || error instanceof LinkError) return {error: error.code};
    console.error("Onboarding item failed", error instanceof Error ? error.name : "Unknown error");
    return {error: "could-not-save"};
  }
  revalidatePath(`/${await getLocale()}/lists`, "layout");
  return {added: true, ...(pictureComing && {pictureComing})};
}
