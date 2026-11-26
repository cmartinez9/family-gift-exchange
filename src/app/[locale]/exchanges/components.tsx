import {getFormatter, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {DrawError, type ExchangeDetails, type listOwnQuestions, type memberDrawStatus} from "@/server/draw";
import {memberAction, reveal, type MemberContext} from "./actions";
import {DrawForm} from "./form";
import {Reveal} from "./reveal";
import {control, link, panel, subheading} from "./styles";

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

export async function DrawRecovery({error, manageId}: {error: DrawError; manageId?: string}) {
  const t = await getTranslations("draw");
  return (
    <section className={panel}>
      <p role="alert">{t(`errors.${error.code}`)}</p>
      <nav className="flex flex-wrap gap-x-4">
        <Link className={link} href="/account">{t("account")}</Link>
        {manageId && <Link className={link} href={`/exchanges/${manageId}/manage`} prefetch={false}>{t("backToManage")}</Link>}
        <Link className={link} href="/exchanges">{t("back")}</Link>
      </nav>
    </section>
  );
}

export async function DetailsFields({details}: {details?: ExchangeDetails}) {
  const t = await getTranslations("draw");
  return (
    <>
      <label className="block">{t("name")}
        <input className={control} name="name" required maxLength={100} defaultValue={details?.name ?? ""} />
      </label>
      <label className="block">{t("giftDay")}
        <input className={control} name="giftDay" type="date" defaultValue={details?.giftDay ?? ""} />
      </label>
      <label className="block">{t("giftTime")}
        <input className={control} name="giftTime" type="time" defaultValue={details?.giftTime?.slice(0, 5) ?? ""} />
      </label>
      <label className="block">{t("place")}
        <input className={control} name="place" maxLength={200} defaultValue={details?.place ?? ""} />
      </label>
      <label className="block">{t("budget")}
        <input className={control} name="budgetAmount" inputMode="decimal" type="number"
          min="0" step="0.01" max="99999999.99" defaultValue={details?.budgetAmount ?? ""} />
      </label>
      <label className="block">{t("listsDue")}
        <input className={control} name="listDeadline" type="date" defaultValue={details?.listDeadline ?? ""} />
      </label>
      <label className="block">{t("drawDay")}
        <input className={control} name="drawDay" type="date" defaultValue={details?.drawDay ?? ""} />
      </label>
    </>
  );
}

export async function ExchangeFacts({details}: {details: ExchangeDetails}) {
  const t = await getTranslations("draw");
  const format = await getFormatter();
  const day = (date: string) => (
    <time dateTime={date}>{format.dateTime(new Date(`${date}T00:00:00Z`), {dateStyle: "long", timeZone: "UTC"})}</time>
  );
  const clock = details.giftTime?.slice(0, 5);
  return (
    <dl className="space-y-2">
      {details.giftDay && <div><dt className="font-semibold">{t("giftDay")}</dt><dd>{day(details.giftDay)}</dd></div>}
      {clock && <div><dt className="font-semibold">{t("giftTime")}</dt><dd>
        <time dateTime={clock}>{format.dateTime(new Date(`2000-01-01T${clock}:00Z`), {timeStyle: "short", timeZone: "UTC"})}</time>
      </dd></div>}
      {details.place && <div><dt className="font-semibold">{t("place")}</dt><dd>{details.place}</dd></div>}
      <div><dt className="font-semibold">{t("budgetDisplay")}</dt><dd>{details.budgetAmount === null
        ? t("noBudget") : format.number(Number(details.budgetAmount), {style: "currency", currency: "USD"})}</dd></div>
      {details.listDeadline && <div><dt className="font-semibold">{t("listsDue")}</dt><dd>{day(details.listDeadline)}</dd></div>}
      {details.drawDay && <div><dt className="font-semibold">{t("drawDay")}</dt><dd>{day(details.drawDay)}</dd></div>}
    </dl>
  );
}

type MemberState = Awaited<ReturnType<typeof memberDrawStatus>>;
type Questions = Awaited<ReturnType<typeof listOwnQuestions>>;

export async function MemberReveal({context, state}: {context: MemberContext; state: MemberState}) {
  const t = await getTranslations("draw");
  return (
    <section className={panel} aria-labelledby="your-person">
      <h2 id="your-person" className={subheading}>{t("yourPerson")}</h2>
      {state.status === "ready" ? (
        <>
          <Reveal key={`${context.subject}/${context.version}`} action={reveal.bind(null, context)} practice={context.practice} />
          {state.canReport && (
            <details>
              <summary className={link}>{t("report")}</summary>
              <DrawForm action={memberAction.bind(null, context, {kind: "report"})} label={t("reportButton")}>
                <p>{t("reportHelp")}</p>
              </DrawForm>
            </details>
          )}
        </>
      ) : <p>{t(state.status)}</p>}
    </section>
  );
}

export async function QuestionSection({context, questions, canAsk}: {
  context: MemberContext; questions: Questions; canAsk: boolean;
}) {
  const t = await getTranslations("draw");
  return (
    <section className={panel} aria-labelledby="exchange-questions">
      <h2 id="exchange-questions" className={subheading}>{t("questions")}</h2>
      <div className="space-y-3">
        <h3 className="font-semibold">{t("incoming")}</h3>
        {questions.incoming.length === 0 ? <p>{t("noIncoming")}</p> : (
          <ul className="space-y-4">
            {questions.incoming.map(({id, text, answered}) => (
              <li key={id} className="space-y-2 break-words">
                <p className="whitespace-pre-wrap">{text}</p>
                {answered ? <p>{t("answered")}</p> : (
                  <DrawForm action={memberAction.bind(null, context, {kind: "answer", questionId: id})}
                    label={t("answerButton")}>
                    <label className="block">{t("answerLabel")}
                      <textarea className={control} name="text" rows={2} required maxLength={500} />
                    </label>
                  </DrawForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canAsk && (
        <div className="space-y-3">
          <h3 className="font-semibold">{t("askTitle")}</h3>
          <DrawForm action={memberAction.bind(null, context, {kind: "ask"})} label={t("askButton")}>
            <label className="block">{t("askLabel")}
              <textarea className={control} name="text" rows={2} required maxLength={500} />
            </label>
          </DrawForm>
          {questions.outgoing.length > 0 && (
            <ul className="space-y-3">
              {questions.outgoing.map(({id, text, answer}) => (
                <li key={id} className="break-words">
                  <p className="whitespace-pre-wrap font-semibold">{text}</p>
                  <p className="whitespace-pre-wrap">{answer ?? t("answerPending")}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
