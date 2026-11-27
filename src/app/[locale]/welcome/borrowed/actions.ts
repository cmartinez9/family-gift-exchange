"use server";

import {revalidatePath} from "next/cache";
import {getViewer, requireViewer} from "@/server/auth";
import {hideBorrowedPerson, returnBorrowedPhone} from "@/server/auth/borrowed";
import {clearBorrowedSession} from "@/server/auth/request";
import {withFamily} from "@/server/db/client";
import {DrawError, revealMyPerson} from "@/server/draw";

export type BorrowedReveal = {name?: string; error?: "unavailable" | "refresh"};

/** Opening your own person on someone else's phone (9.3): the same reveal as on your own, and only there. */
export async function revealOnBorrowedPhone(exchangeId: string, version: number): Promise<BorrowedReveal> {
  const viewer = await requireViewer({borrowed: "reveal"});
  if (!viewer.borrowed) return {error: "refresh"};
  if (typeof exchangeId !== "string" || !Number.isInteger(version)) return {error: "unavailable"};
  try {
    const {person} = await revealMyPerson(viewer, exchangeId, version);
    return {name: person.displayName};
  } catch (error) {
    if (error instanceof DrawError) return {
      error: ["drawChanged", "closed", "notFound", "forbidden"].includes(error.code) ? "refresh" : "unavailable",
    };
    throw error;
  }
}

/** "Hide Beto": nobody holding the phone after this can open the person again. */
export async function hideOnBorrowedPhone(): Promise<{hidden: boolean}> {
  const viewer = await getViewer();
  if (!viewer?.borrowed) return {hidden: true};
  return {hidden: await withFamily(viewer.familyId, (tx) => hideBorrowedPerson(tx, viewer, new Date()))};
}

/**
 * "Sign Rosa out of this phone": ends the borrowed session and leaves the owner's. The caller then loads the
 * owner's Home afresh, so nothing of the relative's stays in memory.
 */
export async function returnPhone() {
  const viewer = await getViewer();
  if (viewer?.borrowed) await withFamily(viewer.familyId, (tx) => returnBorrowedPhone(tx, viewer, new Date()));
  await clearBorrowedSession();
  revalidatePath("/", "layout");
}
