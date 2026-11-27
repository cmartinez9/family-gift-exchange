"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getLocale} from "next-intl/server";
import {requireViewer} from "@/server/auth";
import {withFamily} from "@/server/db/client";
import {
  addListItem, editListItem, ListError, moveListItem, refreshListItem, removeListItem, saveAboutField,
  saveListSize, saveNoClothes, setExchangeBudget,
} from "@/server/lists";
import {requireListEditor} from "@/server/lists/access";
import {acknowledgeItemChange, claimItem, setClaimTick, undoClaim} from "@/server/lists/claims";
import {LinkError, resolveLinkPreview} from "@/server/lists/link-preview";
import {readLinkDraft, signLinkDraft} from "@/server/lists/link-preview/draft";
import {MAX_PHOTO_INPUT} from "@/server/lists/photo-storage";
import {aboutFields, itemKinds, type AboutField, type ItemKind} from "@/server/lists/validation";
import type {FormState, PreviewState} from "./action-types";

function feedback(error: unknown) {
  if (error instanceof ListError || error instanceof LinkError) return error.code;
  console.error("Wishlist action failed", error instanceof Error ? error.name : "Unknown error");
  return "could-not-save" as const;
}

function stringField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

async function uploadedPhoto(form: FormData) {
  const file = form.get("photo");
  if (!file || typeof file === "string" || file.size === 0) return;
  if (file.size > MAX_PHOTO_INPUT) throw new ListError("invalid-photo");
  return Buffer.from(await file.arrayBuffer());
}

function dataImage(bytes: Buffer | undefined) {
  return bytes ? `data:image/webp;base64,${bytes.toString("base64")}` : undefined;
}

export async function previewItemLink(ownerId: string, input: string): Promise<PreviewState> {
  const viewer = await requireViewer();
  try {
    await withFamily(viewer.familyId, (tx) => requireListEditor(tx, viewer, ownerId));
    const preview = await resolveLinkPreview(input);
    return {card: {
      url: preview.url, title: preview.title, price: preview.price, store: preview.store, icon: preview.icon,
      photo: dataImage(preview.image), favicon: dataImage(preview.favicon),
      ticket: signLinkDraft(viewer, input, preview),
    }};
  } catch (error) {
    return {error: feedback(error)};
  }
}

/**
 * Saves a new or edited item. A page form returns to the list, which toasts "Added" or "Saved"; a form in
 * a sheet over the list (`stay`) refreshes the list and reports back instead.
 */
export async function saveItem(
  ownerId: string, itemId: string | null, kind: ItemKind, stay: boolean, _previous: FormState, form: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    if (!itemKinds.includes(kind)) throw new ListError("invalid-item");
    const link = kind === "link" ? stringField(form, "link") : undefined;
    const draft = link ? readLinkDraft(viewer, link, stringField(form, "draft")) : undefined;
    const services = draft ? {resolve: async () => draft} : undefined;
    const price = stringField(form, "price");
    const input = {
      title: stringField(form, "title"), note: stringField(form, "note"),
      price: itemId || form.get("priceEdited") === "true" ? price : price || undefined,
      starred: form.get("starred") === "on", link, upload: await uploadedPhoto(form),
    };
    if (itemId) await editListItem(viewer, ownerId, itemId, input, services);
    else await addListItem(viewer, ownerId, {kind, ...input}, services);
  } catch (error) {
    return {error: feedback(error)};
  }
  if (stay) {
    await refreshLists();
    return {status: "saved"};
  }
  return returnToList(ownerId, itemId ? "saved" : "added");
}

async function refreshLists() {
  const locale = await getLocale();
  revalidatePath(`/${locale}/lists`, "layout");
  revalidatePath(`/${locale}`);
}

/** Back to the list; `done` names the toast the list shows once it arrives. */
async function returnToList(ownerId: string, done?: "added" | "saved"): Promise<never> {
  const locale = await getLocale();
  await refreshLists();
  redirect(`/${locale}/lists/${ownerId.toLowerCase()}${done ? `?done=${done}` : ""}`);
}

/** The heart on your own item: "Really want this". */
export async function setItemStar(ownerId: string, itemId: string, starred: boolean): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    await editListItem(viewer, ownerId, itemId, {starred});
  } catch (error) {
    return {error: feedback(error)};
  }
  await refreshLists();
  return {status: "saved"};
}

export async function removeItem(ownerId: string, itemId: string): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    await removeListItem(viewer, ownerId, itemId);
  } catch (error) {
    return {error: feedback(error)};
  }
  await refreshLists();
  return {status: "saved"};
}

export async function itemCommand(
  ownerId: string, itemId: string, command: "up" | "down" | "refresh" | "delete",
): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    if (command === "up" || command === "down") await moveListItem(viewer, ownerId, itemId, command);
    else if (command === "refresh") await refreshListItem(viewer, ownerId, itemId);
    else if (command === "delete") await removeListItem(viewer, ownerId, itemId);
    else throw new ListError("invalid-item");
  } catch (error) {
    return {error: feedback(error)};
  }
  return returnToList(ownerId);
}

export async function claimCommand(
  actingAs: string, itemId: string, command: "claim" | "undo" | "bought" | "wrapped", checked: boolean,
): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    if (viewer.actingAs !== actingAs) throw new ListError("forbidden");
    if (command === "claim") await claimItem(viewer, itemId);
    else if (command === "undo") await undoClaim(viewer, itemId);
    else if (command === "bought" || command === "wrapped") await setClaimTick(viewer, itemId, command, checked);
    else throw new ListError("invalid-item");
  } catch (error) {
    return {error: feedback(error)};
  }
  await refreshLists();
  return {};
}

/** "Still getting it": you have seen what the owner changed, as it was shown to you. */
export async function acknowledgeChange(itemId: string, version: string): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    await acknowledgeItemChange(viewer, itemId, version);
  } catch (error) {
    return {error: feedback(error)};
  }
  const locale = await getLocale();
  revalidatePath(`/${locale}/lists`, "layout");
  return {};
}

export async function saveProfileField(
  ownerId: string, field: string, value: string, group: "size" | "about" | "noClothes",
): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    if (group === "size") await saveListSize(viewer, ownerId, field, value);
    else if (group === "noClothes" && (value === "true" || value === "false")) {
      await saveNoClothes(viewer, ownerId, value === "true");
    } else if (group === "about" && aboutFields.includes(field as AboutField)) {
      await saveAboutField(viewer, ownerId, field as AboutField, value);
    } else throw new ListError("invalid-profile");
  } catch (error) {
    return {error: feedback(error)};
  }
  const locale = await getLocale();
  revalidatePath(`/${locale}/lists/${ownerId.toLowerCase()}`);
  revalidatePath(`/${locale}/lists`);
  return {status: "saved"};
}

export async function saveBudget(exchangeId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  try {
    const value = stringField(form, "budget");
    if (value === undefined) throw new ListError("invalid-budget");
    await setExchangeBudget(viewer, exchangeId, value);
  } catch (error) {
    return {error: feedback(error)};
  }
  const locale = await getLocale();
  revalidatePath(`/${locale}/lists`, "layout");
  return {status: "saved"};
}
