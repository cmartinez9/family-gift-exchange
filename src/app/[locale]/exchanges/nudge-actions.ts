"use server";

import {requireViewer} from "@/server/auth";
import {nudgeList, nudgeUnopened, type NudgeResult} from "@/server/messages";

export async function nudgePerson(exchangeId: string, personId: string): Promise<NudgeResult> {
  return nudgeList(await requireViewer(), exchangeId, personId);
}

export async function remindUnopenedPeople(exchangeId: string) {
  return nudgeUnopened(await requireViewer(), exchangeId);
}
