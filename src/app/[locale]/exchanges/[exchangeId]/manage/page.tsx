import {getFormatter, getLocale, getTranslations} from "next-intl/server";
import {ErrorBlock} from "@/components/ui/blocks";
import {ButtonLink, TextLink} from "@/components/ui/button";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {Tick} from "@/components/ui/inputs";
import {Snowflake} from "@/components/ui/knit/knit-motif";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, PageTitle, SectionHeading} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {withFamily} from "@/server/db/client";
import {checkSealedDraw, DrawError, organizerExchange, redrawConfirmation} from "@/server/draw";
import {listFamilyWishlists} from "@/server/lists";
import {manage, openPreview, saveDetailsAndContinue} from "../../actions";
import {CloseSeason} from "../../close-season";
import {DetailsFields, DrawRecovery, drawPage, PersonStatusScreen} from "../../components";
import {Disclosure} from "../../disclosure";
import {DrawForm, FormScreen} from "../../form";
import {ParticipationRows} from "../../participation";
import {ConfirmField, SetupSteps} from "../../setup";
import {PersonSelect, RosterFields} from "../../roster";

type OrganizerState = Awaited<ReturnType<typeof organizerExchange>>;
type Viewer = Awaited<ReturnType<typeof requireViewer>>;

const validationRules = [
  "enoughPeople", "everyoneGives", "everyoneReceives", "noSelf", "noSwaps", "noHouseholdPairs",
  "noHelperPairs", "noKeepApartPairs", "rosterMatches", "sealMatches",
] as const;

async function Proof({viewer, id}: {viewer: Viewer; id: string}) {
  const t = await getTranslations("draw");
  const result = await drawPage(checkSealedDraw(viewer, id));
  if (result instanceof DrawError) {
    return (
      <div className="flex flex-col gap-2 px-edge pt-3">
        <ErrorBlock title={t(`errors.${result.code}`)} />
        <nav className="flex flex-col items-start" aria-label={t("checkDraw")}>
          <TextLink href="/account" className="text-snow-white">{t("account")}</TextLink>
          <TextLink href={`/exchanges/${id}/manage`} prefetch={false} className="text-snow-white">{t("backToManage")}</TextLink>
        </nav>
      </div>
    );
  }
  if (result.status === "pending" || result.status === "closed") return null;
  const valid = result.status === "checked" && result.valid;
  return (
    <section className="px-edge pt-3" aria-labelledby="draw-proof">
      <Card className="flex flex-col gap-2">
        <h2 id="draw-proof" className="text-card-title">{t(valid ? "verified" : "unverified")}</h2>
        {result.status === "checked" && (
          <>
            <Rows as="ul">
              {validationRules.map((key) => (
                <li key={key} className="flex min-h-12 items-center gap-3 py-1.5">
                  <Tick done={result[key]} size={28} />
                  <span className="text-body font-semibold">{t(result[key] ? "rulePassed" : "ruleFailed", {rule: t(key)})}</span>
                </li>
              ))}
            </Rows>
            {result.valid && <p className="text-body font-semibold">{t(result.oneLoop ? "oneLoop" : "multipleLoops")}</p>}
          </>
        )}
      </Card>
    </section>
  );
}

/** Running the exchange: who has a ready list, then the organizer's rooms, then the draw's own tools. */
async function Hub({state, viewer, check}: {state: OrganizerState; viewer: Viewer; check: boolean}) {
  const [t, ui, format, locale] = await Promise.all([getTranslations("draw"), getTranslations("ui"), getFormatter(), getLocale()]);
  const {id, status, version, seal, name} = state.exchange;
  const board = await withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date()));
  const lists = await listFamilyWishlists(viewer).catch(() => []);
  const ready = new Map(lists.map((list) => [list.id, list.ready]));
  const taking = state.people.filter(({participating}) => participating);
  const readyCount = taking.filter(({id: personId}) => ready.get(personId)).length;
  const houses = new Set((board?.members ?? []).map(({householdId}) => householdId).filter(Boolean)).size;
  const request = board?.requests[0];
  const requester = request && board?.members.find(({id: personId}) => personId === request.personId)?.name;
  const locked = status === "locked";
  const facts = [
    state.exchange.giftDay && format.dateTime(new Date(`${state.exchange.giftDay}T00:00:00Z`), {month: "short", day: "numeric", timeZone: "UTC"}),
    state.exchange.place,
    state.exchange.budgetAmount !== null && format.number(Number(state.exchange.budgetAmount), {style: "currency", currency: "USD", maximumFractionDigits: 0}),
  ].filter(Boolean).join(" · ");
  const rooms = [
    {href: `/exchanges/${id}/manage/people`, icon: "family" as const, title: t("season.whosIn"), sub: t("season.whosInHint")},
    {href: "/family/keys#requests", icon: "lock" as const, title: t("season.requests"),
      sub: requester ? t("season.requestFrom", {name: requester}) : t("season.noRequests"), badge: board?.requests.length || 0},
    {href: `/exchanges/${id}/manage/details`, icon: "calendar" as const, title: t("setup.exchangeRow"), sub: facts || t("setup.exchangeEditLead")},
    {href: "/family", icon: "home" as const, title: t("season.peopleAndHouses"),
      sub: t("season.peopleCount", {people: board?.members.length ?? 0, houses})},
  ];

  return (
    <Screen back="/">
      <BackRow href="/" parent={t("person.backHome")} backLabel={ui("back")}
        right={<AppLink href={`/exchanges/${id}`} prefetch={false} className="fge-press ml-auto inline-flex min-h-12 max-w-full items-center px-3 text-right text-body font-semibold text-snow-white underline underline-offset-4">{t("yourPerson")}</AppLink>} />
      <PageTitle title={name} lead={t("season.lead")} />
      {state.exchange.disputedRevealRepairedAt && <div className="px-edge pt-3"><Card><p role="status" className="text-body">{t("disputedRevealRepaired")}</p></Card></div>}

      <section aria-label={t("season.readyLists")} className="px-edge pt-6">
        {/* at the largest text size the snowflakes flow, as many to a line as their names allow */}
        <ul className="grid grid-cols-3 gap-x-2 gap-y-4 max-[299px]:flex max-[299px]:flex-wrap max-[299px]:justify-center max-[299px]:gap-x-5">
          {taking.map(({id: personId, displayName}) => {
            const lit = ready.get(personId);
            return (
              <li key={personId} className="flex flex-col items-center gap-1.5 text-center max-[299px]:max-w-full max-[299px]:shrink-0" data-ready={lit ? "true" : "false"}>
                <Snowflake cell={4.6} className={lit ? undefined : "opacity-40"} />
                <span className="max-w-full text-body font-bold break-words">{displayName}</span>
                <span className="sr-only">{lit ? t("season.listReady") : t("season.listNotReady")}</span>
              </li>
            );
          })}
        </ul>
        <p className="pt-4 text-center text-body font-bold">{t("season.litCaption", {ready: readyCount, total: taking.length})}</p>
      </section>

      <KnitIn className="flex flex-col gap-3 px-edge pt-5">
        <Card flush className="px-5 py-1">
          <Rows as="ul">
            {rooms.map((room) => (
              <li key={room.title}>
                <AppLink href={room.href} transition="push" prefetch={false} className="fge-press block">
                  <ListRow as="span" lead={<IconDisc icon={room.icon} />} title={room.title} sub={room.sub}
                    trail={room.badge ? <span className="flex size-8 items-center justify-center rounded-full bg-gold text-body-strong text-ink">
                      <span aria-hidden="true">{room.badge}</span><span className="sr-only">{t("season.requestCount", {count: room.badge})}</span>
                    </span> : <Chevron />} />
                </AppLink>
              </li>
            ))}
          </Rows>
        </Card>
      </KnitIn>

      {status === "closed" ? (
        <div className="px-edge pt-3"><Card><p className="text-body">{t("closed")}</p></Card></div>
      ) : (
        <section aria-labelledby="draw-tools" className="pb-10">
          <SectionHeading title={<span id="draw-tools">{t("season.drawTools")}</span>} />
          <div className="flex flex-col gap-3 px-edge">
            <Card className="flex flex-col gap-1">
              {seal && <p className="text-card-title">{t("seal", {code: seal})}</p>}
              <p className="text-body text-muted-ink">{t("seen", {seen: state.seenCount, total: state.participantCount})}</p>
              {locked && <p className="text-body text-muted-ink">{t("locked")}</p>}
              <ButtonLink href={`/exchanges/${id}/manage?check=1`} prefetch={false} variant="card" icon="check" className="mt-3">{t("checkDraw")}</ButtonLink>
            </Card>
            {check && <Proof id={id} viewer={viewer} />}
            <Disclosure summary={t("participation")} icon="family">
              <p className="text-body text-muted-ink">{t("season.participationHint")}</p>
              <ParticipationRows exchangeId={id} version={version}
                people={state.people.filter(({participating, available}) => participating || available)} />
            </Disclosure>
            {state.people.some(({available}) => available) && (
              <Disclosure summary={t("previewLabel")} icon="eye">
                <form action={openPreview.bind(null, id)} className="flex flex-col gap-3">
                  <PersonSelect label={t("personLabel")} people={state.people.filter(({available}) => available)} />
                  <button type="submit" className="fge-press inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded-pill bg-ink px-6 text-body-strong text-snow-white">
                    {t("previewButton")}
                  </button>
                </form>
              </Disclosure>
            )}
            <Disclosure summary={t(locked ? "forceRedraw" : "redraw")} icon="shuffle">
              <DrawForm action={manage.bind(null, id, {kind: "draw", expectedVersion: version, allowSelection: true})}
                label={t(locked ? "forceRedraw" : "confirmDraw")}>
                {locked && <ConfirmField help={t("forceHelp", {phrase: redrawConfirmation[locale]})} label={t("forceLabel")} />}
                <RosterFields key={id + version} people={state.people} legend={t("roster")} />
              </DrawForm>
            </Disclosure>
            <CloseSeason exchangeId={id} name={name} />
          </div>
        </section>
      )}
    </Screen>
  );
}

export default async function ManagePage({params, searchParams}: {
  params: Promise<{exchangeId: string}>;
  searchParams: Promise<{check?: string}>;
}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const {check} = await searchParams;
  const [t, ui] = await Promise.all([getTranslations("draw"), getTranslations("ui")]);
  const state = await drawPage(organizerExchange(viewer, exchangeId));
  if (state instanceof DrawError) return <DrawRecovery error={state} manageId={exchangeId} />;
  const {id, status, version} = state.exchange;

  // setup, step 1: the exchange
  if (!version && status !== "closed") {
    return (
      <FormScreen action={saveDetailsAndContinue.bind(null, id)} label={t("setup.nextPeople")} back="/exchanges" below={
        <CloseSeason exchangeId={id} name={state.exchange.name} />
      } top={<>
        <BackRow href="/exchanges" parent={t("title")} backLabel={ui("back")} />
        <SetupSteps step={1} />
        <PageTitle title={t("setup.exchangeTitle")} lead={t("setup.exchangeLead")} />
      </>}>
        <DetailsFields details={state.exchange} />
      </FormScreen>
    );
  }
  if (!version) return <PersonStatusScreen status="closed" details={state.exchange} />;
  return <Hub state={state} viewer={viewer} check={check === "1"} />;
}
