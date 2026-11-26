import {getFormatter, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import type {ReactNode} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {ButtonLink, TextLink} from "@/components/ui/button";
import {Card, Rows} from "@/components/ui/card";
import {Icon, type IconName} from "@/components/ui/icon";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {DrawError, type ExchangeDetails} from "@/server/draw";

export async function drawPage<T>(result: Promise<T>) {
  try {
    return await result;
  } catch (error) {
    if (error instanceof DrawError) {
      if (error.code === "forbidden" || error.code === "notFound") notFound();
      if (error.code === "repairImpossible" || error.code === "checkTimedOut") return error;
    }
    throw error;
  }
}

/** A draw page that cannot open: the gold card names the problem, and the ways out are links. */
export async function DrawRecovery({error, manageId}: {error: DrawError; manageId?: string}) {
  const t = await getTranslations("draw");
  return (
    <Screen>
      <PageTitle title={t("title")} className="pt-8" />
      <div className="flex flex-col gap-3 px-edge pt-6">
        <ErrorBlock title={t(`errors.${error.code}`)} />
        <nav className="flex flex-col items-start" aria-label={t("title")}>
          <TextLink href="/account" className="text-snow-white">{t("account")}</TextLink>
          {manageId && <TextLink href={`/exchanges/${manageId}/manage`} prefetch={false} className="text-snow-white">{t("backToManage")}</TextLink>}
          <TextLink href="/exchanges" className="text-snow-white">{t("back")}</TextLink>
        </nav>
      </div>
    </Screen>
  );
}

/** Your person before there is one to open: names not drawn, not taking part, or closed. */
export async function PersonStatusScreen({status, details, back = "/", backLabel, banner}: {
  status: "waiting" | "notParticipating" | "closed"; details?: ExchangeDetails;
  back?: string; backLabel?: string; banner?: ReactNode;
}) {
  const t = await getTranslations("draw");
  return (
    <Screen back={back}>
      {banner}
      <BackRow href={back} parent={backLabel ?? t("person.backHome")} backLabel={(await getTranslations("ui"))("back")} />
      <PageTitle title={t("yourPerson")} />
      <div className="flex flex-col items-center gap-6 px-edge pt-8">
        <KnitMotif name="gift" cell={8} colors={{"#": "rgba(255,248,239,.5)", o: "rgba(237,180,62,.8)"}} />
        <Card className="w-full"><p className="text-card-title">{t(status)}</p></Card>
        {details && <div className="w-full pb-6"><ExchangeFacts details={details} /></div>}
      </div>
    </Screen>
  );
}

/** After "Something wrong?": the loop was re-knit quietly, and the new person waits to be opened. */
export async function FixedScreen({href}: {href: string}) {
  const t = await getTranslations("draw");
  return (
    <Screen actions={<ButtonLink href={href} icon="gift" replace>{t("person.fixedOpen")}</ButtonLink>}>
      <div className="flex justify-center pt-14">
        <KnitMotif name="gift" cell={9.5} />
      </div>
      <PageTitle title={t("person.fixedTitle")} lead={t("person.fixedLead")} className="pt-8" />
      <div className="px-edge pt-6">
        <Card className="flex flex-col gap-3 py-4">
          <Bullet icon="eye">{t("person.fixedNobody")}</Bullet>
          <Bullet icon="lock">{t("person.fixedOthers")}</Bullet>
        </Card>
      </div>
    </Screen>
  );
}

/** A line with a leading pine icon inside a card. */
export function Bullet({icon, children}: {icon: IconName; children: ReactNode}) {
  return (
    <p className="flex items-start gap-3 text-body font-semibold">
      <Icon name={icon} size={22} strokeWidth={2.3} className="mt-0.5 text-pine" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const FIELD = "w-full min-w-0 rounded-[14px] bg-transparent py-1 text-body-strong text-ink placeholder:font-semibold placeholder:text-muted-ink "
  + "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink";

function DetailRow({icon, label, htmlFor, children}: {icon: IconName; label: string; htmlFor: string; children: ReactNode}) {
  return (
    <div className="flex min-h-[72px] items-center gap-3.5 py-2">
      <Icon name={icon} size={22} strokeWidth={2.3} className="text-pine" />
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={htmlFor} className="text-body text-muted-ink">{label}</label>
        {children}
      </div>
      <Icon name="chevron" size={22} className="text-muted-ink" />
    </div>
  );
}

/**
 * The exchange (setup step 1): the name on a track, then gift day, where, budget and lists ready by as
 * rows. There is no draw-date field: names are drawn in setup, before the keys go out.
 */
export async function DetailsFields({details}: {details?: ExchangeDetails}) {
  const t = await getTranslations("draw");
  return (
    <Card className="flex flex-col gap-1 pb-3">
      <label htmlFor="exchange-name" className="text-body font-bold text-muted-ink">{t("setup.nameShort")}</label>
      <input id="exchange-name" aria-label={t("name")} className="mt-1.5 mb-2 h-14 w-full rounded-pill bg-card-track px-5 text-lead font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink"
        name="name" required maxLength={100} defaultValue={details?.name ?? ""} />
      <Rows>
        <DetailRow icon="calendar" label={t("giftDay")} htmlFor="exchange-gift-day">
          <span className="flex flex-col">
            <input id="exchange-gift-day" className={FIELD} name="giftDay" type="date" defaultValue={details?.giftDay ?? ""} />
            <input aria-label={t("giftTime")} className={FIELD} name="giftTime" type="time"
              defaultValue={details?.giftTime?.slice(0, 5) ?? ""} />
          </span>
        </DetailRow>
        <DetailRow icon="pin" label={t("setup.where")} htmlFor="exchange-place">
          <input id="exchange-place" aria-label={t("place")} className={FIELD} name="place" maxLength={200}
            placeholder={t("setup.wherePlaceholder")} defaultValue={details?.place ?? ""} />
        </DetailRow>
        <DetailRow icon="tag" label={t("setup.budgetShort")} htmlFor="exchange-budget">
          <span className="flex items-center gap-1 text-body-strong">$
            <input id="exchange-budget" aria-label={t("budget")} className={FIELD} name="budgetAmount" inputMode="decimal" type="number"
              min="0" step="0.01" max="99999999.99" placeholder={t("setup.noBudget")} defaultValue={details?.budgetAmount ?? ""} />
          </span>
        </DetailRow>
        <DetailRow icon="list" label={t("setup.listsReadyBy")} htmlFor="exchange-lists">
          <input id="exchange-lists" aria-label={t("listsDue")} className={FIELD} name="listDeadline" type="date"
            defaultValue={details?.listDeadline ?? ""} />
        </DetailRow>
      </Rows>
      <input type="hidden" name="drawDay" value={details?.drawDay ?? ""} />
    </Card>
  );
}

/** The exchange at a glance: gift day, place and budget as rows on a card. */
export async function ExchangeFacts({details}: {details: ExchangeDetails}) {
  const t = await getTranslations("draw");
  const format = await getFormatter();
  const day = (date: string) => (
    <time dateTime={date}>{format.dateTime(new Date(`${date}T00:00:00Z`), {dateStyle: "full", timeZone: "UTC"})}</time>
  );
  const clock = details.giftTime?.slice(0, 5);
  const rows: Array<{icon: IconName; label: string; value: ReactNode}> = [];
  if (details.giftDay) rows.push({icon: "calendar", label: t("giftDay"), value: <>{day(details.giftDay)}{clock && <> · <time dateTime={clock}>
    {format.dateTime(new Date(`2000-01-01T${clock}:00Z`), {timeStyle: "short", timeZone: "UTC"})}</time></>}</>});
  if (details.place) rows.push({icon: "pin", label: t("place"), value: details.place});
  rows.push({icon: "tag", label: t("budgetDisplay"), value: details.budgetAmount === null
    ? t("noBudget") : format.number(Number(details.budgetAmount), {style: "currency", currency: "USD"})});
  if (details.listDeadline) rows.push({icon: "list", label: t("setup.listsReadyBy"), value: day(details.listDeadline)});
  return (
    <Card flush className="px-5 py-1">
      <Rows as="ul">
        {rows.map(({icon, label, value}) => (
          <li key={label} className="flex min-h-16 items-center gap-3.5 py-2">
            <Icon name={icon} size={22} strokeWidth={2.3} className="text-pine" />
            <div className="flex min-w-0 flex-col">
              <span className="text-body text-muted-ink">{label}</span>
              <span className="text-body-strong break-words">{value}</span>
            </div>
          </li>
        ))}
      </Rows>
    </Card>
  );
}

