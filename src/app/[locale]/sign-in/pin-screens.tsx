"use client";

import {useCallback, useEffect, useRef, useState, useTransition, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import {ErrorBlock} from "@/components/ui/blocks";
import {stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon, type IconName} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import {prefersReducedMotion} from "@/components/ui/motion/reduced-motion";
import {PageTitle} from "@/components/ui/page-header";
import {PinPad} from "@/components/ui/pin";
import {pinProblem} from "@/lib/pin-policy";
import type {AuthResult} from "./actions";
import {tryAuthAction} from "./client-action";

type Problem = {title: string; sub?: string};

/** A white line with an icon on the ground: the hint under the PIN slots. */
export function GroundNote({icon, children}: {icon: IconName; children: ReactNode}) {
  return (
    <p className={cn("flex items-start justify-center gap-2.5 px-edge text-body font-semibold text-snow-white", stackRow)}>
      <Icon name={icon} size={20} strokeWidth={2.3} className="mt-0.5" />
      <span className={stackWords}>{children}</span>
    </p>
  );
}

/** The gold card that names a refusal, dropping in under the slots. */
function Refusal({problem, version}: {problem: Problem; version: number}) {
  return (
    <div className="fge-drop px-edge" key={version}>
      <ErrorBlock title={problem.title}>{problem.sub}</ErrorBlock>
    </div>
  );
}

/** The footer under a keypad, over the home indicator. */
function PinFooter({children}: {children: ReactNode}) {
  return <div className="px-edge pb-[26px]">{children}</div>;
}

const settle = () => (prefersReducedMotion() ? 60 : 260);

function usePinCompletion(onComplete: (pin: string) => void, suspended = false) {
  const timer = useRef<number | undefined>(undefined);
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => {
    if (suspended) cancel();
    return cancel;
  }, [cancel, suspended]);
  return {
    cancel,
    schedule(pin: string) {
      cancel();
      if (suspended) return;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        onComplete(pin);
      }, settle());
    },
  };
}

export function pinForm(pin: string, confirmation = pin) {
  const data = new FormData();
  data.set("pin", pin);
  data.set("confirmation", confirmation);
  return data;
}

/**
 * Make a 4-digit PIN (1.3 to 1.5): type four digits, see at once why an easy one is refused, then type it
 * once more. `save` gets the PIN when both match, owns navigation on success, and returns an error on failure.
 */
export function MakePin({save, top, footer}: {
  save: (pin: string) => Promise<AuthResult | void>;
  /** The step bar, when this is part of onboarding. */
  top?: ReactNode;
  /** A line under the keypad: "Ask Christian for help". */
  footer?: ReactNode;
}) {
  const t = useTranslations("getIn.pin");
  const feedback = useTranslations("auth.feedback");
  const [phase, setPhase] = useState<"make" | "again">("make");
  const [pin, setPin] = useState("");
  const first = useRef("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  const [bad, setBad] = useState(false);
  const [shake, setShake] = useState(0);
  const [pending, start] = useTransition();

  function refuse(next: Problem) {
    haptic("error");
    setProblem(next);
    setVersion((count) => count + 1);
    setBad(true);
    setShake((count) => count + 1);
    // clear at once so fast typing after the refusal is never eaten; the gold ring stays until the next key
    setPin("");
  }

  function check(typed: string) {
    if (phase === "make") {
      const why = pinProblem(typed, typed);
      if (why === "pinDate") {
        const year = /^(19|20)\d\d$/.test(typed);
        refuse({title: t(year ? "year" : "date", {pin: typed}), sub: t(year ? "yearSub" : "dateSub")});
        return;
      }
      if (why) {
        refuse({title: t("easy"), sub: t("easySub")});
        return;
      }
      first.current = typed;
      setPin("");
      setPhase("again");
      return;
    }
    if (typed !== first.current) {
      first.current = "";
      setPhase("make");
      refuse({title: t("mismatch"), sub: t("mismatchSub")});
      return;
    }
    haptic("success");
    start(async () => {
      const result = await tryAuthAction(() => save(typed));
      if (result?.error) {
        first.current = "";
        setPhase("make");
        const known = feedback.has(result.error as Parameters<typeof feedback>[0]);
        refuse({title: t("problem"), sub: known ? feedback(result.error as Parameters<typeof feedback>[0]) : undefined});
      }
    });
  }

  const completion = usePinCompletion(check);

  return (
    <>
      {top}
      <PageTitle title={t(phase === "make" ? "makeTitle" : "againTitle")} lead={t(phase === "make" ? "makeLead" : "againLead")} />
      <div className={cn("flex flex-1 flex-col px-edge pt-6", footer ? "pb-2" : "pb-[34px]")}>
        <PinPad fill value={pin} slotsLabel={t("slots", {count: pin.length})} deleteLabel={t("delete")}
          bad={bad} shown={bad ? 4 : undefined} shakeKey={shake} disabled={pending}
          onChange={(next) => {
            completion.cancel();
            if (next.length) setBad(false);
            if (next.length === 1) setProblem(null);
            setPin(next);
          }}
          onComplete={completion.schedule}
          middle={<div className="-mx-edge">
            {pending ? <div role="status"><GroundNote icon="lock">{t("saving")}</GroundNote></div>
              : problem ? <Refusal problem={problem} version={version} />
                : <GroundNote icon="lock">{t("hint")}</GroundNote>}
          </div>} />
      </div>
      {footer && <PinFooter>{footer}</PinFooter>}
    </>
  );
}

export type PinRefusal = AuthResult;

/**
 * Enter your PIN (10.2, 10.5): four digits, then the server says yes (and redirects) or why not.
 * A rest after too many tries hands over to `onLocked`.
 */
export function EnterPin({title, lead, submit, left, note, footer, onLocked, organizer, suspended = false}: {
  title: string; lead: string;
  submit: (data: FormData) => Promise<AuthResult | void>;
  /** The keypad's bottom-left key: "Forgot?". */
  left?: ReactNode;
  /** The line under the slots before anything goes wrong. */
  note?: ReactNode;
  /** A line under the keypad: "Ask Christian for help". */
  footer?: ReactNode;
  onLocked: (minutes: number) => void;
  organizer: string;
  suspended?: boolean;
}) {
  const t = useTranslations("getIn.enter");
  const pinText = useTranslations("getIn.pin");
  const feedback = useTranslations("auth.feedback");
  const [pin, setPin] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [version, setVersion] = useState(0);
  const [bad, setBad] = useState(false);
  const [shake, setShake] = useState(0);
  const [pending, start] = useTransition();

  function explain(result: AuthResult): Problem {
    switch (result.error) {
      case "connectionFailed": return {title: pinText("problem"), sub: feedback("connectionFailed")};
      case "invalidPin":
        return {title: t("wrong"), sub: typeof result.triesLeft === "number" && result.triesLeft > 0
          ? t("wrongSub", {tries: result.triesLeft, organizer}) : t("wrongSubPlain", {organizer})};
      case "needsNewKey": return {title: t("newKey"), sub: t("newKeySub", {organizer})};
      case "newDevicesLocked": return {title: t("newDevices"), sub: t("newDevicesSub", {organizer})};
      case "tryLater": return {title: t("tryLater"), sub: t("tryLaterSub")};
      case "otherPerson": return {title: t("signedIn"), sub: t("signedInSub")};
      default: return {title: t("unavailable"), sub: t("unavailableSub", {organizer})};
    }
  }

  function send(typed: string) {
    start(async () => {
      const result = await tryAuthAction(() => submit(pinForm(typed)));
      if (!result?.error) return;
      haptic("error");
      setPin("");
      if (result.error === "pinLocked") {
        onLocked(result.minutes || 15);
        return;
      }
      setProblem(explain(result));
      setVersion((count) => count + 1);
      setBad(true);
      setShake((count) => count + 1);
    });
  }

  const completion = usePinCompletion(send, suspended);

  return (
    <>
      <PageTitle title={title} lead={lead} />
      <div className={cn("flex flex-1 flex-col px-edge pt-6", footer ? "pb-2" : "pb-[34px]")}>
        <PinPad fill value={pin} slotsLabel={pinText("slots", {count: pin.length})} deleteLabel={pinText("delete")}
          bad={bad} shown={bad ? 4 : undefined} shakeKey={shake} disabled={pending || suspended} left={left}
          onChange={(next) => {
            if (pending || suspended) return;
            completion.cancel();
            if (next.length) setBad(false);
            if (next.length === 1) setProblem(null);
            setPin(next);
          }}
          onComplete={completion.schedule}
          middle={<div className="-mx-edge">
            {problem ? <Refusal problem={problem} version={version} /> : note}
          </div>} />
      </div>
      {footer && <PinFooter>{footer}</PinFooter>}
    </>
  );
}
