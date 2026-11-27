"use client";

import {useTranslations} from "next-intl";
import {useActionState, useEffect, type ReactNode} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, type ButtonVariant} from "@/components/ui/button";
import {cn} from "@/components/ui/cn";
import type {IconName} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import type {AuthResult} from "../sign-in/actions";

/**
 * A family form: the fields, the action, and what happened, said in place (a gold card for a problem,
 * a quiet line for "Saved").
 */
export function FamilyForm({action, label, children, variant = "card", icon, className}: {
  action: (state: AuthResult, data: FormData) => Promise<AuthResult>;
  label: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  className?: string;
}) {
  const t = useTranslations("auth");
  const [state, submit, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.success) haptic("success");
    else if (state.error) haptic("error");
  }, [state]);
  return (
    <form action={submit} className={cn("flex flex-col gap-3", className)}>
      {children}
      <Button type="submit" variant={variant} icon={icon} disabled={pending}>{label}</Button>
      {state.error && <ErrorBlock title={t(`feedback.${state.error}` as Parameters<typeof t>[0])} />}
      {state.success && <p role="status" className="text-center text-body font-semibold text-[var(--fg-muted)]">
        {t(`feedback.${state.success}` as Parameters<typeof t>[0])}</p>}
    </form>
  );
}

const FIELD = "h-14 w-full cursor-pointer appearance-none rounded-pill border-0 bg-[var(--track,var(--card-track))] px-5 text-lead font-semibold text-ink "
  + "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink";

/** A labelled choice on a track-tone pill. */
export function SelectField({label, name, defaultValue, children, required}: {
  label: string; name: string; defaultValue?: string; children: ReactNode; required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-body font-bold text-[var(--fg-muted)]">
      {label}
      <select className={FIELD} name={name} defaultValue={defaultValue} required={required}>{children}</select>
    </label>
  );
}
