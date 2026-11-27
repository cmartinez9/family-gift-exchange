import {getFormatter, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {ButtonLink} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Tick} from "@/components/ui/inputs";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {withFamily} from "@/server/db/client";
import {DrawError, organizerExchange} from "@/server/draw";
import {listFamilyWishlists} from "@/server/lists";
import {nudgedToday} from "@/server/messages";
import {saveRosterAndContinue} from "../../../actions";
import {DrawRecovery, drawPage, PersonStatusScreen} from "../../../components";
import {FormScreen} from "../../../form";
import {NudgeButton} from "../../../nudge-button";
import {AddNames} from "../../../../family/add-names";
import {RosterFields} from "../../../roster";
import {SetupSteps} from "../../../setup";

/**
 * Who's in. In setup (step 2) it is the roster: add names, tick who takes part. After the draw it is
 * who has a ready list, without ever hinting at who has whom. Someone signed up (or looked after) with
 * nothing on their list gets a Nudge: one plain notice a day that never says who has them.
 */
export default async function PeoplePage({params}: {params: Promise<{exchangeId: string}>}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const [t, ui, format] = await Promise.all([getTranslations("draw"), getTranslations("ui"), getFormatter()]);
  const state = await drawPage(organizerExchange(viewer, exchangeId));
  if (state instanceof DrawError) return <DrawRecovery error={state} manageId={exchangeId} />;
  const {id, version, name, listDeadline} = state.exchange;
  const hub = `/exchanges/${id}/manage`;
  if (state.exchange.status === "closed") {
    return <PersonStatusScreen status="closed" details={state.exchange} back={hub} backLabel={name} />;
  }

  if (!version) {
    return (
      <FormScreen action={saveRosterAndContinue.bind(null, id)} label={t("setup.nextHouses")} back={hub} top={<>
        <BackRow href={hub} parent={t("setup.steps.exchange")} backLabel={ui("back")} />
        <SetupSteps step={2} />
        <PageTitle title={t("setup.peopleTitle")} lead={t("setup.peopleLead")} />
        <div className="px-edge pt-6"><AddNames /></div>
      </>}>
        <Card className="py-2">
          <RosterFields people={state.people} legend={t("roster")} hideLegend you={{id: viewer.personId, label: t("setup.you")}} />
        </Card>
      </FormScreen>
    );
  }

  const [board, lists, nudged] = await Promise.all([
    withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date())),
    listFamilyWishlists(viewer).catch(() => []),
    nudgedToday(viewer, id),
  ]);
  const byId = new Map(lists.map((list) => [list.id, list]));
  const members = new Map((board?.members ?? []).map((member) => [member.id, member]));
  const names = new Map((board?.members ?? []).map(({id: personId, name: memberName}) => [personId, memberName]));
  const taking = state.people.filter(({participating}) => participating);
  const status = (personId: string) => {
    const list = byId.get(personId);
    const member = members.get(personId);
    const helper = member?.helperId ? names.get(member.helperId) : undefined;
    if (list?.ready) return helper ? t("season.filledBy", {name: helper}) : t("season.listReady");
    if (list?.itemCount) return t("season.listGrowing", {count: list.itemCount});
    if (member?.joinedAt || helper) return t("season.noList");
    return board?.sent.some((key) => key.personId === personId) ? t("season.keySent") : t("season.notStarted");
  };
  // the server checks the same things again: in the exchange, reachable, and nothing on the list
  const canNudge = (personId: string) => {
    const member = members.get(personId);
    return personId !== viewer.personId && !byId.get(personId)?.itemCount && Boolean(member?.joinedAt || member?.helperId);
  };
  const anyNudge = taking.some(({id: personId}) => canNudge(personId));
  return (
    <Screen back={hub} actions={<ButtonLink href="/family/group-chat" transition="push" icon="share">{t("season.remindChat")}</ButtonLink>}>
      <BackRow href={hub} parent={name} backLabel={ui("back")} />
      <PageTitle title={t("season.whosIn")} lead={listDeadline
        ? t("season.listsDue", {day: format.dateTime(new Date(`${listDeadline}T00:00:00Z`), {weekday: "long", month: "short", day: "numeric", timeZone: "UTC"})})
        : t("season.whosInLead")} />
      <KnitIn className="flex flex-col gap-3 px-edge pt-6 pb-6">
        <Card flush className="px-5 py-1">
          {/* at the largest text sizes the avatar steps aside and the tick or Nudge drops under the name */}
          <ul className="fge-rows @container flex flex-col">
            {taking.map(({id: personId, displayName}) => {
              const ready = Boolean(byId.get(personId)?.ready);
              const you = personId === viewer.personId;
              return (
                <li key={personId} className="flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2 py-2">
                  <Avatar name={displayName} size={44} className="@max-[16rem]:hidden" />
                  <span className="flex min-w-0 flex-1 basis-24 flex-col">
                    <span className="text-row-title break-words">{displayName}</span>
                    <span className="text-body text-muted-ink">{you ? `${t("setup.youCap")} · ${status(personId)}` : status(personId)}</span>
                  </span>
                  {canNudge(personId)
                    ? <NudgeButton exchangeId={id} personId={personId} name={displayName} nudged={nudged.includes(personId)} />
                    : <Tick done={ready} label={ready ? t("season.listReady") : t("season.listNotReady")} />}
                </li>
              );
            })}
          </ul>
        </Card>
        <p className="text-body">{anyNudge ? t("season.nudgeNote") : t("season.whosInNote")}</p>
      </KnitIn>
    </Screen>
  );
}
