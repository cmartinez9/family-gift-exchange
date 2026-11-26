"use client";

import {useId, type ButtonHTMLAttributes} from "react";
import {cn} from "./cn";
import {haptic} from "./motion/haptic";

const CHIP = "fge-press inline-flex h-12 min-w-12 items-center justify-center rounded-pill px-3 text-body-strong whitespace-nowrap cursor-pointer";
// Neutral means neutral: a picked chip is ink, never pine or gold.
const OFF = "bg-[var(--track,var(--card-track))] text-ink";
const ON = "bg-ink text-snow-white";

/** A 48px toggle chip (a suggestion, a filter). */
export function Chip({pressed = false, onPressedChange, className, children, onClick, ...rest}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  pressed?: boolean; onPressedChange?: (pressed: boolean) => void;
}) {
  return (
    <button type="button" aria-pressed={pressed} className={cn(CHIP, pressed ? ON : OFF, className)}
      onClick={(event) => {
        onClick?.(event);
        haptic("tick");
        onPressedChange?.(!pressed);
      }} {...rest}>
      {children}
    </button>
  );
}

/**
 * One choice from a row of chips (sizes). Real radio buttons underneath, so arrow keys and forms work.
 */
export function ChoiceChips({legend, name, options, value, onChange, className, legendClassName}: {
  legend: string; name: string; options: ReadonlyArray<{value: string; label: string}>; value?: string | null;
  onChange?: (value: string) => void; className?: string; legendClassName?: string;
}) {
  const id = useId();
  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className={cn("mb-2 text-body font-extrabold", legendClassName)}>{legend}</legend>
      <div className="flex gap-1.5">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label key={option.value} className={cn(CHIP, "min-w-0 flex-1 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[var(--focus,var(--color-ink))]", checked ? ON : OFF)}>
              <input type="radio" className="sr-only" name={name} id={`${id}-${option.value}`} value={option.value} checked={checked}
                onChange={() => {
                  haptic("tick");
                  onChange?.(option.value);
                }} />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
