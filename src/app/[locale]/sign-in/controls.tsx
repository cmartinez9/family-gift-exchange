"use client";

import {useActionState, useEffect, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import {useRouter} from "@/i18n/navigation";
import type {AuthResult} from "./actions";
import {buttonClass, inputClass} from "./styles";

export function RefreshSession() {
  const router = useRouter();
  useEffect(() => {router.refresh();}, [router]);
  return null;
}

export function AuthFeedback({state}: {state: AuthResult}) {
  const t = useTranslations("auth");
  if (state.error) return <p role="alert">{t(`feedback.${state.error}` as Parameters<typeof t>[0])}</p>;
  if (state.success) return <p role="status">{t(`feedback.${state.success}` as Parameters<typeof t>[0])}</p>;
  return null;
}

export function AuthForm({action, label, children}: {
  action: (state: AuthResult, data: FormData) => Promise<AuthResult>; label: string; children?: ReactNode;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="space-y-3">
      {children}
      <button type="submit" className={buttonClass} disabled={pending}>{label}</button>
      <AuthFeedback state={state} />
    </form>
  );
}

export function PinFields({create = false}: {create?: boolean}) {
  const t = useTranslations("auth");
  return (
    <>
      <label className="block">
        {t("pin")}
        <input name="pin" className={inputClass} type="password" autoComplete={create ? "new-password" : "current-password"}
          inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required />
      </label>
      {create && (
        <label className="block">
          {t("confirmPin")}
          <input name="confirmation" className={inputClass} type="password" autoComplete="new-password"
            inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required />
        </label>
      )}
    </>
  );
}
