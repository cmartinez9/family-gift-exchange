import {getLocale, getTranslations} from "next-intl/server";
import {Avatar} from "@/components/ui/avatar";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {ModeBanner, modeActionClass} from "@/components/ui/mode-banner";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {AppLink} from "@/components/ui/navigation";
import {PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {DrawError, practiceMemberView, practiceSeason, redrawConfirmation} from "@/server/draw";
import {beginPractice, managePractice, type MemberContext} from "../actions";
import {AnswerScreen} from "../answer";
import {DrawRecovery, drawPage, FixedScreen, PersonStatusScreen} from "../components";
import {Disclosure} from "../disclosure";
import {DrawForm} from "../form";
import {MemberPerson} from "../person";
import {ConfirmField} from "../setup";

const PRACTICE = "/exchanges/practice";

export default async function PracticePage({searchParams}: {searchParams: Promise<{as?: string; answer?: string; fixed?: string}>}) {
  const owner = await requireViewer();
  const {as, answer, fixed} = await searchParams;
  const t = await getTranslations("draw");

  if (as) {
    const result = await drawPage(practiceMemberView(owner, as));
    if (result instanceof DrawError) return <DrawRecovery error={result} />;
    const {status, questions} = result;
    if (status.status !== "ready") return <PersonStatusScreen status={status.status} />;
    const context: MemberContext = {id: status.exchange.id, version: status.exchange.version, subject: as, practice: true};
    const self = `${PRACTICE}?as=${encodeURIComponent(as)}`;
    const current = questions && questions.version === context.version ? questions : null;
    if (answer) {
      return <AnswerScreen key={`${as}/${context.version}`} context={context} back={self} backLabel={status.subjectName}
        questions={current?.incoming ?? []} />;
    }
    if (fixed && !status.seen) return <FixedScreen href={self} />;
    return (
      <MemberPerson key={`${as}/${context.version}`} context={context} seen={status.seen} canReport={status.canReport} canAsk={status.seen}
        budget={status.exchange.budgetAmount === null ? null : Number(status.exchange.budgetAmount)}
        outgoing={current && status.seen ? current.outgoing : []}
        incoming={current ? current.incoming.filter(({answered}) => !answered).map(({text}) => text) : []}
        back={PRACTICE} backLabel={t("practiceTitle")} answerHref={`${self}&answer=1`}
        helping={{label: t("practiceViewing", {name: status.subjectName}), href: PRACTICE, action: t("setup.stop")}} />
    );
  }

  const practice = await drawPage(practiceSeason(owner));
  if (practice instanceof DrawError) return <DrawRecovery error={practice} />;
  const locale = await getLocale();
  const active = practice?.exchange.status !== "closed";
  const locked = practice?.exchange.status === "locked";
  const drawn = Boolean(practice?.exchange.version);
  const taking = practice?.people.filter(({participating}) => participating) ?? [];
  return (
    <Screen back="/exchanges">
      <ModeBanner icon="alert" label={t("setup.mode")}
        action={<AppLink href="/exchanges" transition="back" className={modeActionClass}>{t("setup.leave")}</AppLink>}>
        {t("setup.practiceBanner")}
      </ModeBanner>
      <PageTitle title={t("practiceTitle")} lead={t("practiceIntro")} />
      <KnitIn className="flex flex-col gap-3 px-edge pt-6 pb-8">
        {!practice || !active ? (
          <Card tone="next" className="flex flex-col gap-1">
            <h2 className="text-card-title">{t("setup.practiceStartTitle")}</h2>
            <p className="pb-3 text-body text-gold-ink">{t("setup.practiceStartHint")}</p>
            <DrawForm action={beginPractice} label={t(practice ? "practiceAgain" : "practiceStart")} icon="family" />
          </Card>
        ) : !drawn ? (
          <Card tone="next" className="flex flex-col gap-1">
            <h2 className="text-card-title">{t("setup.practiceReady", {count: taking.length})}</h2>
            <p className="pb-3 text-body text-gold-ink">{t("setup.practiceReadyHint")}</p>
            <DrawForm action={managePractice.bind(null, practice.exchange.id, {kind: "draw", expectedVersion: 0})}
              label={t("drawNames")} icon="shuffle" />
          </Card>
        ) : (
          <Card className="flex flex-col gap-2">
            <h2 className="text-card-title">{t("practicePairs")}</h2>
            {practice.exchange.seal && <p className="text-body text-muted-ink">{t("seal", {code: practice.exchange.seal})}</p>}
            <Rows as="ul">
              {practice.pairs.map(({giver, recipient}) => (
                <li key={giver} className="flex min-h-12 items-center py-2 text-body font-semibold">{t("practicePair", {giver, recipient})}</li>
              ))}
            </Rows>
          </Card>
        )}
        {practice && active && taking.length > 0 && (
          <Card flush className="px-5 pt-4 pb-1">
            <div className="flex items-center gap-3.5 pb-2">
              <IconDisc icon="eye" />
              <div className="flex min-w-0 flex-col">
                <h2 className="text-card-title">{t("practiceViewAs")}</h2>
                <p className="text-body text-muted-ink">{t("setup.practiceViewAsHint")}</p>
              </div>
            </div>
            <Rows as="ul">
              {taking.map(({id, displayName}) => (
                <li key={id}>
                  <AppLink href={`${PRACTICE}?as=${id}`} transition="push" prefetch={false} className="fge-press block">
                    <ListRow as="span" lead={<Avatar name={displayName} size={44} />} title={displayName} trail={<Chevron />} />
                  </AppLink>
                </li>
              ))}
            </Rows>
          </Card>
        )}
        {practice && active && drawn && (
          <>
            <Disclosure summary={t(locked ? "forceRedraw" : "redraw")} icon="shuffle">
              <DrawForm action={managePractice.bind(null, practice.exchange.id, {kind: "draw", expectedVersion: practice.exchange.version})}
                label={t(locked ? "forceRedraw" : "confirmDraw")}>
                {locked && <ConfirmField help={t("forceHelp", {phrase: redrawConfirmation[locale]})} label={t("forceLabel")} />}
              </DrawForm>
            </Disclosure>
            <Disclosure summary={t("participation")} icon="family">
              <ul className="flex flex-col gap-2">
                {practice.people.map(({id, displayName, participating}) => (
                  <li key={id}>
                    <DrawForm variant="soft" action={managePractice.bind(null, practice.exchange.id, {
                      kind: "participation", personId: id, status: participating ? "out" : "in", expectedVersion: practice.exchange.version,
                    })} label={t(participating ? "dropout" : "join", {name: displayName})} />
                  </li>
                ))}
              </ul>
            </Disclosure>
          </>
        )}
        {practice && active && (
          <Disclosure summary={t("close")} icon="close" danger>
            <p className="text-body text-muted-ink">{t("closeHelp")}</p>
            <DrawForm action={managePractice.bind(null, practice.exchange.id, {kind: "close"})} label={t("closeConfirm")} variant="danger" />
          </Disclosure>
        )}
      </KnitIn>
    </Screen>
  );
}
