"use server";

import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {manage, type FormState} from "./actions";

/** Closes the season, then shows the organizer its wrap. */
export async function closeSeason(id: string, previous: FormState, data: FormData): Promise<FormState> {
  const result = await manage(id, {kind: "close"}, previous, data);
  if (result.error) return result;
  redirect(`/${await getLocale()}/exchanges/${encodeURIComponent(id)}`);
}
