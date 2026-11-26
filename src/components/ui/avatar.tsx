import type {ComponentProps} from "react";
import {cn} from "./cn";
import {AppLink} from "./navigation";

/** The first letter of a name, as the avatar shows it. */
export function initialOf(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase() ?? "?";
}

/**
 * A soft disc with the person's initial in ink (Rubik 800 at 44% of the size). Neutral on purpose, so
 * colour keeps its meaning: the card's track tone on a card, yarn white on the ground. 44 to 64px.
 * Decorative: the name always sits next to it.
 */
export function Avatar({name, size = 48, on = "card", className}: {
  name: string; size?: number; on?: "card" | "ground"; className?: string;
}) {
  return (
    <span aria-hidden="true" data-avatar={on}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-ink",
        on === "ground" ? "bg-yarn-white" : "bg-[var(--track,var(--card-track))]", className)}
      style={{width: size, height: size, fontSize: Math.round(size * 0.44), lineHeight: `${size}px`}}>
      {initialOf(name)}
    </span>
  );
}

/** You: your own avatar at Home's top right. It opens settings; a gold dot means something is new. */
export function YouButton({name, label, newLabel, hasNew = false, className, ...rest}: Omit<ComponentProps<typeof AppLink>, "children"> & {
  name: string; label: string; newLabel?: string; hasNew?: boolean;
}) {
  return (
    <AppLink transition="push" className={cn("fge-press relative inline-flex size-12 shrink-0 rounded-full", className)} {...rest}>
      <Avatar name={name} on="ground" />
      <span className="sr-only">{hasNew && newLabel ? `${label}, ${newLabel}` : label}</span>
      {hasNew && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-gold shadow-[0_0_0_3px_var(--color-sweater-red)]" />}
    </AppLink>
  );
}
