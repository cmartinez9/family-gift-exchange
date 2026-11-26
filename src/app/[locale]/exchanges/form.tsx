"use client";

import {useActionState, type ReactNode} from "react";
import type {FormState} from "./actions";
import {button} from "./styles";

export function DrawForm({action, label, children}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  label: string;
  children?: ReactNode;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="space-y-3">
      {children}
      {state.error && <p role="alert">{state.error}</p>}
      {state.feedback && <p role="status">{state.feedback}</p>}
      <button type="submit" className={button} disabled={pending}>{label}</button>
    </form>
  );
}
