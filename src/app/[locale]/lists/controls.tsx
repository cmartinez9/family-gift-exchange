"use client";

import {useActionState, useState, useTransition, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import type {Feedback, FormState} from "./action-types";
import {buttonClass, linkClass} from "./styles";

export function FormFeedback({error, saved}: {error?: Feedback; saved?: boolean}) {
  const t = useTranslations("lists");
  if (error) return <p role="alert">{t(`feedback.${error}`)}</p>;
  return saved ? <p role="status">{t("saved")}</p> : null;
}

export function ListForm({
  action, label, secondary, children,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  label: string;
  secondary?: boolean;
  children?: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  const t = useTranslations("lists");
  return (
    <form action={dispatch} className={children ? "space-y-3" : undefined}>
      {children}
      <button className={secondary ? linkClass : buttonClass} disabled={pending}>
        {pending ? t("saving") : label}
      </button>
      <FormFeedback error={state.error} saved={state.status === "saved"} />
    </form>
  );
}

export function ChecklistTick({
  label, checked, action,
}: {
  label: string;
  checked: boolean;
  action: (checked: boolean, state: FormState) => Promise<FormState>;
}) {
  const [current, setCurrent] = useState(checked);
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <label className="inline-flex min-h-12 cursor-pointer items-center gap-3">
        <input
          type="checkbox" checked={current} disabled={pending} className="size-6 accent-foreground"
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setCurrent(next);
            startTransition(async () => {
              const result = await action(next, {});
              if (result.error) setCurrent(!next);
              setState(result);
            });
          }}
        />
        {label}
      </label>
      <FormFeedback error={state.error} />
    </div>
  );
}
