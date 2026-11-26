"use server";

import {and, eq, isNull} from "drizzle-orm";
import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {requireViewer} from "@/server/auth";
import {clearSession} from "@/server/auth/request";
import {actFor, disputeEvent, disputeSession, endSessions} from "@/server/auth/security";
import {revalidateViewer, uuidPattern} from "@/server/auth/session";
import {lockFamily} from "@/server/auth/access";
import {people} from "@/server/db/schema";
import {withFamily} from "@/server/db/client";
import {repairDisputedReveals} from "@/server/draw";
import type {AuthResult} from "../sign-in/actions";

export async function switchProfile(personId: string): Promise<AuthResult> {
  if (!uuidPattern.test(personId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const changed = await withFamily(viewer.familyId, (tx) => actFor(tx, viewer, personId));
  if (!changed) return {error: "forbidden"};
  redirect(`/${await getLocale()}/account`);
}

export async function signOut(all: boolean): Promise<AuthResult> {
  const viewer = await requireViewer();
  await withFamily(viewer.familyId, (tx) => endSessions(tx, viewer, new Date(), all === true));
  await clearSession();
  redirect(`/${await getLocale()}/sign-in`);
}

export async function reportEvent(eventId: string): Promise<AuthResult> {
  if (!uuidPattern.test(eventId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const recorded = await withFamily(viewer.familyId, (tx) => disputeEvent(tx, viewer, eventId, new Date()));
  return finishReport(viewer, recorded);
}

export async function reportSession(sessionId: string): Promise<AuthResult> {
  if (!uuidPattern.test(sessionId)) return {error: "unavailable"};
  const viewer = await requireViewer();
  const recorded = await withFamily(viewer.familyId, (tx) => disputeSession(tx, viewer, sessionId, new Date()));
  return finishReport(viewer, recorded);
}

async function finishReport(viewer: Awaited<ReturnType<typeof requireViewer>>, recorded: Awaited<ReturnType<typeof disputeEvent>>): Promise<AuthResult> {
  if (!recorded) return {error: "unavailable"};
  await repairDisputedReveals(viewer);
  if (recorded === "lockdown") {
    await clearSession();
    redirect(`/${await getLocale()}/sign-in?family=${viewer.familyId}&safety=1`);
  }
  redirect(`/${await getLocale()}/account?reported=1`);
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
