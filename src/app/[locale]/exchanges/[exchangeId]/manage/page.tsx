import {getLocale, getTranslations} from "next-intl/server";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {checkSealedDraw, DrawError, drawFeasibility, organizerExchange, redrawConfirmation} from "@/server/draw";
import {manage, openPreview} from "../../actions";
import {DetailsFields, drawPage} from "../../components";
import {DrawForm} from "../../form";
import {button, control, heading, link, panel, screen, subheading} from "../../styles";

type OrganizerState = Awaited<ReturnType<typeof organizerExchange>>;
type Roster = OrganizerState["people"];

function RosterFields({people, legend}: {people: Roster; legend: string}) {
  return (
    <fieldset className="space-y-1">
      <legend className="font-semibold">{legend}</legend>
      {people.map(({id, displayName, participating, available}) => (
        <label key={id} className="flex min-h-12 cursor-pointer items-center gap-3">
          <input name="people" value={id} type="checkbox" defaultChecked={participating && available}
            disabled={!available} className="size-6 accent-foreground" />
          <span>{displayName}</span>
        </label>
      ))}
    </fieldset>
  );
}

async function FeasibilityControl({state, viewer}: {
  state: OrganizerState;
  viewer: Awaited<ReturnType<typeof requireViewer>>;
}) {
  const t = await getTranslations("draw");
  const {id, status, version, seal} = state.exchange;
  if (status === "closed") return <p>{t("closed")}</p>;

  if (version) {
    const locale = await getLocale();
    const locked = status === "locked";
    return (
      <section className={panel} aria-label={t("checkDraw")}>
        {seal && <p className={subheading}>{t("seal", {code: seal})}</p>}
        <p>{t("seen", {seen: state.seenCount, total: state.participantCount})}</p>
        <Link className={button} href={`/exchanges/${id}/manage?check=1`} prefetch={false}>{t("checkDraw")}</Link>
        {locked && <p>{t("locked")}</p>}
        <details>
          <summary className={link}>{t(locked ? "forceRedraw" : "redraw")}</summary>
          <DrawForm action={manage.bind(null, id, {kind: "draw", expectedVersion: version, allowSelection: true})}
            label={t(locked ? "forceRedraw" : "confirmDraw")}>
            {locked && (
              <>
                <p>{t("forceHelp", {phrase: redrawConfirmation[locale]})}</p>
                <label className="block">{t("forceLabel")}
                  <input name="confirmation" className={control} required autoComplete="off" />
                </label>
              </>
            )}
            <RosterFields key={id + version} people={state.people} legend={t("roster")} />
          </DrawForm>
        </details>
      </section>
    );
  }

  let feasibility;
  try {
    feasibility = await drawFeasibility(viewer, id);
  } catch (error) {
    if (error instanceof DrawError) {
      return <section className={panel}><p>{t(`errors.${error.code}`)}</p><button className={button} disabled>{t("drawNames")}</button></section>;
    }
    throw error;
  }
  return (
    <section className={panel}>
      <p>{feasibility.blocker ? t(`blockers.${feasibility.blocker}`) : t("ready")}</p>
      {feasibility.possible && <p>{t("choiceCount", {count: feasibility.fewestChoices})}</p>}
      {feasibility.possible && feasibility.limitedChoices > 0 && <p>{t("choiceWarning", {count: feasibility.limitedChoices})}</p>}
      {feasibility.possible ? (
        <details>
          <summary className={`${button} w-fit list-none`}>{t("drawNames")}</summary>
          <div className="mt-3">
            <DrawForm action={manage.bind(null, id, {kind: "draw", expectedVersion: version})} label={t("confirmDraw")}>
              <p>{t("drawConfirmHelp")}</p>
            </DrawForm>
          </div>
        </details>
      ) : <button className={button} disabled>{t("drawNames")}</button>}
    </section>
  );
}

const validationRules = [
  "enoughPeople", "everyoneGives", "everyoneReceives", "noSelf", "noSwaps", "noHouseholdPairs",
  "noHelperPairs", "noKeepApartPairs", "rosterMatches", "sealMatches",
] as const;

async function Proof({viewer, id}: {viewer: Awaited<ReturnType<typeof requireViewer>>; id: string}) {
  const t = await getTranslations("draw");
  const result = await drawPage(checkSealedDraw(viewer, id));
  if (result.status === "pending" || result.status === "closed") return null;
  return (
    <section className={panel}>
      <h2 className={subheading}>{t(result.status === "checked" && result.valid ? "verified" : "unverified")}</h2>
      {result.status === "checked" && (
        <>
          <ul className="list-disc space-y-1 pl-6">
            {validationRules.map((key) => <li key={key}>{t(result[key] ? "rulePassed" : "ruleFailed", {rule: t(key)})}</li>)}
          </ul>
          {result.valid && <p>{t(result.oneLoop ? "oneLoop" : "multipleLoops")}</p>}
        </>
      )}
    </section>
  );
}

async function RosterControls({state}: {state: OrganizerState}) {
  const t = await getTranslations("draw");
  const {id, version} = state.exchange;
  const people = state.people;
  if (version) {
    return (
      <details className={panel}>
        <summary className={link}>{t("participation")}</summary>
        <ul className="space-y-3">
          {people.filter(({participating, available}) => participating || available).map((person) => (
            <li key={person.id}>
              <DrawForm action={manage.bind(null, id, {
                kind: "participation", personId: person.id, status: person.participating ? "out" : "in", expectedVersion: version,
              })} label={t(person.participating ? "dropout" : "join", {name: person.displayName})} />
            </li>
          ))}
        </ul>
      </details>
    );
  }

  const byId = new Map(people.map(({id, displayName}) => [id, displayName]));
  const visibleRules = state.rules.flatMap(({personA, personB}) => {
    const first = byId.get(personA);
    const second = byId.get(personB);
    return first && second ? [{personA, personB, first, second}] : [];
  });
  return (
    <>
      <details className={panel}>
        <summary className={link}>{t("roster")}</summary>
        <DrawForm action={manage.bind(null, id, {kind: "roster"})} label={t("saveRoster")}>
          <RosterFields people={people} legend={t("roster")} />
        </DrawForm>
        <Link className={link} href="/family">{t("households")}</Link>
      </details>
      {people.length > 1 && (
        <details className={panel}>
          <summary className={link}>{t("keepApart")}</summary>
          <DrawForm action={manage.bind(null, id, {kind: "ruleAdd"})} label={t("addRule")}>
            {(["first", "second"] as const).map((name) => (
              <label key={name} className="block">{t(name === "first" ? "firstPerson" : "secondPerson")}
                <select className={control} name={name} required defaultValue="">
                  <option value="" disabled>{t("personLabel")}</option>
                  {people.filter(({available}) => available).map(({id, displayName}) => (
                    <option key={id} value={id}>{displayName}</option>
                  ))}
                </select>
              </label>
            ))}
          </DrawForm>
          {visibleRules.length > 0 && (
            <ul className="mt-4 space-y-3">
              {visibleRules.map(({personA, personB, first, second}) => (
                <li key={personA + personB}>
                  <DrawForm action={manage.bind(null, id, {kind: "ruleRemove", first: personA, second: personB})}
                    label={t("removeRule", {first, second})} />
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </>
  );
}

export default async function ManagePage({params, searchParams}: {
  params: Promise<{exchangeId: string}>;
  searchParams: Promise<{check?: string}>;
}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const {check} = await searchParams;
  const t = await getTranslations("draw");
  const state = await drawPage(organizerExchange(viewer, exchangeId));
  const {id, status, name} = state.exchange;
  return (
    <main className={screen}>
      <Link className={link} href="/exchanges">{t("back")}</Link>
      <h1 className={heading}>{name}</h1>
      <Link className={link} href={`/exchanges/${id}`} prefetch={false}>{t("yourPerson")}</Link>
      <FeasibilityControl state={state} viewer={viewer} />
      {check === "1" && <Proof id={id} viewer={viewer} />}
      {status !== "closed" && (
        <>
          <details className={panel} open={status === "setup"}>
            <summary className={link}>{t("detailsTitle")}</summary>
            <DrawForm action={manage.bind(null, id, {kind: "edit"})} label={t("saveDetails")}>
              <DetailsFields details={state.exchange} />
            </DrawForm>
          </details>
          <RosterControls state={state} />
          <details className={panel}>
            <summary className={link}>{t("dryRun")}</summary>
            <DrawForm action={manage.bind(null, id, {kind: "dryRun"})} label={t("dryRun")}>
              <p>{t("dryHelp")}</p>
            </DrawForm>
          </details>
          {state.people.some(({available}) => available) && (
            <details className={panel}>
              <summary className={link}>{t("previewLabel")}</summary>
              <form action={openPreview.bind(null, id)} className="space-y-3">
                <label className="block">{t("personLabel")}
                  <select className={control} name="person" required defaultValue="">
                    <option disabled value="">{t("personLabel")}</option>
                    {state.people.filter(({available}) => available).map(({id, displayName}) => (
                      <option key={id} value={id}>{displayName}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={button}>{t("previewButton")}</button>
              </form>
            </details>
          )}
          <details className={panel}>
            <summary className={link}>{t("close")}</summary>
            <DrawForm action={manage.bind(null, id, {kind: "close"})} label={t("closeConfirm")}>
              <p>{t("closeHelp")}</p>
            </DrawForm>
          </details>
        </>
      )}
    </main>
  );
}
