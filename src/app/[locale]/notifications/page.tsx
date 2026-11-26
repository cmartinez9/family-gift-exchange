import {getFormatter, getTranslations} from "next-intl/server";
import {HomeScreenHelp} from "@/components/notifications/home-screen-help";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {listNotifications} from "@/server/messages/inbox";
import {pushConfig} from "@/server/messages/push";
import {hasPushSubscription} from "@/server/messages/subscriptions";
import {readNotification} from "./actions";
import {DeviceNotifications} from "./device-notifications";

const action = "inline-flex min-h-12 items-center underline";

export default async function NotificationsPage() {
  const viewer = await requireViewer();
  const [t, format, notifications, enabled] = await Promise.all([
    getTranslations("notify.inbox"), getFormatter(), listNotifications(viewer), hasPushSubscription(viewer),
  ]);
  const canHandleReset = viewer.isOrganizer && viewer.actingAs === viewer.personId;

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 text-lg">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Link href="/account" className={action}>{t("back")}</Link>

      {notifications.length === 0 ? <p>{t("empty")}</p> : (
        <ul className="space-y-4">
          {notifications.map(({id, title, body, createdAt, isRead, isPinResetRequest, language}) => (
            <li key={id} className="space-y-1 border-b border-current/25 pb-3">
              <div lang={language}>
                <h2 className="text-xl font-semibold">{title}</h2>
                <p>{body}</p>
              </div>
              <p>
                <time dateTime={createdAt.toISOString()}>{format.dateTime(createdAt, {dateStyle: "medium", timeStyle: "short"})}</time>
                {" · "}{t(isRead ? "read" : "unread")}
              </p>
              {canHandleReset && isPinResetRequest && <Link href="/family" className={action}>{t("resetRequests")}</Link>}
              {!isRead && (
                <form action={readNotification.bind(null, id)}>
                  <button type="submit" className={action}>{t("markRead")}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <DeviceNotifications publicKey={pushConfig()?.publicKey ?? null} initiallyEnabled={enabled} />
      <HomeScreenHelp />
    </main>
  );
}
