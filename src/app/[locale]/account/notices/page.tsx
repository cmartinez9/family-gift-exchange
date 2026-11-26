import type {ReactNode} from "react";
import {getFormatter, getTranslations} from "next-intl/server";
import {TextLink} from "@/components/ui/button";
import {Card, ListRow} from "@/components/ui/card";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {account} from "@/server/auth/security";
import {withFamily} from "@/server/db/client";
import {listNotifications} from "@/server/messages/inbox";
import {readNotice, readResetRequest} from "../actions";
import {noticeText} from "../notice-text";
import {RowDisc} from "../rows";
import {screenTitle} from "../../sign-in/title";

const SHORT = {month: "short", day: "numeric", timeZone: "America/Chicago"} as const;

export async function generateMetadata() {
  return screenTitle("notices.title");
}

/** A gold dot: something you have not read yet. */
function NewDot() {
  return <span aria-hidden="true" className="size-3 rounded-full bg-gold" />;
}

type Row = {key: string; at: Date; row: ReactNode};

/**
 * Notices (11.2): the family's messages to you, and what happened with your key, your PIN and your phones,
 * newest first. An unread message is marked read when tapped; anything you can question opens 11.5.
 */
export default async function NoticesPage() {
  const viewer = await requireViewer();
  const t = await getTranslations("getIn.notices");
  const you = await getTranslations("getIn.you");
  const ui = await getTranslations("ui");
  const format = await getFormatter();
  const [{activity}, inbox] = await Promise.all([withFamily(viewer.familyId, (tx) => account(tx, viewer)), listNotifications(viewer)]);
  const canHandleReset = viewer.isOrganizer && viewer.actingAs === viewer.personId;
  const when = (at: Date, unread = false) => (
    <span className="flex flex-col items-end gap-1.5 self-start pt-1.5">
      <time dateTime={at.toISOString()} className="text-body whitespace-nowrap text-muted-ink">{format.dateTime(at, SHORT)}</time>
      {unread && <NewDot />}
    </span>
  );
  const rows: Row[] = [
    ...inbox.map(({id, title, body, createdAt, isRead, isPinResetRequest, language}) => {
      const content = (
        <ListRow as="span" lead={<RowDisc icon={isPinResetRequest ? "lock" : "message"} tone={isRead ? "track" : "red"} />}
          title={<span lang={language}>{title}</span>} sub={<span lang={language}>{body}</span>} trail={when(createdAt, !isRead)} />
      );
      const press = "fge-press block w-full cursor-pointer rounded-[20px] text-left";
      return {key: id, at: createdAt, row: (
        <li key={id} data-notice="message">
          {canHandleReset && isPinResetRequest
            ? isRead
              ? <AppLink href="/family" transition="push" className={press}>{content}<span className="sr-only">{t("resetRequests")}</span></AppLink>
              : <form action={readResetRequest.bind(null, id)}><button type="submit" className={press}>{content}<span className="sr-only">{t("resetRequests")}</span></button></form>
            : !isRead
              ? <form action={readNotice.bind(null, id)}><button type="submit" className={press}>{content}</button></form>
              : content}
        </li>
      )};
    }),
    ...await Promise.all(activity.map(async (event) => {
      const text = await noticeText(event, viewer);
      const content = <ListRow as="span" lead={<RowDisc icon={text.icon} tone="track" />} title={text.title} sub={text.sub} trail={when(event.at)} />;
      return {key: event.id, at: event.at, row: (
        <li key={event.id} data-notice={event.kind}>
          {text.askable || event.disputed
            ? <AppLink href={`/account/notices/${event.id}`} transition="push" className="fge-press block rounded-[20px]">{content}</AppLink>
            : content}
        </li>
      )};
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Screen back="/account" actions={<TextLink href="/notifications" transition="push" className="self-center">{t("onPhone")}</TextLink>}>
      <BackRow href="/account" parent={you("label")} backLabel={ui("back")} />
      <PageTitle title={t("title")} lead={t("lead")} />
      <div className="px-edge pt-4 pb-8">
        {rows.length === 0 ? <Card><p className="text-body">{t("none")}</p></Card> : (
          <Card flush className="px-[18px] py-0.5">
            <KnitIn as="ul" className="fge-rows flex flex-col">{rows.map(({row}) => row)}</KnitIn>
          </Card>
        )}
      </div>
    </Screen>
  );
}
