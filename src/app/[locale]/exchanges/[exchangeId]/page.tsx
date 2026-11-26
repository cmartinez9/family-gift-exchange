import {getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {listOwnQuestions, memberDrawStatus} from "@/server/draw";
import {drawPage, ExchangeFacts, MemberReveal, QuestionSection} from "../components";
import {heading, link, panel, screen, subheading} from "../styles";

export default async function MemberExchangePage({params}: {params: Promise<{exchangeId: string}>}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const t = await getTranslations("draw");
  const state = await drawPage(memberDrawStatus(viewer, exchangeId));
  const context = {id: state.exchange.id, subject: viewer.actingAs, version: state.exchange.version};
  const questions = state.status === "ready" ? await drawPage(listOwnQuestions(viewer, exchangeId)) : null;

  return (
    <main className={screen}>
      <Link className={link} href="/exchanges">{t("back")}</Link>
      <h1 className={heading}>{state.exchange.name}</h1>
      {viewer.actingAs !== viewer.personId && <p>{t("helping", {name: state.subjectName})}</p>}
      <MemberReveal state={state} context={context} />
      {state.status === "ready" && questions && questions.version === context.version &&
        <QuestionSection context={context} questions={questions} canAsk={state.seen} />}
      <section className={panel}>
        <h2 className={subheading}>{t("detailsTitle")}</h2>
        <ExchangeFacts details={state.exchange} />
        {state.exchange.seal && <p>{t("seal", {code: state.exchange.seal})}</p>}
      </section>
      {viewer.isOrganizer && viewer.actingAs === viewer.personId &&
        <Link className={link} href={`/exchanges/${state.exchange.id}/manage`} prefetch={false}>{t("manage")}</Link>}
    </main>
  );
}
