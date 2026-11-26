"use server";

import {getLocale, getTranslations} from "next-intl/server";
import {revalidatePath} from "next/cache";
import QRCode from "qrcode";
import {requireViewer} from "@/server/auth";
import {issueKey, markKeySent, type KeyKind} from "@/server/auth/access";
import {changeCoOrganizer, changeKeepApart, removeMember, saveHousehold, saveMember} from "@/server/auth/families";
import {authenticatorSecret} from "@/server/auth/pin";
import {appOrigin} from "@/server/auth/request";
import {uuidPattern} from "@/server/auth/session";
import {withFamily} from "@/server/db/client";
import type {AuthResult} from "../sign-in/actions";

function field(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function refreshFamily(error: string | null): Promise<AuthResult> {
  if (error) return {error};
  revalidatePath(`/${await getLocale()}/family`);
  return {success: "saved"};
}

export async function updateMember(id: string | null, _: AuthResult, data: FormData): Promise<AuthResult> {
  const viewer = await requireViewer();
  const name = field(data, "name");
  const language = field(data, "language");
  const helperId = field(data, "helper") || null;
  const householdId = field(data, "household") || null;
  if (!name || name.length > 60) return {error: "invalidName"};
  if ((language !== "en" && language !== "es") || [id, helperId, householdId].some((value) => value !== null && !uuidPattern.test(value))) {
    return {error: "unavailable"};
  }
  const error = await withFamily(viewer.familyId, (tx) => saveMember(tx, viewer, id, {name, language, helperId, householdId}));
  return refreshFamily(error);
}

export async function deleteMember(id: string): Promise<AuthResult> {
  if (!uuidPattern.test(id)) return {error: "unavailable"};
  const viewer = await requireViewer();
  return refreshFamily(await withFamily(viewer.familyId, (tx) => removeMember(tx, viewer, id, new Date())));
}

export async function updateHousehold(id: string | null, remove: boolean, _: AuthResult, data: FormData): Promise<AuthResult> {
  if (id !== null && !uuidPattern.test(id)) return {error: "unavailable"};
  const name = field(data, "name");
  if (!remove && (!name || name.length > 60)) return {error: "invalidName"};
  const viewer = await requireViewer();
  return refreshFamily(await withFamily(viewer.familyId, (tx) => saveHousehold(tx, viewer, id, remove ? null : name)));
}

export async function updatePair(pair: [string, string] | null, _: AuthResult, data: FormData): Promise<AuthResult> {
  const [first, second] = pair ?? [field(data, "first"), field(data, "second")];
  if (!uuidPattern.test(first) || !uuidPattern.test(second)) return {error: "unavailable"};
  const viewer = await requireViewer();
  return refreshFamily(await withFamily(viewer.familyId, (tx) => changeKeepApart(tx, viewer, first, second, Boolean(pair))));
}

export async function updateCoOrganizer(_: AuthResult, data: FormData): Promise<AuthResult> {
  const id = field(data, "coOrganizer") || null;
  if (id && !uuidPattern.test(id)) return {error: "unavailable"};
  const viewer = await requireViewer();
  return refreshFamily(await withFamily(viewer.familyId, (tx) => changeCoOrganizer(tx, viewer, id)));
}

export type Prepared = AuthResult & {
  key?: {id: string; url: string; familyAddress: string; code: string; message: string; qr?: string; expiresAt: string};
};

export async function prepareKey(personId: string, kind: KeyKind): Promise<Prepared> {
  if (!uuidPattern.test(personId) || !["share", "qr", "print", "reset"].includes(kind)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const origin = appOrigin();
  const result = await withFamily(viewer.familyId, (tx) => issueKey(tx, viewer, personId, kind, authenticatorSecret(), new Date()));
  if ("error" in result && result.error) return {error: result.error};
  const url = new URL(`/${result.language}/key/${viewer.familyId}~${result.token}`, origin).href;
  const familyAddress = new URL(`/${result.language}/sign-in?family=${viewer.familyId}`, origin).href;
  const t = await getTranslations({locale: result.language, namespace: "auth"});
  const message = t(kind === "reset" ? "resetMessage" : "keyMessage", {name: result.name, url});
  return {key: {
    id: result.id, url, familyAddress, code: result.code, message, expiresAt: result.expiresAt.toISOString(),
    qr: kind === "qr" || kind === "print" ? await QRCode.toDataURL(url, {width: 320, margin: 4}) : undefined,
  }};
}

export async function sentKey(keyId: string): Promise<AuthResult> {
  if (!uuidPattern.test(keyId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const ok = await withFamily(viewer.familyId, (tx) => markKeySent(tx, viewer, keyId, new Date()));
  if (!ok) return {error: "unavailable"};
  const locale = await getLocale();
  revalidatePath(`/${locale}/family`);
  revalidatePath(`/${locale}/family/keys`);
  return {success: "sent"};
}
