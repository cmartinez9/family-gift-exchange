"use client";

import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {TextButton} from "../button";
import {OnlyYou} from "../card";
import {FairIsleBand} from "../knit/knit-svg";
import {Snowflake} from "../knit/knit-motif";
import {MOTIFS, leafPair, stitchHeight, textBitmap, canStitch, round2} from "../knit/knit";
import {STITCH_CELL} from "../knit/stitched-text";
import {DURATION, EASE} from "./easing";
import {haptic} from "./haptic";
import {prefersReducedMotion} from "./reduced-motion";

export type RevealLabels = {
  /** "Your person is ready" */
  ready: string;
  /** "Press and hold the gift to pull the yarn." */
  readyHint: string;
  /** "Keep holding" */
  holding: string;
  /** "The gift is coming undone, row by row." */
  holdingHint: string;
  /** "Hold a little longer." */
  holdLonger: string;
  /** "Let go any time. Hold to keep pulling." */
  letGo: string;
  /** "Keep watching" */
  watching: string;
  /** "The yarn is knitting a name." */
  watchingHint: string;
  /** "Or tap here to open it" */
  tapToOpen: string;
  /** The gift's label: "The knitted gift. Press and hold to pull the yarn, or use the link below." */
  gift: string;
  /** "Unravelling" — names the progress for screen readers. */
  progress: string;
  /** "You're giving to" */
  lead: string;
  /** "Only you can see this" */
  onlyYou: string;
};

// the gift: 17 by 16 cells of 13px
const GC = 13, GCH = stitchHeight(GC), GW = 17 * GC, GH = MOTIFS.gift.length * GCH;
const ROWS = MOTIFS.gift.length;
// positions in the stage, from the prototype (status bar removed)
const HEAD_TOP = 24, NAME_TOP = 150, GIFT_TOP = 253, BAND_TOP = 513, YARN_ENTRY_Y = 205;

type Phase = "ready" | "holding" | "short" | "paused" | "watching" | "revealed";

/**
 * The reveal: press and hold the knitted gift. Holding pulls the yarn — 16 rows, one whole gift per 1.7s
 * of holding, each row zipping into the yarn in 300ms; letting go keeps pulled rows pulled. Then the yarn
 * knits the name, one stitch every 7.5ms, its end following the needle, and the ground turns pine.
 *
 * Every hold has a tap path ("Or tap here to open it", 1100ms) and works from the keyboard (Space or
 * Enter held down). Reduced motion: the gift opens at once.
 */
export function UnravelReveal({name, labels, next, revealed: initiallyRevealed = false, onStart, onRevealed, titleAs: Title = "h1"}: {
  /** The name to knit. A name the stitched alphabet cannot draw yet is shown in heavy Rubik. */
  name: string;
  labels: RevealLabels;
  /** What comes after: the main button on the ground, and a line under it. */
  next: ReactNode;
  revealed?: boolean;
  /** The reveal owns the screen once you start: fade the step bar away here. */
  onStart?: () => void;
  onRevealed?: () => void;
  /** The heading's level; the reveal is normally the whole screen. */
  titleAs?: "h1" | "h2" | "h3" | "h4";
}) {
  const [phase, setPhase] = useState<Phase>(initiallyRevealed ? "revealed" : "ready");
  const [announce, setAnnounce] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const gift = useRef<HTMLButtonElement>(null);
  const yarn = useRef<SVGPathElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const nameSvg = useRef<SVGSVGElement>(null);
  const state = useRef({p: initiallyRevealed ? 1 : 0, row: 0, held: false, opened: initiallyRevealed, done: initiallyRevealed, end: null as [number, number] | null});
  const frames = useRef({yarn: 0, hold: 0, tap: 0, knit: 0});
  const timers = useRef<number[]>([]);
  const callbacks = useRef({onStart, onRevealed});
  useEffect(() => {
    callbacks.current = {onStart, onRevealed};
  });

  const stitched = canStitch(name);
  const cell = STITCH_CELL.revealedName, ch = stitchHeight(cell);
  const {bitmap, nameStitches} = useMemo(() => {
    const chart = stitched ? textBitmap(name) : [];
    const order: Array<{d: string; cx: number; cy: number}> = [];
    for (let row = chart.length - 1, pass = 0; row >= 0; row--, pass++) {
      const columns = [...chart[row]].map((character, column) => [character, column] as const).filter(([character]) => character === "#");
      if (pass % 2) columns.reverse();
      for (const [, column] of columns) {
        order.push({d: leafPair(column * cell, row * ch, cell, ch), cx: column * cell + cell / 2, cy: row * ch + ch / 2});
      }
    }
    return {bitmap: chart, nameStitches: order};
  }, [name, stitched, cell, ch]);
  const nameWidth = round2((bitmap[0]?.length ?? 0) * cell), nameHeight = round2(bitmap.length * ch);

  const q = useCallback(<T extends Element>(selector: string) => stage.current?.querySelector<T>(selector) ?? null, []);
  const qa = useCallback(<T extends Element>(selector: string) => [...(stage.current?.querySelectorAll<T>(selector) ?? [])], []);

  const giftBox = useCallback(() => {
    const width = stage.current?.offsetWidth ?? 390;
    const left = (width - GW) / 2;
    return {width, left, right: left + GW};
  }, []);

  // the loose yarn: idle above the gift, then running off the right edge to the row being pulled, swaying 12px
  const drawYarn = useCallback((time: number) => {
    const path = yarn.current, s = state.current;
    if (!path) return;
    const {width, right} = giftBox();
    ring.current?.setAttribute("cx", String(right + 38.5));
    if (s.p === 0 && !s.end) {
      path.setAttribute("d", `M${width / 2} ${GIFT_TOP - 64}V${GIFT_TOP}M${right - 10} ${GIFT_TOP + 6}`
        + `C${right + 46.5} ${GIFT_TOP - 4} ${right + 54.5} ${GIFT_TOP - 30} ${right + 38.5} ${GIFT_TOP - 40}`);
    } else {
      let ex: number, ey: number;
      if (s.end) [ex, ey] = s.end;
      else {
        const k = Math.min(ROWS, Math.floor(s.p * ROWS + 1e-6));
        ex = right - 12;
        ey = GIFT_TOP + k * GCH + 4;
      }
      const sway = 12 * Math.sin(time / 170);
      path.setAttribute("d", `M${width + 14} ${YARN_ENTRY_Y}C${width - 18 + sway} ${YARN_ENTRY_Y + 10} ${width - 10 - sway} ${ey - 60} ${ex + 46} ${ey - 12}`
        + `S${ex + 10} ${ey - 2} ${ex} ${ey}`);
    }
    if (!s.done) frames.current.yarn = requestAnimationFrame(drawYarn);
  }, [giftBox]);

  const setProgress = useCallback((value: number) => {
    const s = state.current;
    s.p = Math.max(s.p, Math.min(1, value));
    const k = Math.floor(s.p * ROWS + 1e-6);
    qa<SVGGElement>(".fge-kr").forEach((row, index) => row.setAttribute("data-gone", String(index < k)));
    if (ring.current) ring.current.style.opacity = s.p > 0 ? "0" : "1";
    progress.current?.setAttribute("aria-valuenow", String(Math.round(s.p * 100)));
    if (k > s.row) {
      s.row = k;
      haptic("tick");
    }
  }, [qa]);

  const showNext = useCallback((delay: number) => {
    const next = q<HTMLElement>("[data-reveal-next]");
    if (!next) return;
    timers.current.push(window.setTimeout(() => {
      next.style.pointerEvents = "auto";
      next.removeAttribute("inert");
    }, delay));
    next.animate([{opacity: 0, transform: "translateY(16px)"}, {opacity: 1, transform: "none"}],
      {duration: prefersReducedMotion() ? DURATION.reduced : 360, delay, fill: "forwards", easing: EASE.interface});
  }, [q]);

  const finish = useCallback((instant: boolean) => {
    const s = state.current;
    s.done = true;
    cancelAnimationFrame(frames.current.yarn);
    setPhase("revealed");
    setAnnounce(`${labels.lead} ${name}`);
    haptic("success");
    const fade = (selector: string, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const element = q<HTMLElement | SVGElement>(selector);
      if (!element) return;
      if (instant) element.style.opacity = String(keyframes.at(-1)?.opacity ?? 1);
      else element.animate(keyframes, {fill: "forwards", ...options});
    };
    fade("[data-yarn]", [{opacity: 1}, {opacity: 0}], {duration: 300});
    fade("[data-pine]", [{opacity: 0}, {opacity: 1}], {duration: DURATION.groundToPine, easing: EASE.pine});
    fade("[data-reveal-head]", [{opacity: 1}, {opacity: 0}], {duration: 250});
    fade("[data-reveal-lead]", [{opacity: 0, transform: "translateY(10px)"}, {opacity: 1, transform: "none"}], {duration: 400, delay: 350, easing: EASE.interface});
    fade("[data-reveal-flakes]", [{opacity: 0, transform: "translateY(-14px) rotate(-30deg)"}, {opacity: 1, transform: "none"}], {duration: 700, delay: 450, easing: EASE.interface});
    fade("[data-reveal-only]", [{opacity: 0}, {opacity: 1}], {duration: 300, delay: 700});
    fade("[data-reveal-band]", [{opacity: 0, transform: "translateY(12px)"}, {opacity: 1, transform: "none"}], {duration: 420, delay: 780, easing: EASE.interface});
    showNext(instant ? 0 : 950);
    callbacks.current.onRevealed?.();
  }, [labels.lead, name, q, showNext]);

  const openNow = useCallback(() => {
    const s = state.current;
    s.opened = true;
    s.p = 1;
    qa<SVGGElement>(".fge-kr").forEach((row) => row.setAttribute("data-gone", "true"));
    qa<SVGPathElement>(".fge-nm").forEach((stitch) => stitch.setAttribute("data-on", "true"));
    if (gift.current) gift.current.style.visibility = "hidden";
    finish(true);
  }, [finish, qa]);

  const knitName = useCallback(() => {
    const s = state.current;
    if (s.opened) return;
    s.opened = true;
    setPhase("watching");
    timers.current.push(window.setTimeout(() => {
      if (gift.current) gift.current.style.visibility = "hidden";
    }, 320));
    const stitches = qa<SVGPathElement>(".fge-nm");
    const svg = nameSvg.current, host = stage.current;
    const start = performance.now() + 260;
    const step = (time: number) => {
      const n = Math.floor(Math.max(0, time - start) / DURATION.knitNameStep);
      for (let index = 0; index < Math.min(n, stitches.length); index++) stitches[index].setAttribute("data-on", "true");
      if (svg && host && nameStitches.length) {
        const box = svg.getBoundingClientRect(), origin = host.getBoundingClientRect();
        const at = nameStitches[Math.min(n, nameStitches.length - 1)];
        s.end = [box.left - origin.left + at.cx, box.top - origin.top + at.cy];
      }
      if (n < stitches.length) frames.current.knit = requestAnimationFrame(step);
      else finish(false);
    };
    frames.current.knit = requestAnimationFrame(step);
  }, [finish, nameStitches, qa]);

  const begin = useCallback(() => {
    const s = state.current;
    if (s.held || s.opened) return;
    if (prefersReducedMotion()) {
      callbacks.current.onStart?.();
      openNow();
      return;
    }
    if (s.p === 0) callbacks.current.onStart?.();
    s.held = true;
    setPhase("holding");
    let last = 0;
    const hold = (time: number) => {
      if (!s.held) return;
      const dt = last ? time - last : 16;
      last = time;
      if (!s.opened) {
        setProgress(s.p + dt / DURATION.unravelPerGift);
        if (s.p >= 1) {
          s.held = false;
          knitName();
          return;
        }
      }
      frames.current.hold = requestAnimationFrame(hold);
    };
    frames.current.hold = requestAnimationFrame(hold);
  }, [knitName, openNow, setProgress]);

  const release = useCallback(() => {
    const s = state.current;
    if (!s.held) return;
    s.held = false;
    cancelAnimationFrame(frames.current.hold);
    if (!s.opened && s.p < 1) setPhase(s.p < 0.07 ? "short" : "paused");
  }, []);

  const tapOpen = useCallback(() => {
    const s = state.current;
    if (s.opened) return;
    if (prefersReducedMotion()) {
      callbacks.current.onStart?.();
      openNow();
      return;
    }
    if (s.p === 0) callbacks.current.onStart?.();
    const from = s.p, start = performance.now();
    const run = (time: number) => {
      const k = Math.min(1, (time - start) / DURATION.unravelTap);
      setProgress(from + (1 - from) * k);
      if (k < 1) frames.current.tap = requestAnimationFrame(run);
      else knitName();
    };
    frames.current.tap = requestAnimationFrame(run);
  }, [knitName, openNow, setProgress]);

  useEffect(() => {
    const all = frames.current, pending = timers.current;
    if (!state.current.done) all.yarn = requestAnimationFrame(drawYarn);
    return () => {
      cancelAnimationFrame(all.yarn);
      cancelAnimationFrame(all.hold);
      cancelAnimationFrame(all.tap);
      cancelAnimationFrame(all.knit);
      pending.forEach((timer) => window.clearTimeout(timer));
    };
  }, [drawYarn]);

  const title = phase === "holding" || phase === "short" || phase === "paused" ? labels.holding
    : phase === "watching" ? labels.watching : labels.ready;
  const hint = {ready: labels.readyHint, holding: labels.holdingHint, short: labels.holdLonger, paused: labels.letGo,
    watching: labels.watchingHint, revealed: labels.watchingHint}[phase];
  const revealed = phase === "revealed";
  const shownAtStart = initiallyRevealed;
  const giftRows = MOTIFS.gift.map((row, rowIndex) => {
    const byColor: Record<string, string> = {};
    [...row].forEach((character, column) => {
      if (character === "#" || character === "o") byColor[character] = (byColor[character] ?? "") + leafPair(column * GC, rowIndex * GCH, GC, GCH);
    });
    return byColor;
  });

  return (
    <div ref={stage} className="fge-reveal relative min-h-[720px] flex-1 overflow-hidden text-snow-white" data-reveal={phase}>
      <div data-pine="" className="absolute inset-0 bg-pine" style={{opacity: shownAtStart ? 1 : 0}} />

      <div data-reveal-head="" className="absolute inset-x-edge flex flex-col gap-2" style={{top: HEAD_TOP, opacity: shownAtStart ? 0 : 1}}
        aria-hidden={revealed}>
        <Title className="text-title">{title}</Title>
        <p className="text-lead" aria-live="polite">{hint}</p>
      </div>

      <svg data-yarn="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" style={{opacity: shownAtStart ? 0 : 1}}>
        <path ref={yarn} d="" fill="none" stroke="var(--color-yarn-white)" strokeWidth={4.5} strokeLinecap="round" />
        <circle ref={ring} data-ring="" cx={0} cy={GIFT_TOP - 52} r={11} fill="none" stroke="var(--color-gold)" strokeWidth={5} />
      </svg>

      <button ref={gift} type="button" aria-label={labels.gift} className="fge-gift absolute left-1/2 -translate-x-1/2 p-0"
        style={{top: GIFT_TOP, width: GW, height: GH, visibility: shownAtStart ? "hidden" : undefined}}
        onPointerDown={(event) => {
          event.preventDefault();
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // the pointer may already be gone
          }
          begin();
        }}
        onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            begin();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            release();
          }
        }}>
        <svg width={GW} height={round2(GH)} viewBox={`0 0 ${GW} ${round2(GH)}`} aria-hidden="true" className="block overflow-visible">
          {giftRows.map((row, index) => (
            <g key={index} className="fge-kr" data-gone={shownAtStart ? "true" : "false"}>
              {row["#"] && <path d={row["#"]} style={{fill: "var(--color-yarn-white)"}} />}
              {row.o && <path d={row.o} style={{fill: "var(--color-gold)"}} />}
            </g>
          ))}
        </svg>
      </button>
      <span ref={progress} role="progressbar" aria-label={labels.progress} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={shownAtStart ? 100 : 0} className="sr-only" />

      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-5" style={{top: NAME_TOP}}>
        <div data-reveal-flakes="" className="flex gap-[70px]" style={{opacity: shownAtStart ? 1 : 0}}>
          <Snowflake cell={5} /><Snowflake cell={5} />
        </div>
        <p data-reveal-lead="" className="text-section font-bold" style={{opacity: shownAtStart ? 1 : 0}}>{labels.lead}</p>
        {stitched ? (
          <svg ref={nameSvg} aria-hidden="true" width={nameWidth} height={nameHeight} viewBox={`0 0 ${nameWidth} ${nameHeight}`} className="block overflow-visible">
            {nameStitches.map((stitch, index) => (
              <path key={index} className="fge-nm" d={stitch.d} data-on={shownAtStart ? "true" : "false"} style={{fill: "var(--color-yarn-white)"}} />
            ))}
          </svg>
        ) : (
          <p aria-hidden="true" className="font-extrabold uppercase" style={{fontSize: 9 * ch * 0.86, lineHeight: `${9 * ch}px`, opacity: revealed ? 1 : 0}}>{name}</p>
        )}
        <div data-reveal-only="" style={{opacity: shownAtStart ? 1 : 0}}><OnlyYou>{labels.onlyYou}</OnlyYou></div>
      </div>
      <p className="sr-only" aria-live="assertive">{announce}</p>

      <div data-reveal-band="" className="pointer-events-none absolute inset-x-0" style={{top: BAND_TOP, opacity: shownAtStart ? 1 : 0}}>
        <FairIsleBand kind="flake" cell={7} />
      </div>

      {(phase === "ready" || phase === "holding" || phase === "short" || phase === "paused") && (
        <div className="absolute inset-x-0 bottom-[34px] flex justify-center">
          <TextButton onClick={tapOpen}>{labels.tapToOpen}</TextButton>
        </div>
      )}

      <div data-reveal-next="" inert={!shownAtStart} className="absolute inset-x-edge bottom-[34px] flex flex-col gap-1.5"
        style={{opacity: shownAtStart ? 1 : 0, pointerEvents: shownAtStart ? "auto" : "none"}}>
        {next}
      </div>
    </div>
  );
}
