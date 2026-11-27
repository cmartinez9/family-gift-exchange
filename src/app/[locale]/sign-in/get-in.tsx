"use client";

import {useActionState, useEffect, useRef, useState, useTransition, type ReactNode} from "react";
import {startAuthentication, startRegistration} from "@simplewebauthn/browser";
import {useFormatter, useTranslations} from "next-intl";
import {Link, useRouter} from "@/i18n/navigation";
import {Avatar} from "@/components/ui/avatar";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton, TextLink} from "@/components/ui/button";
import {Card, stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon, type IconName} from "@/components/ui/icon";
import {TextField} from "@/components/ui/inputs";
import {FairIsleBand} from "@/components/ui/knit/knit-svg";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {canStitch, textBitmap} from "@/components/ui/knit/knit";
import {STITCH_CELL, StitchedText} from "@/components/ui/knit/stitched-text";
import {haptic} from "@/components/ui/motion/haptic";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {Sheet} from "@/components/ui/sheet";
import {StepBar} from "@/components/ui/step-bar";
import {
  beginFaceId, enterPin, finishFaceIdEnrollment, finishFaceIdSignIn, forgotPin, openFamily, previewCode, reportUsedKey, useKey,
  type AuthResult, type CodeResult,
} from "./actions";
import {EnterPin, GroundNote, MakePin, pinForm} from "./pin-screens";
import {tryAuthAction} from "./client-action";
import {HelpingKey} from "./helping";
import {AskForHelp, OrganizerRecovery, useHelpContact} from "./ask-for-help";
import {useUsedKeyOpening} from "./used-key-opening";
import type {KeyOpening} from "@/server/auth/access";

/** The widest a stitched word may be: the 350px column. */
const COLUMN = 350;

/** The cell size that keeps a stitched word inside the column, never larger than the design's. */
export function fitCell(text: string, cell: number) {
  if (!canStitch(text)) return cell;
  const columns = textBitmap(text)[0]?.length ?? 1;
  return Math.min(cell, Math.floor((COLUMN / columns) * 10) / 10);
}

/** At the largest text size the column is narrower than the fitted cell allows: the stitches scale down with it. */
const GREETING_FIT = "block max-[299px]:max-w-full max-[299px]:[&>svg]:h-auto max-[299px]:[&>svg]:max-w-full";

/** A greeting knitted in, one stitch at a time: "HI" over "ROSA!". `heading` makes it the screen's title. */
export function Greeting({top, bottom, heading = false}: {top: string; bottom: string; heading?: boolean}) {
  const Tag = heading ? "h1" : "div";
  return (
    <Tag className="flex flex-col items-center gap-4 pt-6 max-[299px]:px-edge" data-greeting="">
      <StitchedText as="span" className={GREETING_FIT} text={top} cell={fitCell(top, STITCH_CELL.greeting)} knit stepMs={7} />
      <span className="sr-only"> </span>
      <StitchedText as="span" className={GREETING_FIT} text={bottom} cell={fitCell(bottom, STITCH_CELL.greeting)} knit stepMs={5} delayMs={180} />
    </Tag>
  );
}

/** Onboarding's knitted step bar: Sign in, Your person, Your sizes, Your list. */
export function WelcomeSteps({step, done = false, waitingStep, allDone = true}: {
  step: number; done?: boolean; waitingStep?: number; allDone?: boolean;
}) {
  const t = useTranslations("getIn.steps");
  const names = [t("signIn"), t("person"), t("sizes"), t("list")];
  return (
    <StepBar id="welcome" step={step} total={4} done={done} waitingStep={waitingStep}
      progress={done ? (allDone ? t("allDone", {total: 4}) : t("doneForNow")) : t("progress", {step, total: 4})}
      name={names[step - 1]} />
  );
}

/** One line with an icon inside a card: what is safe, what happens next. */
export function Bullet({icon, children, tone = "pine"}: {icon: IconName; children: ReactNode; tone?: "pine" | "ink"}) {
  return (
    <li className="flex items-start gap-3 text-body">
      <Icon name={icon} size={24} strokeWidth={2.3} className={cn("mt-px", tone === "pine" ? "text-pine" : "text-ink")} />
      <span>{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Face ID
// ---------------------------------------------------------------------------------------------

/** Face ID setup (`enroll`) or sign-in, with its pending and failed states. The Face ID switch on You uses setup too. */
export function useFaceId(enroll: boolean, onDone: () => void, onFail?: () => void, opening?: KeyOpening) {
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  function begin() {
    setFailed(false);
    start(async () => {
      try {
        if (enroll) {
          const options = await beginFaceId(true);
          if (!options || !("user" in options)) throw new Error();
          if (!await finishFaceIdEnrollment(await startRegistration({optionsJSON: options}))) throw new Error();
        } else {
          const options = await beginFaceId(false);
          if (!options || "user" in options) throw new Error();
          if (!await finishFaceIdSignIn(await startAuthentication({optionsJSON: options}), opening)) throw new Error();
        }
        haptic("success");
        onDone();
      } catch {
        setFailed(true);
        onFail?.();
      }
    });
  }
  return {failed, pending, begin};
}

/**
 * Welcome back (10.1): the phone's own Face ID panel, as a button. From the home-screen icon it asks by
 * itself, the way banking apps do; in a browser tab it waits for a tap.
 */
export function FaceIdTile({next = "/account?face=1"}: {next?: string}) {
  const t = useTranslations("getIn.back");
  const auth = useTranslations("auth");
  const router = useRouter();
  const {failed, pending, begin} = useFaceId(false, () => router.replace(next));
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !window.matchMedia("(display-mode: standalone)").matches || !window.PublicKeyCredential) return;
    asked.current = true;
    begin();
  });
  return (
    <div className="flex flex-col items-center gap-3 pt-10">
      <button type="button" onClick={begin} disabled={pending} aria-label={auth("signInFaceId")}
        className="fge-press flex size-[168px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[36px] bg-ink/55 text-snow-white">
        <Icon name="faceid" size={64} strokeWidth={1.6} />
        <span className="text-tab font-semibold">{t("faceTile")}</span>
      </button>
      {failed && <p role="alert" className="px-edge text-center text-body font-semibold">{auth("faceSignInFailed")}</p>}
    </div>
  );
}

/** "Use Face ID instead": the same sign-in, as a text link. */
export function FaceIdLink({label, next = "/account?face=1", opening}: {label: string; next?: string; opening?: KeyOpening}) {
  const auth = useTranslations("auth");
  const router = useRouter();
  const {failed, pending, begin} = useFaceId(false, () => router.replace(next), undefined, opening);
  return (
    <div className="flex flex-col items-center">
      <TextButton onClick={begin} disabled={pending}>{label}</TextButton>
      {failed && <p role="alert" className="text-center text-body font-semibold">{auth("faceSignInFailed")}</p>}
    </div>
  );
}

/** Use Face ID next time? (1.6): the gold card at the bottom of the screen. */
export function FaceIdOffer({next, steps, help}: {next: string; steps: boolean; help: ReactNode}) {
  const t = useTranslations("getIn.face");
  const auth = useTranslations("auth");
  const router = useRouter();
  const {failed, pending, begin} = useFaceId(true, () => router.replace(next));
  return (
    <Screen actions={help}>
      {steps && <WelcomeSteps step={1} />}
      <div aria-hidden="true" className="flex flex-1 items-center justify-center py-8">
        <StitchedFlake />
      </div>
      <div className="px-edge pb-[34px]">
        <Card tone="next" className="px-6 pt-[26px] pb-3">
          <span aria-hidden="true" className="flex size-20 items-center justify-center rounded-full bg-ink text-snow-white">
            <Icon name="faceid" size={44} strokeWidth={1.8} />
          </span>
          <h1 className="pt-[18px] text-title">{t("title")}</h1>
          <p className="pt-2.5 text-lead">{t("lead")}</p>
          <div className="flex flex-col items-center gap-1 pt-[22px]">
            <Button variant="card" icon="faceid" onClick={begin} disabled={pending}>{t("yes")}</Button>
            {failed && <p role="alert" className="pt-2 text-body font-semibold">{auth("faceUnavailable")}</p>}
            <TextLink href={next}>{auth("notNow")}</TextLink>
          </div>
        </Card>
      </div>
    </Screen>
  );
}

/** The snowflake, knitted large on the ground above the Face ID card. */
function StitchedFlake() {
  return <KnitMotif name="flake" cell={12} colors={{"#": "var(--color-yarn-white)"}} knit stepMs={9} />;
}

// ---------------------------------------------------------------------------------------------
// The key: 1.2 to 1.5, and 10.5 when it was already opened
// ---------------------------------------------------------------------------------------------

type KeyView = NonNullable<CodeResult["key"]>;

/**
 * Opening your own key: "HI ROSA! Is this your phone?", then a PIN made in two tries.
 * `otherLanguage` switches the whole flow to the other language without losing the key.
 */
export function KeyWelcome({familyId, value, typed, entry, sender, organizer, otherLanguage}: {
  familyId: string; value: string; typed: boolean; entry: KeyView; sender: string | null; organizer: string;
  otherLanguage?: {href: string; locale: "en" | "es"};
}) {
  const t = useTranslations("getIn.hello");
  const [phase, setPhase] = useState<"hello" | "helper" | "pin">("hello");
  const [used, setUsed] = useState<AuthResult | null>(null);
  const [openingId] = useState(() => entry.openingId ?? crypto.randomUUID());
  const help = <AskForHelp organizer={organizer} asker={{familyId, personId: entry.personId}} />;

  // A cookie refresh can mark this key used before the action returns. Keep this opening's identity.
  const usedAt = used?.usedAt ?? entry.usedAt;
  if (usedAt) return <KeyAlreadyOpened familyId={familyId} value={value} typed={typed}
    entry={{...entry, usedAt, available: false, openingId}} organizer={organizer} noticeQueued={used?.noticeQueued} />;

  if (phase === "pin") {
    const save = useKey.bind(null, familyId, value, typed, entry.preview ?? null, openingId);
    return (
      <Screen>
        <MakePin top={<WelcomeSteps step={1} />} save={async (pin) => {
          const result = await save({}, pinForm(pin));
          if (result.error === "usedKey") setUsed(result);
          return result;
        }} footer={help} />
      </Screen>
    );
  }

  if (phase === "helper") {
    return (
      <Screen actions={help}>
        <WelcomeSteps step={1} />
        <div className="px-edge pt-8 pb-6">
          <HelpingKey name={entry.name} typed={typed} onHandOver={() => setPhase("pin")} onBack={() => setPhase("hello")} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen actions={<>
      <Button onClick={() => {
        haptic("light");
        setPhase("pin");
      }}>{t("yes")}</Button>
      <Button variant="outline" onClick={() => setPhase("helper")}>{t("helping", {name: entry.name})}</Button>
      <div className="flex flex-wrap items-start justify-center gap-x-1">
        {otherLanguage && (
          <Link href={otherLanguage.href} locale={otherLanguage.locale} lang={otherLanguage.locale}
            className="inline-flex min-h-12 items-center justify-center px-3 text-body font-semibold underline underline-offset-4">
            {t("otherLanguage")}
          </Link>
        )}
        {help}
      </div>
    </>}>
      <WelcomeSteps step={1} />
      <Greeting top={t("hi")} bottom={t("name", {name: entry.name})} />
      <div className="pt-[22px]"><FairIsleBand kind="trees" cell={8.5} /></div>
      <PageTitle title={t("title")} lead={sender ? t("lead", {sender}) : t("leadAnon")} className="pt-5" />
    </Screen>
  );
}

/** Preserve the opening identity across PIN retries and Face ID recovery to avoid duplicate notices. */
export function KeyAlreadyOpened({familyId, value, typed, entry, organizer, noticeQueued}: {
  familyId: string; value: string; typed: boolean; entry: KeyView; organizer: string; noticeQueued?: boolean;
}) {
  const t = useTranslations("getIn.used");
  const enter = useTranslations("getIn.enter");
  const forgot = useTranslations("getIn.forgot");
  const feedback = useTranslations("auth.feedback");
  const ui = useTranslations("ui");
  const [locked, setLocked] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AuthResult>({});
  const [resetRequested, setResetRequested] = useState(false);
  const [keyReported, setKeyReported] = useState(false);
  const [pending, start] = useTransition();
  const [openingId] = useState(() => entry.openingId ?? crypto.randomUUID());
  const confirmed = useUsedKeyOpening({link: typed ? undefined : `${familyId}~${value}`, openingId, queued: noticeQueued});
  const recipient = useHelpContact(organizer)(entry.personId);
  const helper = recipient || organizer;
  const recovery = recipient === null || result.error === "organizerRecovery";

  if (locked !== null) return <Locked minutes={locked} name={entry.name} familyId={familyId} personId={entry.personId} organizer={organizer}
    onRetry={() => setLocked(null)} opening={{value, typed, openingId}} />;

  return (
    <Screen>
      <EnterPin title={t("title")} lead={t("lead", {name: entry.name})} organizer={organizer} onLocked={setLocked} suspended={open}
        submit={(data) => enterPin(familyId, entry.personId, {}, data, {value, typed, openingId})}
        note={result.success
          ? <div role="status" className="px-edge"><Card className="text-body">{feedback(result.success as Parameters<typeof feedback>[0])}</Card></div>
          : confirmed ? <GroundNote icon="bell">{t("told", {name: entry.name})}</GroundNote> : null}
        left={<TextButton className="px-1 text-snow-white" onClick={() => setOpen(true)}>{enter("forgot")}</TextButton>}
        footer={<AskForHelp organizer={organizer} asker={{familyId, personId: entry.personId}} />} />
      <Sheet open={open} onClose={() => setOpen(false)} title={t("options")} closeLabel={ui("close")}>
        {recovery ? <OrganizerRecovery /> : <>
          <Button variant="card" disabled={pending || resetRequested} onClick={() => start(async () => {
            const response = await tryAuthAction(() => forgotPin(familyId, entry.personId));
            setResult(response);
            if (response.success) {
              setResetRequested(true);
              setOpen(false);
            }
          })}>{forgot("ask", {organizer: helper})}</Button>
          <p className="text-body text-muted-ink">{t("askSub", {organizer: helper})}</p>
        </>}
        <Button variant="soft" disabled={pending || keyReported} onClick={() => start(async () => {
          const response = await tryAuthAction(() => reportUsedKey(familyId, value, typed));
          setResult(response);
          if (response.success) {
            setKeyReported(true);
            setOpen(false);
          }
        })}>{t("never")}</Button>
        <p className="text-body text-muted-ink">{t("neverSub", {organizer})}</p>
        {result.error && result.error !== "organizerRecovery" && <ErrorBlock title={feedback(result.error as Parameters<typeof feedback>[0])} />}
      </Sheet>
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// Coming back: 10.2 to 10.4
// ---------------------------------------------------------------------------------------------

/** Enter your PIN (10.2), with "Forgot?" (10.3) and the rest after five tries (10.4). */
export function SignInWithPin({familyId, personId, name, organizer, backHref}: {
  familyId: string; personId: string; name: string; organizer: string; backHref: string;
}) {
  const t = useTranslations("getIn.enter");
  const back = useTranslations("getIn.back");
  const [view, setView] = useState<{kind: "pin"} | {kind: "forgot"} | {kind: "locked"; minutes: number}>({kind: "pin"});

  if (view.kind === "locked") {
    return <Locked minutes={view.minutes} name={name} familyId={familyId} personId={personId} organizer={organizer}
      onRetry={() => setView({kind: "pin"})} />;
  }
  if (view.kind === "forgot") {
    return <Forgot familyId={familyId} personId={personId} organizer={organizer} doneHref={backHref}
      onKeep={() => setView({kind: "pin"})} />;
  }
  return (
    <Screen back={backHref}>
      <BackRow href={backHref} parent={back("notMe", {name})} />
      <EnterPin title={t("title")} lead={t("lead", {name})} organizer={organizer}
        onLocked={(minutes) => setView({kind: "locked", minutes})}
        submit={(data) => enterPin(familyId, personId, {}, data)}
        left={<TextButton className="px-1 text-snow-white" onClick={() => setView({kind: "forgot"})}>{t("forgot")}</TextButton>}
        footer={<AskForHelp organizer={organizer} asker={{familyId, personId}} />} />
    </Screen>
  );
}

/** The asked card: who was asked, when, and what happens next. */
function AskedCard({organizer, at}: {organizer: string; at: Date}) {
  const t = useTranslations("getIn.forgot");
  const format = useFormatter();
  return (
    <Card role="status" className="px-5 py-[18px]">
      <div className={cn("flex items-center gap-3.5", stackRow)}>
        <Avatar name={organizer} size={52} />
        <div className={cn("flex min-w-0 flex-col", stackWords)}>
          <p className="text-card-title">{t("asked", {organizer})}</p>
          <p className="text-body text-muted-ink">{t("when", {time: format.dateTime(at, {hour: "numeric", minute: "2-digit"})})}</p>
        </div>
      </div>
      <p className="pt-3.5 text-body">{t("body", {organizer})}</p>
    </Card>
  );
}

/** Forgot your PIN? (10.3): one tap asks the organizer for a new key. */
function Forgot({familyId, personId, organizer, doneHref, onKeep}: {
  familyId: string; personId: string; organizer: string; doneHref: string; onKeep: () => void;
}) {
  const t = useTranslations("getIn.forgot");
  const feedback = useTranslations("auth.feedback");
  const router = useRouter();
  const [result, setResult] = useState<AuthResult & {at?: Date}>({});
  const [pending, start] = useTransition();
  const recipient = useHelpContact(organizer)(personId);
  const helper = recipient || organizer;
  const asked = Boolean(result.success);
  if (recipient === null || result.error === "organizerRecovery") {
    return (
      <Screen actions={<TextButton className="self-center" onClick={onKeep}>{t("keep")}</TextButton>}>
        <PageTitle title={t("title")} className="pt-10" />
        <div className="px-edge pt-6"><OrganizerRecovery /></div>
      </Screen>
    );
  }
  return (
    <Screen actions={asked
      ? <Button onClick={() => router.replace(doneHref)}>{t("done")}</Button>
      : <>
        <Button disabled={pending} onClick={() => start(async () => {
          const response = await tryAuthAction(() => forgotPin(familyId, personId));
          if (response.success) haptic("success");
          setResult({...response, at: new Date()});
        })}>{t("ask", {organizer: helper})}</Button>
        <TextButton className="self-center" onClick={onKeep}>{t("keep")}</TextButton>
      </>}>
      <PageTitle title={t("title")} lead={t("lead", {organizer: helper})} className="pt-10" />
      <div className="flex flex-col gap-[18px] px-edge pt-6">
        {asked && result.at && <div className="fge-drop"><AskedCard organizer={helper} at={result.at} /></div>}
        {result.error && <ErrorBlock title={feedback(result.error as Parameters<typeof feedback>[0])} />}
        <GroundNote icon="lock">{t("only", {organizer: helper})}</GroundNote>
      </div>
    </Screen>
  );
}

/** Let's take a break (10.4): the minutes stitched, what is safe, and the ways forward. */
function Locked({minutes, name, familyId, personId, organizer, onRetry, opening}: {
  minutes: number; name: string; familyId: string; personId: string; organizer: string; onRetry: () => void;
  opening?: KeyOpening;
}) {
  const t = useTranslations("getIn.locked");
  const forgot = useTranslations("getIn.forgot");
  const feedback = useTranslations("auth.feedback");
  const [result, setResult] = useState<AuthResult & {at?: Date}>({});
  const [pending, start] = useTransition();
  const [until] = useState(() => Date.now() + minutes * 60_000);
  const [remaining, setRemaining] = useState(minutes);
  const recipient = useHelpContact(organizer)(personId);
  const helper = recipient || organizer;
  const recovery = recipient === null || result.error === "organizerRecovery";
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 60_000)));
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [until]);
  return (
    <Screen actions={<>
      {remaining === 0 && <Button disabled={pending} onClick={onRetry}>{t("retry")}</Button>}
      {!recovery && !result.success && (
        <Button variant={remaining === 0 ? "outline" : "ground"} disabled={pending} onClick={() => start(async () => {
          const response = await tryAuthAction(() => forgotPin(familyId, personId));
          if (response.success) haptic("success");
          setResult({...response, at: new Date()});
        })}>{t("ask", {organizer: helper})}</Button>
      )}
      <FaceIdLink label={t("face")} opening={opening} />
    </>}>
      {remaining > 0 ? <div className="flex flex-col items-center gap-3 pt-[26px] text-snow-white" role="img"
        aria-label={`${t("tryAgainIn")} ${remaining} ${t("minutes", {count: remaining})}`}>
        <p aria-hidden="true" className="text-section">{t("tryAgainIn")}</p>
        <StitchedText as="p" text={String(remaining)} cell={12} />
        <p aria-hidden="true" className="text-section">{t("minutes", {count: remaining})}</p>
      </div> : <p role="status" className="px-edge pt-[26px] text-center text-section">{t("ready")}</p>}
      <PageTitle title={t("title")} lead={t("lead", {name})} className="pt-[22px]" />
      <div className="flex flex-col gap-3 px-edge pt-[18px]">
        {recovery && <OrganizerRecovery />}
        {result.success && result.at
          ? <div className="fge-drop"><AskedCard organizer={helper} at={result.at} /></div>
          : (
            <Card className="px-[18px] py-4">
              <ul className="flex flex-col gap-3">
                <Bullet icon="lock">{t("safe")}</Bullet>
                <Bullet icon="bell">{t("notice")}</Bullet>
              </ul>
            </Card>
          )}
        {result.error && result.error !== "organizerRecovery" && <ErrorBlock title={feedback(result.error as Parameters<typeof feedback>[0])} />}
        {result.success && <p className="sr-only">{forgot("asked", {organizer: helper})}</p>}
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// A printed card: the 6-character code
// ---------------------------------------------------------------------------------------------

/** Type your key code: a short form that opens the same welcome as the link. */
export function CodeEntry({familyId, backHref, sender, organizer, names}: {
  familyId: string; backHref: string; sender: string | null; organizer: string; names: Array<{id: string; name: string}>;
}) {
  const t = useTranslations("getIn.code");
  const auth = useTranslations("auth");
  const feedback = useTranslations("auth.feedback");
  const find = useTranslations("getIn.who");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<CodeResult & {code?: string}>({});
  const version = useRef(0);
  const [pending, start] = useTransition();

  if (result.key && result.code) {
    return result.key.usedAt
      ? <KeyAlreadyOpened familyId={familyId} value={result.code} typed entry={result.key} organizer={organizer} noticeQueued={result.noticeQueued} />
      : <KeyWelcome familyId={familyId} value={result.code} typed entry={result.key} sender={sender} organizer={organizer} />;
  }
  return (
    <Screen back={backHref} actions={<AskForHelp organizer={organizer} asker={{familyId, names}} />}>
      <BackRow href={backHref} parent={find("title")} />
      <PageTitle title={t("title")} lead={t("lead")} />
      <form className="flex flex-col gap-3 px-edge pt-6" onSubmit={(event) => {
        event.preventDefault();
        const submitted = code;
        const request = ++version.current;
        start(async () => {
          const response = await tryAuthAction(() => previewCode(familyId, submitted));
          if (request === version.current) setResult({...response, code: submitted});
        });
      }}>
        <Card className="flex flex-col gap-3 p-[18px]">
          <TextField label={auth("keyCode")} name="code" value={code} maxLength={6} minLength={6} autoCapitalize="characters"
            autoComplete="off" spellCheck={false} required surface="white" className="[&_input]:tracking-[0.2em] [&_input]:uppercase"
            onChange={(event) => {
              version.current++;
              setResult({});
              setCode(event.target.value.toUpperCase().trim());
            }} />
          <Button type="submit" variant="card" disabled={pending}>{auth("checkCode")}</Button>
        </Card>
        {result.error && <ErrorBlock title={feedback(result.error as Parameters<typeof feedback>[0])} />}
      </form>
    </Screen>
  );
}

// ---------------------------------------------------------------------------------------------
// A browser that doesn't know the family yet
// ---------------------------------------------------------------------------------------------

/** Find your family: paste the family address or your own key link. */
export function FindFamily() {
  const t = useTranslations("getIn.find");
  const who = useTranslations("getIn.who");
  const auth = useTranslations("auth");
  const feedback = useTranslations("auth.feedback");
  const [state, submit, pending] = useActionState(openFamily, {});
  return (
    <Screen actions={<TextLink href="/start" className="self-center">{who("start")}</TextLink>}>
      <PageTitle title={t("title")} lead={t("lead")} className="pt-10" />
      <form action={submit} className="flex flex-col gap-3 px-edge pt-6">
        <Card className="flex flex-col gap-3 p-[18px]">
          <TextField label={auth("familyAddress")} name="address" type="text" autoCapitalize="none" inputMode="url"
            maxLength={400} required surface="white" />
          <Button type="submit" variant="card" disabled={pending}>{t("button")}</Button>
        </Card>
        {state.error && <ErrorBlock title={feedback(state.error as Parameters<typeof feedback>[0])} />}
      </form>
    </Screen>
  );
}
