"use server";

import {requireViewer} from "@/server/auth";
import {nudgeList, type NudgeResult} from "@/server/messages";

/** The organizer's Nudge button. "already" counts as done: the person has had today's nudge. */
export async function nudgePerson(exchangeId: string, personId: string): Promise<NudgeResult> {
  return nudgeList(await requireViewer(), exchangeId, personId);
}
