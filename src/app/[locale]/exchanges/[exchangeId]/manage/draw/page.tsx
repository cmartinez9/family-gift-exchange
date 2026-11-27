import {getTranslations} from "next-intl/server";
import {ButtonLink, TextLink} from "@/components/ui/button";
import {Card, IconDisc, Rows, stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {Tick} from "@/components/ui/inputs";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {readiness} from "@/server/auth/families";
import {withFamily} from "@/server/db/client";
import {DrawError, drawFeasibility, organizerExchange} from "@/server/draw";
import {manage} from "../../../actions";
import {DrawStep} from "../../../ceremony";
import {Bullet, DrawRecovery, drawPage, PersonStatusScreen} from "../../../components";
import {Disclosure} from "../../../disclosure";
import {DrawForm} from "../../../form";
import {SetupSteps} from "../../../setup";

type Blocker = "tooFew" | "householdTooLarge" | "tooFewChoices" | "conflictingRules";

export default async function DrawPage({params}: {params: Promise<{exchangeId: string}>}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const t = await getTranslations("draw");
  const state = await drawPage(organizerExchange(viewer, exchangeId));
  if (state instanceof DrawError) return <DrawRecovery error={state} manageId={exchangeId} />;
  const {id, version, seal, status} = state.exchange;
  const hub = `/exchanges/${id}/manage`;
  if (status === "closed") {
    return <PersonStatusScreen status="closed" details={state.exchange} back={hub} backLabel={t("season.running")} />;
  }
  const taking = state.people.filter(({participating}) => participating);

  const sealed = (
    <Screen back={hub} actions={<ButtonLink href="/family/keys" transition="push" icon="arrow">{t("setup.nextKeys")}</ButtonLink>}>
      <PageTitle title={t("setup.sealedTitle")} lead={t("setup.sealedLead")} className="pt-10" />
      <div className="flex justify-center pt-7"><KnitMotif name="lock" cell={12} /></div>
      <KnitIn className="flex flex-col gap-3 px-edge pt-7 pb-6">
        <Card className="flex flex-col gap-0.5 py-[18px]">
          {seal && <p className="text-card-title">{t("seal", {code: seal})}</p>}
          <p className="text-body text-muted-ink">{t("setup.sealHint")}</p>
          <TextLink href={`${hub}?check=1`} prefetch={false} className="self-start px-0">{t("checkDraw")}</TextLink>
        </Card>
        {taking.some(({id: personId}) => personId === viewer.personId) && (
          <Card className="flex flex-col gap-1 py-4">
            <Bullet icon="gift">{t("setup.ownPerson")}</Bullet>
            <TextLink href={`/exchanges/${id}`} prefetch={false} className="self-start px-0">{t("yourPerson")}</TextLink>
          </Card>
        )}
      </KnitIn>
    </Screen>
  );

  if (version) {
    return <DrawStep exchangeId={id} version={version} drawn canDraw={false} names={[]} check={null} sealed={sealed} />;
  }

  let feasibility: {possible: boolean; blocker: Blocker | null; fewestChoices: number; limitedChoices: number} | null = null;
  let failure: string | null = null;
  try {
    feasibility = await drawFeasibility(viewer, id);
  } catch (error) {
    if (!(error instanceof DrawError)) throw error;
    failure = t(`errors.${error.code}`);
  }
  const board = await withFamily(viewer.familyId, (tx) => readiness(tx, viewer, new Date()));
  const takingIds = new Set(taking.map(({id: personId}) => personId));
  const members = (board?.members ?? []).filter(({id: personId}) => takingIds.has(personId));
  const houses = new Set(members.map(({householdId}) => householdId).filter(Boolean)).size;
  const helped = members.filter(({helperId}) => helperId).map(({name}) => name);
  const fix = feasibility?.blocker === "tooFew"
    ? {href: `${hub}/people`, label: t("setup.fixPeople")}
    : {href: "/family", label: t("setup.fixHouses")};

  const check = (
    <>
      <SetupSteps step={4} />
      {feasibility?.possible ? (
        <>
          <PageTitle title={t("ready")} lead={t("setup.readyLead")} />
          <KnitIn className="flex flex-col gap-3 px-edge pt-6 pb-6">
            <Card className="flex flex-col gap-2">
              <div className={cn("flex items-center gap-3.5 pb-1", stackRow)}>
                <IconDisc icon="family" />
                <div className={cn("flex min-w-0 flex-col", stackWords)}>
                  <p className="text-card-title">{t("setup.peopleInHouses", {people: taking.length, houses})}</p>
                  <p className="text-body text-muted-ink">{t("setup.listsGrow")}</p>
                </div>
              </div>
              <Rows as="ul">
                {[
                  t("setup.checkEveryone"),
                  t("choiceCount", {count: feasibility.fewestChoices}),
                  ...(houses ? [t("setup.checkHouses")] : []),
                  ...(helped.length ? [t("setup.checkHelpers", {names: helped.join(", ")})] : []),
                ].map((line) => (
                  <li key={line} className="flex min-h-12 items-center gap-3 py-1.5">
                    <Tick done size={28} />
                    <span className="text-body-strong">{line}</span>
                  </li>
                ))}
              </Rows>
              {feasibility.limitedChoices > 0 && (
                <p className="flex items-start gap-2.5 pt-1 text-body text-muted-ink"><Icon name="alert" size={22} className="mt-0.5 shrink-0" />
                  {t("choiceWarning", {count: feasibility.limitedChoices})}</p>
              )}
            </Card>
            <Disclosure summary={t("dryRun")} icon="check">
              <DrawForm action={manage.bind(null, id, {kind: "dryRun"})} label={t("dryRun")} feedback="inline">
                <p className="text-body text-muted-ink">{t("dryHelp")}</p>
              </DrawForm>
            </Disclosure>
          </KnitIn>
        </>
      ) : (
        <>
          <PageTitle title={t("setup.notReadyTitle")} lead={t("setup.notReadyLead")} />
          <KnitIn className="flex flex-col gap-3 px-edge pt-6 pb-6">
            <Card tone="next" className="flex flex-col gap-1">
              <p className="flex items-start gap-3 text-card-title" role="status">
                <Icon name="alert" size={24} strokeWidth={2.4} className="mt-0.5 shrink-0" />
                {failure ?? t(`blockers.${feasibility?.blocker ?? "conflictingRules"}`)}
              </p>
              {feasibility?.blocker && <p className="pb-3 pl-9 text-body text-gold-ink">{t(`setup.blockerHint.${feasibility.blocker}`)}</p>}
              <ButtonLink href={fix.href} transition="push" variant="card">{fix.label}</ButtonLink>
            </Card>
          </KnitIn>
        </>
      )}
    </>
  );

  return (
    <DrawStep exchangeId={id} version={version} drawn={false} canDraw={Boolean(feasibility?.possible)}
      names={taking.map(({displayName}) => displayName)} check={check} sealed={sealed} />
  );
}
