"use client";

import {useActionState, useEffect, useId, useRef, type ReactNode} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, type ButtonVariant} from "@/components/ui/button";
import {cn} from "@/components/ui/cn";
import type {IconName} from "@/components/ui/icon";
import {haptic} from "@/components/ui/motion/haptic";
import {Screen} from "@/components/ui/screen";
import {toast} from "@/components/ui/toast";
import type {FormState} from "./actions";

/**
 * A draw action as a form. A refusal shows as a gold card that names the problem; success shows the one
 * toast, or stays on the page (`feedback="inline"`) when the answer is the point (a test draw).
 */
export function DrawForm({action, label, children, variant = "card", icon, feedback = "toast", className, onDone, buttonClassName}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  label: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  feedback?: "toast" | "inline";
  className?: string;
  buttonClassName?: string;
  /** Called after a success, once the toast is up. */
  onDone?: (state: FormState) => void;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!state.feedback) return;
    haptic("success");
    if (feedback === "toast") toast(state.feedback);
    done.current?.(state);
  }, [state, feedback]);
  return (
    <form action={submit} className={cn("flex flex-col gap-3", className)}>
      {children}
      {state.error && <ErrorBlock title={state.error} />}
      {feedback === "inline" && state.feedback && <p role="status" className="text-body font-semibold">{state.feedback}</p>}
      <Button type="submit" variant={variant} icon={icon} disabled={pending} className={buttonClassName}>{label}</Button>
    </form>
  );
}

/**
 * A screen that is one form: the fields scroll, and the main action sits at the bottom on the ground
 * (linked to the form), the way every setup step ends in "Next".
 */
export function FormScreen({action, label, icon = "arrow", top, children, back, after, below, feedback = "toast"}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  label: string;
  icon?: IconName;
  /** Everything above the form: back row, step bar, title. */
  top: ReactNode;
  children: ReactNode;
  back?: string;
  /** Under the main action: a line, or a quieter way out. */
  after?: ReactNode;
  /** Under the form, outside it: rarer tools with forms of their own. */
  below?: ReactNode;
  feedback?: "toast" | "inline";
}) {
  const [state, submit, pending] = useActionState(action, {});
  const id = useId();
  useEffect(() => {
    if (!state.feedback) return;
    haptic("success");
    if (feedback === "toast") toast(state.feedback);
  }, [state, feedback]);
  useEffect(() => {
    if (state.error) haptic("error");
  }, [state]);
  return (
    <Screen back={back} actions={<>
      <Button type="submit" form={id} icon={icon} disabled={pending}>{label}</Button>
      {after}
    </>}>
      {top}
      <form id={id} action={submit} className="flex flex-col gap-3 px-edge pt-6 pb-6">
        {children}
        {state.error && <ErrorBlock title={state.error} />}
        {feedback === "inline" && state.feedback && <p role="status" className="text-body font-semibold">{state.feedback}</p>}
      </form>
      {below && <div className="flex flex-col gap-3 px-edge pb-6">{below}</div>}
    </Screen>
  );
}
