import type {ReactNode} from "react";
import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {Button, ButtonLink, TextButton} from "@/components/ui/button";
import {HomeScreenHelp} from "@/components/notifications/home-screen-help";
import {Card, Chevron, ListRow, Rows} from "@/components/ui/card";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {BackRow} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {mySizes, youSummary} from "@/server/auth/account";
import {currentDeviceKind} from "@/server/auth/request";
import {account} from "@/server/auth/security";
import {ownRevealOpenings} from "@/server/draw";
import {withFamily} from "@/server/db/client";
import {getGettingList} from "@/server/lists/claims";
import {getUnreadCount, listNotifications} from "@/server/messages/inbox";
import {shoeLabel} from "../welcome/shoe-label";
import {reportSession, signOut, switchProfile} from "./actions";
import {noticeText} from "./notice-text";
import {ActForm, FaceIdRow, LanguageRow, RowDisc} from "./rows";
import {screenTitle} from "../sign-in/title";
import {activityDateFormat} from "../sign-in/styles";
import styles from "./rows.module.css";

function RowLink({href, icon, title, sub, trail}: {
  href: string; icon: Parameters<typeof RowDisc>[0]["icon"]; title: string; sub?: string; trail?: ReactNode;
}) {
  return (
    <li>
      <AppLink href={href} transition="push" className="fge-press block rounded-[20px]">
        <ListRow as="span" className={styles.row} lead={<RowDisc icon={icon} />} title={title} sub={sub} trail={trail ?? <Chevron />} />
      </AppLink>
    </li>
  );
}

export async function generateMetadata() {
  return screenTitle("you.label");
}

export default async function AccountPage({searchParams}: {searchParams: Promise<{reported?: string; face?: string}>}) {
  const viewer = await requireViewer();
  const t = await getTranslations("getIn.you");
  const auth = await getTranslations("auth");
  const ui = await getTranslations("ui");
  const lists = await getTranslations("lists");
  const draw = await getTranslations("draw");
  const format = await getFormatter();
  const locale = await getLocale() === "es" ? "es" : "en";
  const search = await searchParams;
  const now = new Date();
  const [{name, helpers, activity}, summary, getting, inbox, unread, openings] = await Promise.all([
    withFamily(viewer.familyId, (tx) => account(tx, viewer)),
    withFamily(viewer.familyId, (tx) => youSummary(tx, viewer, now)),
    getGettingList(viewer),
    listNotifications(viewer),
    getUnreadCount(viewer),
    ownRevealOpenings(viewer),
  ]);
  const notices = await getTranslations("getIn.notices");
  const actingFor = helpers.find(({id}) => id === viewer.actingAs);
  const profile = viewer.actingAs === viewer.personId ? summary
    : await withFamily(viewer.familyId, (tx) => mySizes(tx, viewer.familyId, viewer.actingAs));
  const device = auth(`device.${await currentDeviceKind()}` as Parameters<typeof auth>[0]);
  // the newest unread message leads; otherwise the newest of anything
  const message = inbox.find(({isRead}) => !isRead) ?? inbox[0];
  const event = activity[0];
  const latest = message && (!event || !message.isRead || message.createdAt >= event.at) ? message.title
    : event ? (await noticeText(event, viewer)).title : null;
  const wrapped = getting.filter(({wrapped: done}) => done).length;
  const sizes = [
    profile.sizes.tops && t("topsShort", {size: profile.sizes.tops === "XXL" ? "2XL" : profile.sizes.tops}),
    profile.sizes.shoes && t("shoesShort", {size: shoeLabel(profile.sizes.shoes)}),
  ].filter(Boolean).join(" · ");
  const noClothes = await getTranslations("getIn.sizes");

  return (
    <Screen back="/" actions={(
      <ActForm action={signOut.bind(null, false)} className="flex flex-col items-center">
        <TextButton type="submit">{t("signOut")}</TextButton>
      </ActForm>
    )}>
      <BackRow href="/" parent={t("home")} backLabel={ui("back")} />
      <div className="flex items-center gap-4 px-edge pt-4">
        <Avatar name={name} size={64} on="ground" />
        <div className="flex min-w-0 flex-col">
          <h1 className="text-title break-words">{name}</h1>
          {summary.familyName && <p className="text-body font-semibold">{summary.familyName}</p>}
        </div>
      </div>
      <KnitIn className={`${styles.settings} flex flex-col gap-3 px-edge pt-5 pb-2`}>
        {search.reported === "1" && <p role="status" className="text-body">{auth("feedback.reported")}</p>}
        {search.face === "1" && (
          <Card tone="next">
            <h2 className="text-card-title">{t("newPin")}</h2>
            <p className="pt-0.5 pb-3.5 text-body text-gold-ink">{t("newPinSub")}</p>
            <ButtonLink href="/account/pin" transition="push" variant="card" icon="lock">{t("newPinGo")}</ButtonLink>
          </Card>
        )}
        <Card flush className="px-[18px] py-0.5">
          <Rows as="ul">
            <RowLink href="/exchanges" icon="gift" title={draw("title")} />
            {actingFor && <RowLink href={`/lists/${viewer.actingAs}`} icon="list" title={lists("myList")} />}
            <RowLink href="/lists/getting" icon="gift" title={t("getting")}
              sub={wrapped ? t("gettingWrapped", {count: getting.length, wrapped}) : t("gettingSub", {count: getting.length})} />
            <RowLink href="/account/notices" icon="bell" title={t("notices")} sub={latest ?? t("noticesNone")}
              trail={unread > 0 ? (
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="size-3 rounded-full bg-gold" />
                  <span className="sr-only">{notices("unread", {count: unread})}</span>
                  <Chevron />
                </span>
              ) : undefined} />
            <RowLink href={`/lists/${viewer.actingAs}/profile`} icon="shirt" title={t("sizes")}
              sub={profile.noClothes ? noClothes("noClothes") : sizes || t("sizesNone")} />
          </Rows>
        </Card>
        <Card flush className="px-[18px] py-0.5">
          <Rows as="ul">
            <LanguageRow current={locale} />
            <FaceIdRow key={String(summary.faceId)} on={summary.faceId} device={device} className={styles.row} />
            <RowLink href="/account/phones" icon="phone" title={t("phones")} sub={t("phonesSub", {count: summary.devices})} />
            <RowLink href="/account/activity" icon="eye" title={t("activity")} sub={t("activitySub")} />
          </Rows>
        </Card>
        {(helpers.length > 0 || (viewer.isOrganizer && !actingFor)) && (
          <Card flush className="px-[18px] py-0.5">
            <Rows as="ul">
              {viewer.isOrganizer && !actingFor && <RowLink href="/family" icon="star" title={auth("manageFamily")} sub={t("manage")} />}
              {helpers.filter(({id}) => id !== viewer.actingAs).map(({id, name: helped}) => (
                <li key={id}>
                  <ActForm action={switchProfile.bind(null, id)}>
                    <button type="submit" className="fge-press block w-full cursor-pointer rounded-[20px] text-left">
                      <ListRow as="span" className={styles.row} lead={<Avatar name={helped} size={44} />} title={auth("helpAs", {name: helped})}
                        trail={<Chevron />} />
                    </button>
                  </ActForm>
                </li>
              ))}
            </Rows>
          </Card>
        )}
        <Card as="section" className="space-y-3">
          <h2 className="text-card-title">{auth("revealActivity")}</h2>
          {!openings.length && <p className="text-body">{auth("noRevealActivity")}</p>}
          <ul className="flex flex-col gap-4">
            {openings.map(({exchangeId, exchangeName, version, sessionId, openedAt, deviceKind, disputed}) => (
              <li key={`${exchangeId}.${version}.${sessionId}`} className="space-y-2 text-body">
                <p>{auth("revealOpened", {exchange: exchangeName, device: auth(`device.${deviceKind ?? "other"}` as Parameters<typeof auth>[0])})}</p>
                <time dateTime={openedAt.toISOString()}>{format.dateTime(openedAt, activityDateFormat)}</time>
                {disputed ? <p>{auth("alreadyReported")}</p> : (
                  <ActForm action={reportSession.bind(null, sessionId)}>
                    <Button type="submit" variant="outline">{auth("notMe")}</Button>
                  </ActForm>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card flush className="px-[18px] py-0.5">
          <HomeScreenHelp className="ml-0 text-ink" />
        </Card>
      </KnitIn>
    </Screen>
  );
}
