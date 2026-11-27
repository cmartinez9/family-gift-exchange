"use client";

import {useEffect, useRef, useState, useTransition} from "react";
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
 * Your person, on someone else's phone (9.3): the relative holds the gift and their person knits in, the
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
  const [view, setView] = useState<"person" | "back">(exchange && !hidden ? "person" : "back");
  const [person, setPerson] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"ready" | "opening" | "open">("ready");
  const [hiding, startHiding] = useTransition();
  const [hideFailed, setHideFailed] = useState(false);
  const pine = useRef<HTMLDivElement>(null);
  useForgetOnRestore();

  // The relative has the phone now: the name is fetched once, and shown only when they open the gift.
  useEffect(() => {
    if (view !== "person" || !exchange) return;
    let current = true;
    revealOnBorrowedPhone(exchange.id, exchange.version).then((result) => {
      if (!current) return;
      if (result.name) setPerson(result.name);
      else setFailed(true);
    }, () => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [view, exchange, attempt]);

  if (view === "back") return <HandBack name={name} owner={owner} shown={hidden || Boolean(exchange)} />;

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
    ready: t("reveal.ready"), readyHint: t("reveal.readyHint"), holding: t("reveal.holding"), holdingHint: t("reveal.holdingHint"),
    holdLonger: t("reveal.holdLonger"), letGo: t("reveal.letGo"), watching: t("reveal.watching"), watchingHint: t("reveal.watchingHint"),
    tapToOpen: t("reveal.tap"), gift: t("reveal.gift"), progress: t("reveal.progress"), lead: t("reveal.lead"), onlyYou: t("reveal.onlyYou"),
  };

  return (
    <Screen>
      <div ref={pine} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-pine" style={{opacity: 0}} />
      <div className="relative transition-opacity duration-200" style={{opacity: phase === "opening" ? 0 : 1}}
        aria-hidden={phase === "opening"}>
        <WelcomeSteps step={2} />
      </div>
      {person ? (
        <UnravelReveal key={attempt} name={person} labels={labels} onStart={() => setPhase("opening")} onRevealed={revealed}
          next={<>
            <Button icon="eye" disabled={hiding} onClick={hide}>{t("hide", {person})}</Button>
            {hideFailed
              ? <p role="alert" className="text-center text-body font-semibold">{t("hideFailed")}</p>
              : <p className="pt-1 text-center text-body">{t("handBackLine", {owner})}</p>}
          </>} />
      ) : failed ? (
        <div className="relative flex flex-col gap-3 px-edge pt-8">
          <ErrorBlock title={t("revealFailed")} />
          <Button variant="outline" onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}>{t("tryAgain")}</Button>
        </div>
      ) : (
        <p role="status" aria-busy="true" className="sr-only">{t("reveal.ready")}</p>
      )}
    </Screen>
  );
}
