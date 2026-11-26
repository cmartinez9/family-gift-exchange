import {getLocale, getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {practiceMemberView, practiceSeason, redrawConfirmation} from "@/server/draw";
import {beginPractice, managePractice, type MemberContext} from "../actions";
import {drawPage, ExchangeFacts, MemberReveal, QuestionSection} from "../components";
import {DrawForm} from "../form";
import {control, heading, link, panel, screen, subheading} from "../styles";

export default async function PracticePage({searchParams}: {searchParams: Promise<{as?: string}>}) {
  const owner = await requireViewer();
  const {as} = await searchParams;
  const t = await getTranslations("draw");

  if (as) {
    const {status, questions} = await drawPage(practiceMemberView(owner, as));
    const context: MemberContext = {id: status.exchange.id, version: status.exchange.version, subject: as, practice: true};
    return (
      <main className={screen}>
        <Link className={link} href="/exchanges/practice" prefetch={false}>{t("practiceTitle")}</Link>
        <h1 className={heading}>{t("practiceViewing", {name: status.subjectName})}</h1>
        <MemberReveal state={status} context={context} />
        {status.status === "ready" && questions && questions.version === context.version &&
          <QuestionSection context={context} questions={questions} canAsk={status.seen} />}
        <section className={panel}>
          <h2 className={subheading}>{t("detailsTitle")}</h2>
          <ExchangeFacts details={status.exchange} />
        </section>
      </main>
    );
  }

  const practice = await drawPage(practiceSeason(owner));
  const locale = await getLocale();
  const active = practice?.exchange.status !== "closed";
  const locked = practice?.exchange.status === "locked";
  return (
    <main className={screen}>
      <Link className={link} href="/exchanges">{t("back")}</Link>
      <h1 className={heading}>{t("practiceTitle")}</h1>
      <p>{t("practiceIntro")}</p>
      {!practice || !active ? (
        <DrawForm action={beginPractice} label={t(practice ? "practiceAgain" : "practiceStart")} />
      ) : (
        <>
          {!practice.exchange.version ? (
            <DrawForm action={managePractice.bind(null, practice.exchange.id, {kind: "draw", expectedVersion: 0})} label={t("drawNames")} />
          ) : (
            <section className={panel}>
              {practice.exchange.seal && <p className={subheading}>{t("seal", {code: practice.exchange.seal})}</p>}
              <h2 className={subheading}>{t("practicePairs")}</h2>
              <ul className="list-disc space-y-1 pl-6">
                {practice.pairs.map(({giver, recipient}) => <li key={giver}>{t("practicePair", {giver, recipient})}</li>)}
              </ul>
              <details>
                <summary className={link}>{t(locked ? "forceRedraw" : "redraw")}</summary>
                <DrawForm action={managePractice.bind(null, practice.exchange.id, {
                  kind: "draw", expectedVersion: practice.exchange.version,
                })} label={t(locked ? "forceRedraw" : "confirmDraw")}>
                  {locked && (
                    <>
                      <p>{t("forceHelp", {phrase: redrawConfirmation[locale]})}</p>
                      <label className="block">{t("forceLabel")}
                        <input name="confirmation" className={control} required autoComplete="off" />
                      </label>
                    </>
                  )}
                </DrawForm>
              </details>
            </section>
          )}
          <section className={panel}>
            <h2 className={subheading}>{t("practiceViewAs")}</h2>
            <ul className="flex flex-wrap gap-x-4">
              {practice.people.filter(({participating}) => participating).map(({id, displayName}) => (
                <li key={id}><Link className={link} href={`/exchanges/practice?as=${id}`} prefetch={false}>{displayName}</Link></li>
              ))}
            </ul>
          </section>
          {practice.exchange.version > 0 && (
            <details className={panel}>
              <summary className={link}>{t("participation")}</summary>
              <ul className="space-y-3">
                {practice.people.map(({id, displayName, participating}) => (
                  <li key={id}>
                    <DrawForm action={managePractice.bind(null, practice.exchange.id, {
                      kind: "participation", personId: id, status: participating ? "out" : "in", expectedVersion: practice.exchange.version,
                    })} label={t(participating ? "dropout" : "join", {name: displayName})} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className={panel}>
            <summary className={link}>{t("close")}</summary>
            <DrawForm action={managePractice.bind(null, practice.exchange.id, {kind: "close"})} label={t("closeConfirm")}>
              <p>{t("closeHelp")}</p>
            </DrawForm>
          </details>
        </>
      )}
    </main>
  );
}
