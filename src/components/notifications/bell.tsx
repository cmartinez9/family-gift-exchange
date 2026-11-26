import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import type {Viewer} from "@/server/auth";
import {getUnreadCount} from "@/server/messages/inbox";

export async function NotificationBell({viewer}: {viewer: Viewer}) {
  const [t, unread] = await Promise.all([getTranslations("notify.inbox"), getUnreadCount(viewer)]);
  return (
    <Link href="/notifications" className="inline-flex min-h-12 items-center gap-2 underline">
      <span aria-hidden="true">🔔</span>
      {unread ? t("bellUnread", {count: unread}) : t("title")}
    </Link>
  );
}
