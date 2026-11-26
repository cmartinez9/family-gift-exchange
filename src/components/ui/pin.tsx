"use client";

import {useEffect, useRef, type ReactNode} from "react";
import {cn} from "./cn";
import {Icon} from "./icon";
import {KnitSvg} from "./knit/knit-svg";
import {MOTIFS} from "./knit/knit";
import {haptic} from "./motion/haptic";

export const PIN_LENGTH = 4;

/**
 * Four 64 by 76px slots. A filled slot is white with a stitched red dot that pops in.
 * A refused PIN rings the slots gold and shakes them once.
 */
export function PinSlots({filled, bad = false, shakeKey, label, length = PIN_LENGTH}: {
  filled: number; bad?: boolean; shakeKey?: number; label: string; length?: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shakeKey || !row.current) return;
    const element = row.current;
    element.classList.remove("fge-shake");
    void element.offsetWidth;
    element.classList.add("fge-shake");
    const done = () => element.classList.remove("fge-shake");
    element.addEventListener("animationend", done, {once: true});
    return () => element.removeEventListener("animationend", done);
  }, [shakeKey]);
  return (
    <div ref={row} role="img" aria-label={label} className="flex justify-center gap-3.5" data-filled={filled}>
      {Array.from({length}, (_, index) => {
        const on = index < filled;
        return (
          <span key={index} data-filled={on} data-bad={bad && on}
            className={cn("fge-slot flex h-[76px] w-16 items-center justify-center rounded-pin-slot", on ? "bg-snow-white" : "bg-pin-slot-red")}>
            <span className="fge-slot-dot"><KnitSvg bitmap={MOTIFS.dot} cell={8} colors={{"#": "var(--color-sweater-red)"}} /></span>
          </span>
        );
      })}
    </div>
  );
}

/** 3 by 4 keys, 64px, 24px corners, 14% white, digits only. The bottom left takes an optional key (Face ID). */
export function Keypad({onDigit, onDelete, deleteLabel, left, disabled = false}: {
  onDigit: (digit: string) => void; onDelete: () => void; deleteLabel: string; left?: ReactNode; disabled?: boolean;
}) {
  const key = (digit: string) => (
    <button key={digit} type="button" disabled={disabled} onClick={() => onDigit(digit)}
      className="fge-press flex h-16 flex-1 cursor-pointer items-center justify-center rounded-key bg-white/14 text-keypad text-snow-white">
      {digit}
    </button>
  );
  return (
    <div className="flex flex-col gap-2.5 px-1" data-keypad="">
      {[["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]].map((row) => (
        <div key={row[0]} className="flex gap-3">{row.map(key)}</div>
      ))}
      <div className="flex gap-3">
        <div className="flex h-16 flex-1 items-center justify-center">{left}</div>
        {key("0")}
        <button type="button" disabled={disabled} onClick={onDelete} aria-label={deleteLabel}
          className="fge-press flex h-16 flex-1 cursor-pointer items-center justify-center rounded-key text-snow-white">
          <Icon name="backspace" size={30} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/**
 * The slots and the keypad together, controlled. Typing on a hardware keyboard works too.
 * `name` adds a hidden input so the PIN goes with a form.
 */
export function PinPad({value, onChange, onComplete, slotsLabel, deleteLabel, bad = false, shakeKey, name, left, disabled}: {
  value: string; onChange: (value: string) => void; onComplete?: (pin: string) => void; slotsLabel: string; deleteLabel: string;
  bad?: boolean; shakeKey?: number; name?: string; left?: ReactNode; disabled?: boolean;
}) {
  const latest = useRef({value, onChange, onComplete, disabled});
  const pressRef = useRef<(digit: string) => void>(() => {});
  useEffect(() => {
    latest.current = {value, onChange, onComplete, disabled};
  });

  useEffect(() => {
    const press = (digit: string) => {
      const {value: current, onChange: change, onComplete: complete, disabled: off} = latest.current;
      if (off || current.length >= PIN_LENGTH) return;
      const next = current + digit;
      haptic("tick");
      change(next);
      if (next.length === PIN_LENGTH) complete?.(next);
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") latest.current.onChange(latest.current.value.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    pressRef.current = press;
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {name && <input type="hidden" name={name} value={value} />}
      <PinSlots filled={value.length} bad={bad} shakeKey={shakeKey} label={slotsLabel} />
      <Keypad onDigit={(digit) => pressRef.current(digit)} onDelete={() => onChange(value.slice(0, -1))}
        deleteLabel={deleteLabel} left={left} disabled={disabled} />
    </div>
  );
}
