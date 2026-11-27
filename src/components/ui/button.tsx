import type {ButtonHTMLAttributes, ComponentProps, ReactNode} from "react";
import {cn} from "./cn";
import {Icon, type IconName} from "./icon";
import {AppLink} from "./navigation";

/**
 * ground: the one main action on the red or pine ground — white pill, 64px, ink 20px label. One per screen.
 * outline: a real alternative on the ground — transparent, 2px border at 60% white, 60px.
 * card: the action inside a card or sheet — ink pill, 52px, 18px label.
 * small: row actions (Send, Nudge, I'm getting this) — ink pill, 48px.
 * smallSoft: a quieter row action on a card's track tone (Sign out on Your phones) — track pill, 48px.
 * danger: only inside a confirm sheet, for what cannot be undone — 56px.
 * soft: a secondary pill on a card's track tone, 52px.
 * Heights are minimums so labels can wrap on narrow cards. At the largest text size a button's icon
 * stacks over its label, as the tab bar's do, and the sides tighten (the corners soften to match, so a
 * label of two or three lines stays inside the shape): a label wraps between words, never inside one.
 */
export type ButtonVariant = "ground" | "outline" | "card" | "small" | "smallSoft" | "danger" | "soft";

const BASE = "fge-press inline-flex max-w-full shrink-0 items-center justify-center gap-2.5 rounded-pill py-2 whitespace-normal cursor-pointer "
  + "disabled:cursor-default aria-disabled:cursor-default";

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  ground: "min-h-16 w-full px-6 max-[299px]:px-2 max-[299px]:py-3 max-[299px]:rounded-[28px] max-[299px]:flex-col max-[299px]:gap-1 bg-snow-white text-ink text-button "
    + "disabled:bg-on-ground disabled:text-white/75 aria-disabled:bg-on-ground aria-disabled:text-white/75",
  outline: "min-h-[60px] w-full px-6 max-[299px]:px-2 max-[299px]:py-3 max-[299px]:rounded-[28px] max-[299px]:flex-col max-[299px]:gap-1 border-2 border-white/60 bg-transparent text-snow-white text-button",
  card: "min-h-[52px] w-full px-6 max-[299px]:px-2 max-[299px]:py-3 max-[299px]:rounded-[26px] max-[299px]:flex-col max-[299px]:gap-1 bg-ink text-snow-white text-body-strong "
    + "disabled:bg-[var(--track)] disabled:text-[var(--fg-muted)]",
  small: "min-h-12 self-start px-[18px] max-[299px]:px-3 max-[299px]:py-2.5 max-[299px]:rounded-[24px] max-[299px]:flex-col max-[299px]:gap-1 gap-2 bg-ink text-snow-white text-body-strong "
    + "disabled:bg-[var(--track)] disabled:text-[var(--fg-muted)]",
  smallSoft: "min-h-12 self-start px-[18px] max-[299px]:px-3 max-[299px]:py-2.5 max-[299px]:rounded-[24px] max-[299px]:flex-col max-[299px]:gap-1 gap-2 bg-[var(--track)] text-ink text-body-strong "
    + "disabled:text-[var(--fg-muted)]",
  danger: "min-h-14 w-full px-6 max-[299px]:px-2 max-[299px]:py-3 max-[299px]:rounded-[28px] max-[299px]:flex-col max-[299px]:gap-1 bg-danger text-snow-white text-body-strong",
  soft: "min-h-[52px] w-full px-3 bg-[var(--track)] text-ink text-body-strong",
};

const ICON_SIZE: Readonly<Record<ButtonVariant, number>> = {ground: 22, outline: 22, card: 22, small: 20, smallSoft: 20, danger: 22, soft: 22};

export function buttonClass(variant: ButtonVariant = "ground", className?: string): string {
  return cn(BASE, VARIANT[variant], className);
}

function Content({icon, variant, children}: {icon?: IconName; variant: ButtonVariant; children: ReactNode}) {
  return (
    <>
      {icon && <Icon name={icon} size={ICON_SIZE[variant]} strokeWidth={2.4} />}
      <span className="max-[299px]:text-center">{children}</span>
    </>
  );
}

export function Button({variant = "ground", icon, className, children, type = "button", ...rest}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; icon?: IconName;
}) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest}>
      <Content icon={icon} variant={variant}>{children}</Content>
    </button>
  );
}

/** A button-styled link, with a page transition. */
export function ButtonLink({variant = "ground", icon, className, children, ...rest}: ComponentProps<typeof AppLink> & {
  variant?: ButtonVariant; icon?: IconName;
}) {
  return (
    <AppLink className={buttonClass(variant, className)} {...rest}>
      <Content icon={icon} variant={variant}>{children}</Content>
    </AppLink>
  );
}

const LINK = "inline-flex min-h-12 items-center justify-center px-3 text-body font-semibold underline underline-offset-4 cursor-pointer";

/** Skip, later, cancel: underlined, 18px, 48px tall. Takes the colour of where it sits. */
export function TextButton({className, children, type = "button", ...rest}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(LINK, className)} {...rest}>{children}</button>;
}

export function TextLink({className, children, ...rest}: ComponentProps<typeof AppLink>) {
  return <AppLink className={cn(LINK, className)} {...rest}>{children}</AppLink>;
}

/**
 * The 48px discs that carry no word: back, close, heart. They always have a label for screen readers.
 * ground: 16% white on the red or pine ground. track: the card's or sheet's track tone. ink: ink.
 */
export type DiscTone = "ground" | "track" | "ink" | "white";

const DISC: Readonly<Record<DiscTone, string>> = {
  ground: "bg-on-ground text-snow-white",
  track: "bg-[var(--track,var(--card-track))] text-ink",
  ink: "bg-ink text-snow-white",
  white: "bg-snow-white text-pine",
};

export function discClass(tone: DiscTone = "track", className?: string) {
  return cn("fge-press inline-flex size-12 shrink-0 items-center justify-center rounded-full cursor-pointer", DISC[tone], className);
}

export function IconButton({icon, label, tone = "track", iconSize = 22, className, type = "button", ...rest}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName; label: string; tone?: DiscTone; iconSize?: number;
}) {
  return (
    <button type={type} aria-label={label} className={discClass(tone, className)} {...rest}>
      <Icon name={icon} size={iconSize} strokeWidth={2.4} />
    </button>
  );
}
