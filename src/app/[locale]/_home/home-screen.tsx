import {getFormatter, getTranslations} from "next-intl/server";
import {Avatar, YouButton} from "@/components/ui/avatar";
import {ButtonLink} from "@/components/ui/button";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {Countdown} from "@/components/ui/countdown";
import {FairIsleBand} from "@/components/ui/knit/knit-svg";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {HomeTop} from "@/components/ui/page-header";
import {Pass} from "@/components/ui/pass";
import {Screen} from "@/components/ui/screen";
import type {Viewer} from "@/server/auth";
import {getListExchangeCard, listFamilyWishlists} from "@/server/lists";
import {getGettingList} from "@/server/lists/claims";
import {listNotifications} from "@/server/messages/inbox";
import {daysUntilInExchangeCalendar} from "@/server/messages/calendar";
import {getListRecipient} from "@/server/lists/my-person";
import {tabHrefs} from "../lists/tabs";
import {InstallCard} from "./install-card";
import {OfflineNotice} from "./offline-notice";

/**
 * Home: the season and you at the top, the stitched countdown, your person's pass first, then at most one
 * gold card for the one thing to do now, then quiet rows for what is yours.
 */
export async function HomeScreen({viewer}: {viewer: Viewer}) {
  const [members, exchange, getting, notices, t, lists, tabs, format] = await Promise.all([
    listFamilyWishlists(viewer), getListExchangeCard(viewer), getGettingList(viewer), listNotifications(viewer),
    getTranslations("homeScreen"), getTranslations("lists"), getTranslations("ui.tabs"), getFormatter(),
  ]);
  const recipientId = await getListRecipient(viewer, exchange?.id);
  const me = members.find(({id}) => id === viewer.personId);
  const listOwner = members.find(({id}) => id === viewer.actingAs);
  const recipient = members.find(({id}) => id === recipientId);
  const helped = members.filter(({helperId}) => helperId === viewer.personId);
  const now = new Date();
  const season = (exchange?.name ?? t("season", {year: now.getUTCFullYear()})).split(/\s+/);
  const days = exchange?.giftDay ? daysUntilInExchangeCalendar(exchange.giftDay, now) : null;
  const giftDay = exchange?.giftDay ? new Date(`${exchange.giftDay}T00:00:00Z`) : null;
  const line = giftDay && [
    format.dateTime(giftDay, {weekday: "long", month: "short", day: "numeric", timeZone: "UTC"}),
    exchange?.place,
  ].filter(Boolean).join(" · ");
  const money = (amount: string) => format.number(Number(amount), {style: "currency", currency: "USD"});
  const wrapped = getting.filter((item) => item.wrapped).length;
  const listEmpty = (listOwner?.itemCount ?? 0) === 0;
  const unread = notices.filter(({isRead}) => !isRead);

  return (
    <Screen tab="home" tabHrefs={tabHrefs(viewer)}>
      <h1 className="sr-only">{tabs("home")}</h1>
      <OfflineNotice message={t("offline")} back={t("backOnline")} />
      <HomeTop season={season} you={<YouButton href="/account" name={me?.name ?? "?"} label={t("you")}
        newLabel={t("somethingNew")} hasNew={unread.length > 0} />} />
      {days !== null && days >= 0 && (
        <>
          <div className="pt-2">
            <Countdown days={days} unit={t("daysTo", {count: days})} line={line || undefined} today={t("today")} knit />
          </div>
          <div className="pt-4"><FairIsleBand kind="zig" cell={4.6} /></div>
        </>
      )}
      <KnitIn variant="home" className="flex flex-col gap-card-gap px-edge pt-4 pb-6">
        {recipient && (
          <Pass name={recipient.name} lead={lists("passLead")} onlyYou={lists("onlyYou")} href={`/lists/${recipient.id}`}
            openLabel={lists("openPerson", {name: recipient.name})}
            budget={exchange?.budgetAmount ? money(exchange.budgetAmount) : undefined} />
        )}
        {listEmpty ? (
          <Card tone="next">
            <h2 className="text-card-title">{t("listTitle")}</h2>
            <p className="pt-0.5 text-body text-gold-ink">{t("listLead")}</p>
            <ButtonLink variant="card" icon="plus" href={`/lists/${viewer.actingAs}`} transition="tab" className="mt-3.5">
              {t("listButton")}
            </ButtonLink>
          </Card>
        ) : unread[0] ? (
          // a notice that needs you is the next step; the inbox reads it
          <AppLink href="/notifications" transition="push" className="fge-press block rounded-card">
            <Card tone="next" as="span" className="flex-row items-center gap-3.5 py-5 pr-4 pl-4">
              <IconDisc icon="message" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-card-title" lang={unread[0].language}>{unread[0].title}</span>
                <span className="text-body text-gold-ink">{t("tapToRead")}</span>
              </span>
              <Chevron />
            </Card>
          </AppLink>
        ) : (
          <InstallCard />
        )}
        {(getting.length > 0 || helped.length > 0) && (
          <Card flush className="px-[18px] py-1">
            <Rows as="ul">
              {getting.length > 0 && (
                <li>
                  <AppLink href="/lists/getting" transition="push" className="fge-press block rounded-[24px]">
                    <ListRow as="span" lead={<IconDisc icon="gift" className="bg-pine" />} title={lists("getting")}
                      sub={lists("gettingSummary", {count: getting.length, wrapped})} trail={<Chevron />} className="min-h-[76px]" />
                  </AppLink>
                </li>
              )}
              {helped.map((person) => (
                <li key={person.id}>
                  <AppLink href={`/lists/${person.id}`} transition="push" className="fge-press block rounded-[24px]">
                    <ListRow as="span" lead={<Avatar name={person.name} />} title={t("youHelp", {name: person.name})}
                      sub={lists("itemCount", {count: person.itemCount})} trail={<Chevron />} className="min-h-[76px]" />
                  </AppLink>
                </li>
              ))}
            </Rows>
          </Card>
        )}
      </KnitIn>
    </Screen>
  );
}
