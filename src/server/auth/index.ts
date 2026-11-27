import "server-only";
import {cookies} from "next/headers";
import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {withFamily} from "../db/client";
import {findViewer, parseSession, sessionCookie, touchSession} from "./session";

export type Viewer = {
  personId: string;
  familyId: string;
  sessionId: string;
  isOrganizer: boolean;
  actingAs: string;
};

export async function getViewer(): Promise<Viewer | null> {
  const session = parseSession((await cookies()).get(sessionCookie)?.value);
  return session ? withFamily(session.familyId, async (tx) => {
    const viewer = await findViewer(tx, session);
    if (viewer) await touchSession(tx, viewer, new Date());
    return viewer;
  }) : null;
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (viewer) return viewer;
  const locale = await getLocale();
  redirect(`/${locale}/sign-in`);
}

export {listSessionDisputes} from "./security";
