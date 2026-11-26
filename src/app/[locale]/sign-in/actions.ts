"use server";

import {randomUUID} from "node:crypto";
import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {withFamily} from "@/server/db/client";
import {notify} from "@/server/messages";
import {getViewer, requireViewer} from "@/server/auth";
import {
  allowCodeTry, disputeUsedKey, inspectKey, keyCodePattern, lockFamily, parseLinkKey,
  redeemKey, requestPinReset, signInWithPin,
} from "@/server/auth/access";
import {createFamily, permitCreation} from "@/server/auth/families";
import {authenticatorSecret, pinProblem} from "@/server/auth/pin";
import {appOrigin, requestDevice, setSession} from "@/server/auth/request";
import {uuidPattern} from "@/server/auth/session";
import {createCodePreview} from "@/server/auth/code-preview";
import type {AuthenticationResponseJSON, RegistrationResponseJSON} from "@simplewebauthn/server";
import {
  authenticationFinish, authenticationStart, changePinAfterFaceId, registrationFinish, registrationStart,
} from "@/server/auth/webauthn";

export type AuthResult = {error?: string; success?: string};

function field(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

export async function startFamily(_: AuthResult, data: FormData): Promise<AuthResult> {
  const locale = await getLocale() === "es" ? "es" : "en";
  if (await getViewer()) return {error: "otherPerson"};
  const familyName = field(data, "familyName").trim();
  const displayName = field(data, "displayName").trim();
  if (!familyName || familyName.length > 80 || !displayName || displayName.length > 60) return {error: "invalidName"};
  const invite = field(data, "invite");
  const pepper = authenticatorSecret();
  if (invite.length > 128 || !permitCreation(process.env.ORGANIZER_INVITE_CODE, invite, pepper)) {
    return {error: "inviteInvalid"};
  }
  const pin = field(data, "pin");
  const problem = pinProblem(pin, field(data, "confirmation"));
  if (problem) return {error: problem};
  const familyId = randomUUID();
  const device = await requestDevice();
  const session = await withFamily(familyId, (tx) => createFamily(tx, {
    familyId, familyName, displayName, language: locale, pin, pepper, device, now: new Date(),
  }));
  await setSession(familyId, session.cookie);
  redirect(`/${locale}/face-id?setup=1`);
}

export async function openFamily(_: AuthResult, data: FormData): Promise<AuthResult> {
  const address = field(data, "address").trim();
  if (address.length > 400) return {error: "familyAddressInvalid"};
  const origin = appOrigin();
  let link: URL;
  try {
    link = new URL(address, origin);
  } catch {
    return {error: "familyAddressInvalid"};
  }
  if (link.origin !== origin.origin) return {error: "familyAddressInvalid"};
  const locale = await getLocale();
  const key = link.pathname.match(/^\/(?:en|es)\/key\/([^/]+)$/)?.[1];
  if (key && parseLinkKey(key)) redirect(`/${locale}/key/${key}`);
  const familyId = link.searchParams.get("family") ?? "";
  if (!/^\/(?:en|es)\/sign-in\/?$/.test(link.pathname) || !uuidPattern.test(familyId)) {
    return {error: "familyAddressInvalid"};
  }
  redirect(`/${locale}/sign-in?family=${familyId}`);
}

export async function enterPin(familyId: string, personId: string, _: AuthResult, data: FormData): Promise<AuthResult> {
  if (!uuidPattern.test(familyId) || !uuidPattern.test(personId)) return {error: "unavailable"};
  const viewer = await getViewer();
  if (viewer) return {error: "otherPerson"};
  const pin = field(data, "pin");
  const device = await requestDevice();
  const result = await withFamily(familyId, (tx) => signInWithPin(tx, familyId, personId, pin, authenticatorSecret(), device, new Date()));
  if (!result.session) return {error: result.error ?? "unavailable"};
  await setSession(familyId, result.session.cookie);
  redirect(`/${await getLocale()}/account`);
}

export async function forgotPin(familyId: string, personId: string): Promise<AuthResult> {
  if (!uuidPattern.test(familyId) || !uuidPattern.test(personId)) return {error: "unavailable"};
  const device = await requestDevice();
  return withFamily(familyId, async (tx) => {
    const result = await requestPinReset(tx, familyId, personId, device, new Date());
    if (result.success) await notify.requestPinReset({familyId, personId}, tx);
    return result;
  });
}

export async function reportUsedKey(familyId: string, value: string, typed: boolean): Promise<AuthResult> {
  if (!uuidPattern.test(familyId) || typeof value !== "string" || typeof typed !== "boolean") return {error: "unavailable"};
  const device = await requestDevice();
  return withFamily(familyId, (tx) => disputeUsedKey(tx, familyId, value, typed, authenticatorSecret(), device, new Date()));
}

export type CodeResult = AuthResult & {
  key?: {personId: string; name: string; familyName: string; available: boolean; usedAt: string | null; usedDevice?: string; preview?: string};
};

export async function previewCode(familyId: string, code: string): Promise<CodeResult> {
  if (!uuidPattern.test(familyId) || typeof code !== "string" || !keyCodePattern.test(code)) return {error: "unavailable"};
  const device = await requestDevice();
  const viewer = await getViewer();
  return withFamily(familyId, async (tx) => {
    if (!await lockFamily(tx, familyId)) return {error: "unavailable"};
    const now = new Date();
    if (!await allowCodeTry(tx, familyId, device, now)) return {error: "tryLater"};
    const key = await inspectKey(tx, familyId, code, now, authenticatorSecret());
    if (!key || (!key.available && !key.usedAt)) return {error: "unavailable"};
    if (viewer && (viewer.familyId !== familyId || viewer.personId !== key.personId)) return {error: "otherPerson"};
    return {key: {...key, usedAt: key.usedAt?.toISOString() ?? null,
      preview: createCodePreview(authenticatorSecret(), familyId, key, code, device.hash)}};
  });
}

export async function useKey(familyId: string, value: string, typed: boolean, preview: string | null, _: AuthResult, data: FormData): Promise<AuthResult> {
  if (!uuidPattern.test(familyId) || typeof value !== "string" || typeof typed !== "boolean") return {error: "unavailable"};
  const currentViewer = await getViewer();
  const device = await requestDevice();
  const result = await withFamily(familyId, (tx) => redeemKey(tx, {
    familyId, value, typed, preview, device, currentViewer,
    pin: field(data, "pin"), confirmation: field(data, "confirmation"),
    pepper: authenticatorSecret(), now: new Date(),
  }));
  if (!result.session) return {error: result.error ?? "unavailable"};
  await setSession(familyId, result.session.cookie);
  redirect(`/${await getLocale()}/face-id`);
}

export async function beginFaceId(enroll: boolean) {
  if (enroll) {
    const viewer = await requireViewer();
    return registrationStart(viewer, await requestDevice());
  }
  return authenticationStart(await requestDevice());
}

export async function finishFaceIdEnrollment(response: RegistrationResponseJSON) {
  const viewer = await requireViewer();
  try {
    return await registrationFinish(viewer, await requestDevice(), response);
  } catch {
    return false;
  }
}

export async function finishFaceIdSignIn(response: AuthenticationResponseJSON) {
  const viewer = await getViewer();
  let authenticated;
  try {
    authenticated = await authenticationFinish(await requestDevice(), response, viewer);
  } catch {
    return false;
  }
  if (!authenticated) return false;
  await setSession(authenticated.familyId, authenticated.session.cookie);
  return true;
}

export async function changePin(_: AuthResult, data: FormData): Promise<AuthResult> {
  const viewer = await requireViewer();
  const error = await changePinAfterFaceId(viewer, await requestDevice(), field(data, "pin"), field(data, "confirmation"));
  return error ? {error} : {success: "pinChanged"};
}
