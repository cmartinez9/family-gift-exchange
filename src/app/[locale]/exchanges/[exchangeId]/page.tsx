import {getTranslations} from "next-intl/server";
import {requireViewer} from "@/server/auth";
import {DrawError, listOwnQuestions, memberDrawStatus} from "@/server/draw";
import {AnswerScreen} from "../answer";
import {DrawRecovery, drawPage, FixedScreen, PersonStatusScreen} from "../components";
import {MemberPerson} from "../person";
import {SeasonWrap} from "../season-wrap";

export default async function MemberExchangePage({params, searchParams}: {
  params: Promise<{exchangeId: string}>;
  searchParams: Promise<{answer?: string; fixed?: string}>;
}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const {answer, fixed} = await searchParams;
  const t = await getTranslations("draw");
  const organizer = viewer.isOrganizer && viewer.actingAs === viewer.personId;
  const state = await drawPage(memberDrawStatus(viewer, exchangeId));
  if (state instanceof DrawError) return <DrawRecovery error={state} manageId={organizer ? exchangeId : undefined} />;
  if (state.status === "closed") return <SeasonWrap name={state.exchange.name} />;
  if (state.status !== "ready") return <PersonStatusScreen status={state.status} details={state.exchange} />;
  const context = {id: state.exchange.id, subject: viewer.actingAs, version: state.exchange.version};
  const questions = await drawPage(listOwnQuestions(viewer, exchangeId));
  if (questions instanceof DrawError) return <DrawRecovery error={questions} manageId={organizer ? exchangeId : undefined} />;
  const current = questions.version === context.version;
  const self = `/exchanges/${exchangeId}`;

  if (answer) {
    return <AnswerScreen key={`${context.subject}/${context.version}`} context={context} back={self} backLabel={t("yourPerson")}
      questions={current ? questions.incoming : []} />;
  }
  if (fixed && !state.seen) return <FixedScreen href={self} />;
  return (
    <MemberPerson key={`${context.subject}/${context.version}`} context={context} seen={state.seen} canReport={state.canReport}
      canAsk={state.seen} budget={state.exchange.budgetAmount === null ? null : Number(state.exchange.budgetAmount)}
      outgoing={current && state.seen ? questions.outgoing : []}
      incoming={current ? questions.incoming.filter(({answered}) => !answered).map(({text}) => text) : []}
      back="/" backLabel={t("person.backHome")} answerHref={`${self}?answer=1`}
      helping={viewer.actingAs !== viewer.personId ? {label: t("helping", {name: state.subjectName}), href: "/account", action: t("person.helpingDone")} : undefined} />
  );
}
