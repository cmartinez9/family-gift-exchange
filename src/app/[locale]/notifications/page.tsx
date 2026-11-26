import {getFormatter, getTranslations} from "next-intl/server";
import {HomeScreenHelp} from "@/components/notifications/home-screen-help";
import {TextButton, TextLink} from "@/components/ui/button";
import {Card, Rows} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon, type IconName} from "@/components/ui/icon";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {listNotifications} from "@/server/messages/inbox";
import {pushConfig} from "@/server/messages/push";
import {hasPushSubscription} from "@/server/messages/subscriptions";
import type {Template} from "@/server/messages/templates";
import {readNotification} from "./actions";
import {DeviceNotifications} from "./device-notifications";

/** What each notice is about, in the one icon set. */
const ICONS: Readonly<Record<Template, IconName>> = {
  "practice-reminder": "bell",
  "names-drawn": "gift",
  "list-reminder": "list",
  "plans-changed": "gift",
  "gift-day-reminder": "calendar",
  "pin-reset-request": "lock",
  "claimed-item-changed": "gift",
  "budget-changed": "tag",
  "question-answered": "message",
};

export default async function NotificationsPage() {
  const viewer = await requireViewer();
  const [t, ui, format, notifications, enabled] = await Promise.all([
    getTranslations("notify.inbox"), getTranslations("ui"), getFormatter(), listNotifications(viewer), hasPushSubscription(viewer),
  ]);
  const canHandleReset = viewer.isOrganizer && viewer.actingAs === viewer.personId;

  return (
    <Screen back="/account">
      <BackRow href="/account" parent={t("you")} backLabel={ui("back")} />
      <PageTitle title={t("heading")} lead={t("lead")} />
      <div className="flex flex-col gap-3 px-edge pt-6 pb-8">
        {notifications.length === 0 ? (
          <Card><p className="text-body">{t("empty")}</p></Card>
        ) : (
          <KnitIn>
            <Card flush className="px-5 py-1">
              <Rows as="ul">
                {notifications.map(({id, title, body, createdAt, isRead, isPinResetRequest, template, language}) => (
                  <li key={id} className="flex gap-3.5 py-4 max-[299px]:flex-col max-[299px]:gap-2" data-notice={isRead ? "read" : "unread"}>
                    <span aria-hidden="true" className={cn("mt-0.5 inline-flex size-12 shrink-0 items-center justify-center rounded-full",
                      isRead ? "bg-[var(--track)] text-ink" : "bg-sweater-red text-snow-white")}>
                      <Icon name={ICONS[template]} size={22} strokeWidth={2.3} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div lang={language}>
                        <h2 className="text-row-title">{title}</h2>
                        <p className="text-body text-[var(--fg-muted)]">{body}</p>
                      </div>
                      {canHandleReset && isPinResetRequest && (
                        <TextLink href="/family" transition="push" className="-ml-3 self-start">{t("resetRequests")}</TextLink>
                      )}
                      {!isRead && (
                        <form action={readNotification.bind(null, id)}>
                          <TextButton type="submit" className="-ml-3">{t("markRead")}</TextButton>
                        </form>
                      )}
                    </div>
                    <p className="flex shrink-0 flex-col items-end gap-2 pt-0.5 text-body font-semibold text-[var(--fg-muted)] max-[299px]:flex-row max-[299px]:items-center">
                      <time dateTime={createdAt.toISOString()} title={format.dateTime(createdAt, {dateStyle: "medium", timeStyle: "short"})}>
                        {format.dateTime(createdAt, {month: "short", day: "numeric"})}
                      </time>
                      {!isRead && <span aria-hidden="true" className="size-3 rounded-full bg-gold" />}
                      <span className="sr-only">{t(isRead ? "read" : "unread")}</span>
                    </p>
                  </li>
                ))}
              </Rows>
            </Card>
          </KnitIn>
        )}
        <DeviceNotifications publicKey={pushConfig()?.publicKey ?? null} initiallyEnabled={enabled} />
        <HomeScreenHelp className="text-snow-white" />
      </div>
    </Screen>
  );
}
