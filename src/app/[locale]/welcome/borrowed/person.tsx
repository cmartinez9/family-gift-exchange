"use client";

import {useRef, useState, useTransition} from "react";
import {useTranslations} from "next-intl";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button} from "@/components/ui/button";
import {DURATION, EASE} from "@/components/ui/motion/easing";
import {haptic} from "@/components/ui/motion/haptic";
import {prefersReducedMotion} from "@/components/ui/motion/reduced-motion";
import {UnravelReveal} from "@/components/ui/motion/unravel-reveal";
import {Screen} from "@/components/ui/screen";
import {WelcomeSteps} from "../../sign-in/get-in";
import {hideOnBorrowedPhone, revealOnBorrowedPhone} from "./actions";
import {HandBack, useForgetOnRestore} from "./hand-back";

/**
 * Your person, on someone else's phone (9.3): holding the gift opens the relative's person and knits it in, the
 * whole screen turns pine, and the one button hides it again before the phone goes back to its owner.
 * With no person to open yet, or once hidden, it goes straight to handing the phone back (9.4).
 */
export function BorrowedPerson({name, owner, exchange, hidden}: {
  name: string;
  owner: string;
  exchange: {id: string; version: number} | null;
  hidden: boolean;
}) {
  const t = useTranslations("borrowed");
  const draw = useTranslations("draw");
  const [view, setView] = useState<"person" | "back">(exchange && !hidden ? "person" : "back");
  const [person, setPerson] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"ready" | "opening" | "open">("ready");
  const asked = useRef(false);
  const [hiding, startHiding] = useTransition();
  const [hideFailed, setHideFailed] = useState(false);
  const pine = useRef<HTMLDivElement>(null);
  useForgetOnRestore();

  if (view === "back") return <HandBack name={name} owner={owner} shown={hidden || Boolean(exchange)} />;

  /** The hold has started: only now is the person opened, and the name knits in as soon as it arrives. */
  function open() {
    setPhase("opening");
    if (asked.current || !exchange) return;
    asked.current = true;
    revealOnBorrowedPhone(exchange.id, exchange.version).then((result) => {
      if (result.name) setPerson(result.name);
      else {
        asked.current = false;
        setFailed(true);
      }
    }, () => {
      asked.current = false;
      setFailed(true);
    });
  }

  function revealed() {
    setPhase("open");
    const layer = pine.current;
    if (!layer) return;
    // the whole ground turns pine with the reveal's own stage: only you may see this
    if (prefersReducedMotion()) layer.style.opacity = "1";
    else layer.animate([{opacity: 0}, {opacity: 1}], {duration: DURATION.groundToPine, easing: EASE.pine, fill: "forwards"});
  }

  function hide() {
    setHideFailed(false);
    startHiding(async () => {
      let done = false;
      try {
        done = (await hideOnBorrowedPhone()).hidden;
      } catch {
        done = false;
      }
      if (!done) {
        setHideFailed(true);
        return;
      }
      haptic("light");
      setPerson(null);
      setView("back");
    });
  }

  const labels = {
    ready: draw("person.revealReady"), readyHint: draw("person.revealReadyHint"),
    holding: draw("person.revealHolding"), holdingHint: draw("person.revealHoldingHint"), holdLonger: draw("person.revealHoldLonger"),
    letGo: draw("person.revealLetGo"), watching: draw("person.revealWatching"), watchingHint: draw("person.revealWatchingHint"),
    tapToOpen: draw("person.revealTap"), gift: draw("person.revealGift"), progress: draw("person.revealProgress"),
    lead: draw("person.lead"), onlyYou: draw("person.onlyYou"),
  };

  return (
    <Screen>
      <div ref={pine} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-pine" style={{opacity: 0}} />
      <div className="relative transition-opacity duration-200" style={{opacity: phase === "opening" ? 0 : 1}}
        aria-hidden={phase === "opening"}>
        <WelcomeSteps step={2} />
      </div>
      <UnravelReveal key={attempt} name={person} labels={labels} onStart={open} onRevealed={revealed}
        next={person && <>
          <Button icon="eye" disabled={hiding} onClick={hide}>{t("hide", {person})}</Button>
          {hideFailed
            ? <p role="alert" className="text-center text-body font-semibold">{t("hideFailed")}</p>
            : <p className="pt-1 text-center text-body">{t("handBackLine", {owner})}</p>}
        </>} />
      {failed && (
        <div className="absolute inset-x-edge top-[150px] z-10 flex flex-col gap-2">
          <ErrorBlock title={t("revealFailed")} />
          <Button variant="outline" onClick={() => {
            setFailed(false);
            setPhase("ready");
            setAttempt((value) => value + 1);
          }}>{draw("person.tryAgain")}</Button>
        </div>
      )}
    </Screen>
  );
}
