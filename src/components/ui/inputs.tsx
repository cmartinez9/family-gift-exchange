"use client";

import {useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes} from "react";
import {cn} from "./cn";
import {Icon} from "./icon";

const FIELD = "block w-full rounded-pill border-0 px-5 text-lead font-semibold text-ink placeholder:font-normal placeholder:text-muted-ink "
  + "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--focus,var(--color-ink))]";

function Label({htmlFor, children, hint, hintId}: {htmlFor: string; children: ReactNode; hint?: ReactNode; hintId: string}) {
  return (
    <>
      <label htmlFor={htmlFor} className="text-body font-bold text-[var(--fg-muted,var(--color-muted-ink))]">{children}</label>
      {hint && <p id={hintId} className="text-body text-[var(--fg-muted,var(--color-muted-ink))]">{hint}</p>}
    </>
  );
}

/**
 * A 56px field on the card's track tone, 19px text. `surface="white"` for the one field that sits
 * straight on a yarn-white card (the first thing on your list).
 */
export function TextField({label, hint, surface = "track", className, id, ...rest}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: ReactNode; hint?: ReactNode; surface?: "track" | "white";
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={inputId} hint={hint} hintId={hintId}>{label}</Label>
      <input id={inputId} aria-describedby={hint ? hintId : undefined}
        className={cn(FIELD, "h-14", surface === "white" ? "bg-snow-white" : "bg-[var(--track,var(--card-track))]")} {...rest} />
    </div>
  );
}

export function TextArea({label, hint, className, id, rows = 3, ...rest}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode; hint?: ReactNode;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={inputId} hint={hint} hintId={hintId}>{label}</Label>
      <textarea id={inputId} rows={rows} aria-describedby={hint ? hintId : undefined}
        className={cn(FIELD, "min-h-[104px] resize-none rounded-[24px] bg-[var(--track,var(--card-track))] px-[18px] py-4")} {...rest} />
    </div>
  );
}

/** A 56 by 34 switch, ink when on. Neutral means neutral: never pine or gold. */
export function Switch({checked, onCheckedChange, label, className, disabled}: {
  checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; className?: string; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("fge-switch fge-press flex h-[34px] w-14 shrink-0 cursor-pointer items-center rounded-pill p-[3px] transition-colors duration-200",
        checked ? "bg-ink" : "bg-switch-off", className)}>
      <span className="fge-knob size-7 rounded-full bg-snow-white" />
    </button>
  );
}

/** A tick: an ink disc with a white check when done, an empty ring when not. */
export function Tick({done, size = 32, label}: {done: boolean; size?: number; label?: string}) {
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", done ? "bg-ink text-snow-white" : "border-[2.5px] border-ink/30")}
      style={{width: size, height: size}}>
      {done && <Icon name="check" size={Math.round(size * 0.6)} strokeWidth={3} />}
    </span>
  );
}
