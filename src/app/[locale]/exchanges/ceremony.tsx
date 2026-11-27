"use client";

import {useTranslations} from "next-intl";
import {useActionState, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton} from "@/components/ui/button";
import {KnitField} from "@/components/ui/knit/knit-svg";
import {KnitMotif, Snowflake} from "@/components/ui/knit/knit-motif";
import {EASE} from "@/components/ui/motion/easing";
import {haptic} from "@/components/ui/motion/haptic";
import {prefersReducedMotion} from "@/components/ui/motion/reduced-motion";
import {Screen} from "@/components/ui/screen";
import {manage, type FormState} from "./actions";

// the stage, in the prototype's coordinates
const STAGE_W = 390, STAGE_H = 470, CX = 195, CY = 215, RX = 120, RY = 150;
const PANEL_ROWS = 28;

type Phase = "loop" | "panel" | "sealed";

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * The draw: one yarn loop draws itself through everyone's snowflake in 2.4s (a tick for each), a knitted
 * panel covers it row by row in 1.3s, then the lock knits itself in. The loop's order is random, never
 * the real one. "Skip the animation" is always there; with reduced motion it is skipped.
 */
export function DrawCeremony({names, onDone}: {names: readonly string[]; onDone: () => void}) {
  const t = useTranslations("draw.setup");
  const [phase, setPhase] = useState<Phase>("loop");
  const loop = useRef<SVGPathElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  const people = useMemo(() => names.map((name, index) => {
    const angle = -Math.PI / 2 + (index / names.length) * Math.PI * 2;
    return {name, x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle)};
  }), [names]);
  // drawn once per ceremony, in a random order
  const [order] = useState(() => shuffle(people.map((_, index) => index)));
  const path = useMemo(() => {
    if (people.length < 2) return "";
    const points = [...order, order[0]].map((index) => [people[index].x, people[index].y - 18] as const);
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let index = 1; index < points.length; index++) {
      const [x0, y0] = points[index - 1], [x1, y1] = points[index];
      d += `C${x0 + 60} ${y0 + 20} ${x1 - 60} ${y1 - 20} ${x1} ${y1}`;
    }
    return d;
  }, [order, people]);

  useEffect(() => {
    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      haptic("success");
      done.current();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    const timers: number[] = [];
    const element = loop.current;
    if (element) {
      const length = element.getTotalLength();
      element.style.strokeDasharray = String(length);
      element.animate([{strokeDashoffset: length}, {strokeDashoffset: 0}], {duration: 2400, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards"});
    }
    ring.current?.querySelectorAll<HTMLElement>("[data-person]").forEach((person, index) => {
      timers.push(window.setTimeout(() => {
        person.animate([{transform: "scale(1)"}, {transform: "scale(1.18)"}, {transform: "scale(1)"}], {duration: 360, easing: EASE.interface});
        haptic("tick");
      }, 300 + order.indexOf(index) * (2100 / Math.max(1, people.length))));
    });
    timers.push(window.setTimeout(() => {
      setPhase("panel");
      panel.current?.animate([{clipPath: "inset(100% 0 0 0)"}, {clipPath: "inset(0 0 0 0)"}],
        {duration: 1300, easing: `steps(${PANEL_ROWS}, end)`, fill: "forwards"});
    }, 2700));
    timers.push(window.setTimeout(() => {
      setPhase("sealed");
      [ring.current, loop.current, panel.current].forEach((element) => element?.animate([{opacity: 1}, {opacity: 0}], {duration: 420, fill: "forwards"}));
    }, 4200));
    timers.push(window.setTimeout(finish, 6000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [order, people.length]);

  const title = {loop: t("ceremonyLoop"), panel: t("ceremonyPanel"), sealed: t("ceremonySealed")}[phase];
  const sub = {loop: t("ceremonyLoopHint"), panel: t("ceremonyPanelHint"), sealed: t("ceremonySealedHint")}[phase];
  return (
    <Screen label={t("ceremonyLabel")} actions={<TextButton className="self-center text-snow-white" onClick={() => {
      if (finished.current) return;
      finished.current = true;
      haptic("success");
      done.current();
    }}>{t("skip")}</TextButton>}>
      <div className="px-edge pt-14" aria-live="polite">
        <h1 className="text-title">{title}</h1>
      </div>
      <div className="relative mx-auto mt-4 w-full max-w-[390px] overflow-hidden" style={{height: STAGE_H}} data-ceremony={phase}>
        <div ref={ring} className="absolute inset-0">
          {people.map(({name, x, y}) => (
            <div key={name + x} data-person="" className="absolute flex w-[100px] flex-col items-center gap-1.5"
              style={{left: `${(x - 50) / STAGE_W * 100}%`, top: y - 34}}>
              <Snowflake cell={5.2} />
              <span className="max-w-full truncate text-tab font-bold">{name}</span>
            </div>
          ))}
        </div>
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} preserveAspectRatio="none">
          <path ref={loop} d={path} fill="none" stroke="var(--color-yarn-white)" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div ref={panel} aria-hidden="true" className="absolute inset-x-edge top-6 bottom-6 overflow-hidden rounded-[24px] bg-[#B51B2A]"
          style={{clipPath: "inset(100% 0 0 0)"} as CSSProperties}>
          <KnitField stitch="var(--color-sweater-red)" cell={15} className="absolute inset-0" />
        </div>
        {phase === "sealed" && (
          <div className="absolute inset-x-0 top-[120px] flex justify-center">
            <KnitMotif name="lock" cell={12} knit stepMs={9} />
          </div>
        )}
      </div>
      <p className="px-edge pt-2 text-lead">{sub}</p>
    </Screen>
  );
}

/**
 * Setup step 4. Before the draw, the check and the one "Draw names" button; pressing it plays the
 * ceremony while the page catches up, then the sealed screen. After the draw, only the sealed screen.
 */
export function DrawStep({exchangeId, version, drawn, canDraw, names, check, sealed}: {
  exchangeId: string; version: number; drawn: boolean; canDraw: boolean; names: readonly string[];
  check: ReactNode; sealed: ReactNode;
}) {
  const t = useTranslations("draw");
  const [playing, setPlaying] = useState(false);
  // the page catches up with the draw while the ceremony plays: keep the names it started with
  const [cast] = useState(names);
  const [state, submit, pending] = useActionState(
    (previous: FormState, data: FormData) => manage(exchangeId, {kind: "draw", expectedVersion: version}, previous, data), {});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the names are drawn: play the ceremony
    if (state.feedback) setPlaying(true);
    else if (state.error) haptic("error");
  }, [state]);

  if (playing) return <DrawCeremony names={cast} onDone={() => setPlaying(false)} />;
  if (drawn) return sealed;
  return (
    <Screen back={`/family`} actions={<>
      {state.error && <ErrorBlock title={state.error} />}
      <form action={submit} className="flex flex-col">
        <Button type="submit" icon={canDraw ? "shuffle" : undefined} disabled={!canDraw || pending}
          onClick={() => haptic("firm")}>{t("drawNames")}</Button>
      </form>
      {canDraw && <p className="text-center text-body">{t("setup.drawNote")}</p>}
    </>}>
      {check}
    </Screen>
  );
}
