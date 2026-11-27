import {getLocale} from "next-intl/server";
import {redirect} from "next/navigation";
import {getViewer} from "@/server/auth";
import {clearStaleBorrowedSession} from "@/server/auth/request";

export async function GET() {
  const viewer = await getViewer();
  await clearStaleBorrowedSession(viewer);
  const locale = await getLocale();
  redirect(viewer?.borrowed ? `/${locale}/welcome/${viewer.borrowed.hidden ? "done" : "borrowed"}` : `/${locale}`);
}
