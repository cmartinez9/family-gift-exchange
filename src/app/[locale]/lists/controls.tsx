"use client";

import {useActionState, useEffect, useRef, useState, useTransition, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import {Button, TextButton, type ButtonVariant} from "@/components/ui/button";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import {toast} from "@/components/ui/toast";
import type {Feedback, FormState} from "./action-types";

/** A problem in words, with the alert icon; or nothing. Saved feedback is a toast. */
export function FormFeedback({error, className}: {error?: Feedback; className?: string}) {
  const t = useTranslations("lists");
  if (!error) return null;
  return (
    <p role="alert" className={cn("flex items-start gap-2.5 text-body font-semibold", className)}>
      <Icon name="alert" size={22} strokeWidth={2.4} className="mt-px" />
      <span>{t(`feedback.${error}`)}</span>
    </p>
  );
}

export function ListForm({
  action, label, variant = "card", text = false, icon, className, children,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  label: string;
  variant?: ButtonVariant;
  /** An underlined text button instead of a pill. */
  text?: boolean;
  icon?: Parameters<typeof Button>[0]["icon"];
  className?: string;
  children?: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const t = useTranslations("lists");
  useEffect(() => {
    if (state.status === "saved") toast(t("saved"));
  }, [state, t]);
  return (
    <form action={dispatch} className={cn("flex flex-col gap-3", className)}>
      {children}
      {text
        ? <TextButton type="submit" disabled={pending} className="-ml-3 self-start">{pending ? t("saving") : label}</TextButton>
        : <Button type="submit" variant={variant} icon={icon} disabled={pending}>{pending ? t("saving") : label}</Button>}
      <FormFeedback error={state.error} />
    </form>
  );
}

/**
 * Bought and Wrapped: a pill on the card's track with a tick. A real checkbox underneath, so it reads
 * and works as one; the tick saves at once and steps back if the save fails.
 */
export function ChecklistTick({
  label, checked, action, onPine = false,
}: {
  label: string;
  checked: boolean;
  /** On a pine card the tick is a white disc with a pine check. */
  onPine?: boolean;
  action: (checked: boolean, state: FormState) => Promise<FormState>;
}) {
  const [current, setCurrent] = useState(checked);
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label className={cn("fge-press relative flex min-h-[52px] cursor-pointer items-center gap-3 rounded-pill bg-[var(--track)] py-2 pr-4 pl-2.5 text-body-strong",
        "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-[var(--focus)]")}>
        <input
          type="checkbox" checked={current} disabled={pending} className="absolute inset-0 cursor-pointer rounded-pill opacity-0"
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setCurrent(next);
            if (next) haptic("tick");
            startTransition(async () => {
              const result = await action(next, {});
              if (result.error) setCurrent(!next);
              setState(result);
            });
          }}
        />
        <TickMark done={current} onPine={onPine} />
        <span>{label}</span>
      </label>
      <FormFeedback error={state.error} />
    </div>
  );
}

/** The tick in a pill. Neutral means neutral: ink on a light card, white on a pine one. */
function TickMark({done, onPine}: {done: boolean; onPine: boolean}) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-[34px] shrink-0 items-center justify-center rounded-full",
      done ? (onPine ? "bg-snow-white text-pine" : "bg-ink text-snow-white") : cn("border-[2.5px]", onPine ? "border-white/45" : "border-ink/30"))}>
      {done && <Icon name="check" size={20} strokeWidth={3} />}
    </span>
  );
}

/**
 * A toast the page asks for after a redirect ("Added to your list"), then the address drops the ask so a
 * reload does not repeat it.
 */
export function FlashToast({message}: {message: string | null}) {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!message || shown.current === message) return;
    shown.current = message;
    haptic("success");
    toast(message);
    // drop the ask from the address without navigating again
    const url = new URL(window.location.href);
    url.searchParams.delete("done");
    window.history.replaceState(window.history.state, "", url);
  }, [message]);
  return null;
}
