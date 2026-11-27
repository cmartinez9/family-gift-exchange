import "server-only";
import {cookies} from "next/headers";
import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {withFamily} from "../db/client";
import {borrowedCookie, findViewer, parseSession, sessionCookie, touchSession} from "./session";

export type Viewer = {
  personId: string;
  familyId: string;
  sessionId: string;
  isOrganizer: boolean;
  actingAs: string;
  /**
   * Identity for a session inside the phone owner's session. `hidden` reflects the hand-back seal defined
   * on `sessions.personHiddenAt` in ./schema.
   */
  borrowed?: {lenderSessionId: string; lenderPersonId: string; hidden: boolean};
};

/**
 * Who is using this phone. The session cookie is always the phone's owner; while a relative uses it to open
 * their own key, their session rides in the borrowed cookie and wins, for as long as it and the owner's
 * session both last. When it ends, the phone is its owner's again without signing in.
 */
export async function getViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const session = parseSession(jar.get(sessionCookie)?.value);
  if (!session) return null;
  const borrowed = parseSession(jar.get(borrowedCookie)?.value);
  return withFamily(session.familyId, async (tx) => {
    const owner = await findViewer(tx, session);
    if (!owner || owner.borrowed) return null;
    let viewer = owner;
    if (borrowed?.familyId === owner.familyId) {
      const guest = await findViewer(tx, borrowed);
      if (guest?.borrowed?.lenderSessionId === owner.sessionId) viewer = guest;
    }
    await touchSession(tx, viewer, new Date());
    return viewer;
  });
}

export async function requireViewer({borrowed}: {borrowed?: "reveal" | "help"} = {}): Promise<Viewer> {
  const viewer = await getViewer();
  const locale = await getLocale();
  if (viewer) {
    if (viewer.borrowed && (!borrowed || (borrowed === "help" && !viewer.borrowed.hidden))) {
      redirect(`/${locale}/welcome/${viewer.borrowed.hidden ? "done" : "borrowed"}`);
    }
    return viewer;
  }
  redirect(`/${locale}/sign-in`);
}

export {listSessionDisputes} from "./security";
