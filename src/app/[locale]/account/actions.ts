"use server";

import {and, eq, isNull} from "drizzle-orm";
import {getLocale} from "next-intl/server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {requireViewer} from "@/server/auth";
import {clearBorrowedSession, clearSession} from "@/server/auth/request";
import {actFor, disputeEvent, disputeSession, endSessions, signOutDevice, turnOffFaceId} from "@/server/auth/security";
import {revalidateViewer, uuidPattern} from "@/server/auth/session";
import {lockFamily} from "@/server/auth/access";
import {people} from "@/server/db/schema";
import {withFamily} from "@/server/db/client";
import {DrawError, repairDisputedReveals} from "@/server/draw";
import {markNotificationRead} from "@/server/messages/inbox";
import type {AuthResult} from "../sign-in/actions";

export async function switchProfile(personId: string): Promise<AuthResult> {
  if (!uuidPattern.test(personId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const changed = await withFamily(viewer.familyId, (tx) => actFor(tx, viewer, personId));
  if (!changed) return {error: "forbidden"};
  // The shared layout shows the helping banner, so it renders again for the new profile.
  revalidatePath("/", "layout");
  // Helping someone starts where they need you; coming back to yourself returns to your account.
  redirect(`/${await getLocale()}/${personId === viewer.personId ? "account" : "helping"}`);
}

export async function signOut(all: boolean): Promise<AuthResult> {
  const viewer = await requireViewer();
  await withFamily(viewer.familyId, (tx) => endSessions(tx, viewer, new Date(), all === true));
  if (viewer.borrowed) {
    // signing out on a borrowed phone hands it back: its owner is still signed in
    await clearBorrowedSession();
    revalidatePath("/", "layout");
    redirect(`/${await getLocale()}`);
  }
  await clearSession();
  revalidatePath("/", "layout");
  redirect(`/${await getLocale()}/sign-in`);
}

/** Your phones (11.3): sign out one other phone. This one stays signed in. */
export async function signOutPhone(sessionId: string): Promise<AuthResult> {
  if (!uuidPattern.test(sessionId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const done = await withFamily(viewer.familyId, (tx) => signOutDevice(tx, viewer, sessionId, new Date()));
  if (!done) return {error: "unavailable"};
  revalidatePath("/[locale]/account", "layout");
  return {success: done.deviceKind};
}

/**
 * The Face ID switch (11.1), off. Returns the credentials it removed, so the phone can be asked to forget
 * them too. Turning it on is the usual enrollment (`beginFaceId(true)`).
 */
export async function faceIdOff(): Promise<AuthResult & {credentials?: string[]}> {
  const viewer = await requireViewer();
  const result = await withFamily(viewer.familyId, (tx) => turnOffFaceId(tx, viewer, new Date()));
  if ("error" in result) return {error: result.error};
  revalidatePath("/[locale]/account", "layout");
  return {success: "faceOff", credentials: result.credentials};
}

export async function reportEvent(eventId: string): Promise<AuthResult> {
  if (!uuidPattern.test(eventId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const recorded = await withFamily(viewer.familyId, (tx) => disputeEvent(tx, viewer, eventId, new Date()));
  return finishReport(viewer, recorded, eventId);
}

export async function reportSession(sessionId: string): Promise<AuthResult> {
  if (!uuidPattern.test(sessionId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const recorded = await withFamily(viewer.familyId, (tx) => disputeSession(tx, viewer, sessionId, new Date()));
  return finishReport(viewer, recorded);
}

async function finishReport(viewer: Awaited<ReturnType<typeof requireViewer>>, recorded: Awaited<ReturnType<typeof disputeEvent>>, eventId?: string): Promise<AuthResult> {
  if (!recorded) return {error: "unavailable"};
  if (recorded === "lockdown") {
    await clearSession();
    revalidatePath("/", "layout");
    redirect(`/${await getLocale()}/sign-in?family=${viewer.familyId}&safety=1`);
  }
  let repairError: AuthResult["error"];
  try {
    await repairDisputedReveals(viewer);
  } catch (error) {
    if (!(error instanceof DrawError) || (error.code !== "repairImpossible" && error.code !== "checkTimedOut")) throw error;
    repairError = "repairRequired";
  }
  if (repairError) return {error: repairError};
  redirect(`/${await getLocale()}/account${eventId ? `/notices/${eventId}` : ""}?reported=1`);
}

export async function setLanguage(language: string) {
  if (language !== "en" && language !== "es") return;
  const viewer = await requireViewer();
  const {familyId, personId} = viewer;
  await withFamily(familyId, async (tx) => {
    await lockFamily(tx, familyId);
    if (!await revalidateViewer(tx, viewer)) return;
    await tx.update(people).set({language})
      .where(and(eq(people.familyId, familyId), eq(people.id, personId), isNull(people.removedAt)));
  });
  redirect(`/${language}/account`);
}

/** Tapping an unread notice on Notices marks it read. */
export async function readNotice(id: string) {
  const viewer = await requireViewer();
  await markNotificationRead(viewer, id);
  revalidatePath("/[locale]/account", "layout");
}

export async function readResetRequest(id: string) {
  await readNotice(id);
  redirect(`/${await getLocale()}/family`);
}
