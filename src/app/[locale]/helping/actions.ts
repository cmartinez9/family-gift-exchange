"use server";

import {requireViewer} from "@/server/auth";
import {switchProfile} from "../account/actions";

/** The mode banner's Done: back to being yourself. */
export async function stopHelping() {
  const viewer = await requireViewer();
  await switchProfile(viewer.personId);
}
