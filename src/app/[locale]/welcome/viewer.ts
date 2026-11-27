import {cookies} from "next/headers";
import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {requireViewer} from "@/server/auth";
import {borrowedCookie} from "@/server/auth/session";

export type WelcomeProps = {searchParams?: Promise<{borrowed?: string}>};

export async function requireWelcomeViewer({searchParams}: WelcomeProps = {}, mode: "help" | "reveal" = "help") {
  const viewer = await requireViewer({borrowed: mode});
  const expected = (await searchParams)?.borrowed;
  if ((expected && (!viewer.borrowed || viewer.sessionId !== expected))
    || (!viewer.borrowed && (await cookies()).get(borrowedCookie)?.value)) {
    redirect(`/${await getLocale()}/welcome/borrowed/expired`);
  }
  return viewer;
}
