"use client";

import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from "react";
import {leafPair, round2, stitchHeight} from "./knit/knit";

type StripState = "done" | "now" | "todo" | "wait";

function Strip({state, columns, cell, knitting}: {state: StripState; columns: number; cell: number; knitting: boolean}) {
  const h = stitchHeight(cell);
  const stitches: Array<{d: string; lit: boolean; wait: boolean}> = [];
  // bottom row first, then the top row the other way, as knitting grows
  for (let row = 1, pass = 0; row >= 0; row--, pass++) {
    const columnsInOrder = [...Array(columns).keys()];
    if (pass % 2) columnsInOrder.reverse();
    for (const column of columnsInOrder) {
      stitches.push({d: leafPair(column * cell, row * h, cell, h), lit: column < 5, wait: (column + row) % 2 === 0});
    }
  }
  const width = round2(columns * cell), height = round2(2 * h);
  return (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className="fge-strip block h-auto min-w-0 overflow-visible" data-state={state} data-knitting={knitting}>
      {stitches.map((stitch, index) => (
        <path key={index} className="fge-ss" d={stitch.d} data-lit={stitch.lit || undefined} data-wait={stitch.wait || undefined}
          style={{"--i": index} as CSSProperties} />
      ))}
    </svg>
  );
}

const STORAGE = "fge-step-bar:";

/**
 * Knitted strips, one per step: done strips are yarn white, the current one lights gold, the rest wait at 40%.
 * When you arrive at a later step, the strip you just finished knits up, 14ms a stitch.
 * `id` keeps the last step shown per flow, so the knit-up plays once.
 */
export function StepBar({id, step, total, progress, name, waitingStep, done = false}: {
  id: string; step: number; total: number;
  /** Already translated: "Step 2 of 4", or "All 4 steps done". */
  progress: string;
  /** The step's name: "Your person". */
  name?: string;
  waitingStep?: number; done?: boolean;
}) {
  const [knitFrom, setKnitFrom] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const shown = useRef(false);
  useLayoutEffect(() => {
    if (shown.current) return;
    shown.current = true;
    const finished = done ? total : step - 1;
    try {
      const before = Number(sessionStorage.getItem(STORAGE + id) ?? "-1");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one knit-up on arrival, read from the last screen
      if (before >= 0 && before < finished) setKnitFrom(before);
      sessionStorage.setItem(STORAGE + id, String(finished));
    } catch {
      // private mode: no knit-up, the bar still shows the state
    }
  }, [id, step, total, done]);

  useEffect(() => {
    if (knitFrom === null) return;
    // paint the strips as they were on the last screen, then let them knit up
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [knitFrom]);

  const columns = total >= 5 ? 9 : 12;
  const finished = done ? total : step - 1;
  return (
    <div className="flex flex-col gap-2 px-edge pt-2.5" data-step-bar={id}>
      <div className="flex" style={{gap: total >= 5 ? 8 : 10}}>
        {Array.from({length: total}, (_, index) => {
          const number = index + 1;
          let state: StripState = done || number <= finished
            ? (waitingStep === number ? "wait" : "done")
            : number === step ? "now" : "todo";
          const knitting = knitFrom !== null && number > knitFrom && number <= finished;
          if (knitFrom !== null && !armed && number > knitFrom) state = number === knitFrom + 1 ? "now" : "todo";
          return <Strip key={index} state={state} columns={columns} cell={6} knitting={knitting} />;
        })}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-body text-snow-white" aria-live="polite">
        <span className="font-extrabold whitespace-nowrap">{progress}</span>
        {name && !done && <><span aria-hidden="true">·</span><span>{name}</span></>}
      </p>
    </div>
  );
}
