"use client";

import {useActionState, useState, useTransition, type ReactNode} from "react";
import {startAuthentication, startRegistration} from "@simplewebauthn/browser";
import {useFormatter, useTranslations} from "next-intl";
import {Link, useRouter} from "@/i18n/navigation";
import {
  beginFaceId, finishFaceIdEnrollment, finishFaceIdSignIn, forgotPin, previewCode, useKey, type AuthResult, type CodeResult,
} from "./actions";

import {activityDateFormat, buttonClass, inputClass, linkClass} from "./styles";

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

export function FaceIdButton({enroll = false, next = "/account"}: {enroll?: boolean; next?: string}) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, transition] = useTransition();

  function begin() {
    setFailed(false);
    transition(async () => {
      try {
        if (enroll) {
          const options = await beginFaceId(true);
          if (!options || !("user" in options)) throw new Error();
          if (!await finishFaceIdEnrollment(await startRegistration({optionsJSON: options}))) throw new Error();
        } else {
          const options = await beginFaceId(false);
          if (!options || "user" in options) throw new Error();
          if (!await finishFaceIdSignIn(await startAuthentication({optionsJSON: options}))) throw new Error();
        }
        router.replace(enroll ? next : "/account?face=1");
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={begin} disabled={pending} className={buttonClass}>
        {t(enroll ? "useFaceId" : "signInFaceId")}
      </button>
      {failed && <p role="alert">{t(enroll ? "faceUnavailable" : "faceSignInFailed")}</p>}
    </div>
  );
}

export function ResetButton({familyId, personId}: {familyId: string; personId: string}) {
  const t = useTranslations("auth");
  const [result, setResult] = useState<AuthResult>({});
  const [pending, transition] = useTransition();
  return (
    <details className="space-y-3">
      <summary className={linkClass}>{t("forgotPin")}</summary>
      <button type="button" className={buttonClass} disabled={pending || Boolean(result.success)}
        onClick={() => transition(async () => setResult(await forgotPin(familyId, personId)))}>
        {t("askReset")}
      </button>
      <AuthFeedback state={result} />
    </details>
  );
}

type KeyView = NonNullable<CodeResult["key"]>;
type KeyClaimProps = {familyId: string; value: string; typed: boolean; entry: KeyView};

export function KeyClaim({familyId, value, typed, entry}: KeyClaimProps) {
  const t = useTranslations("auth");
  const format = useFormatter();
  const [choice, setChoice] = useState<"me" | "helper" | null>(null);
  const returnUrl = `/sign-in?family=${familyId}&person=${entry.personId}`;
  if (entry.usedAt) {
    return (
      <div className="space-y-3">
        <p>{t("usedKeyWhen", {at: format.dateTime(new Date(entry.usedAt), activityDateFormat)})}</p>
        {entry.usedDevice && <p>{t("usedKeyDevice", {device: t(`device.${entry.usedDevice}` as Parameters<typeof t>[0])})}</p>}
        <Link className={linkClass} href={returnUrl}>{t("returningSignIn", {name: entry.name})}</Link>
        <ResetButton familyId={familyId} personId={entry.personId} />
      </div>
    );
  }
  if (!entry.available) return <AuthFeedback state={{error: "unavailable"}} />;
  return (
    <div className="space-y-3">
      <p>{entry.familyName}</p>
      <h2 className="text-2xl font-semibold">{t("isYourPhone", {name: entry.name})}</h2>
      {choice === null && (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonClass} onClick={() => setChoice("me")}>{t("yesMe", {name: entry.name})}</button>
          <button type="button" className={linkClass} onClick={() => setChoice("helper")}>{t("helping", {name: entry.name})}</button>
        </div>
      )}
      {choice === "helper" && (
        <>
          <p>{t("helperInstructions", {name: entry.name})}</p>
          <button type="button" className={linkClass} onClick={() => setChoice(null)}>{t("back")}</button>
        </>
      )}
      {choice === "me" && (
        <AuthForm action={useKey.bind(null, familyId, value, typed)} label={t("savePin")}>
          <p>{t("makePin")}</p>
          <PinFields create />
        </AuthForm>
      )}
    </div>
  );
}

export function EnterCode({familyId}: {familyId: string}) {
  const t = useTranslations("auth");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<CodeResult>({});
  const [pending, transition] = useTransition();

  if (result.key) return <KeyClaim familyId={familyId} value={code} typed entry={result.key} />;
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      transition(async () => setResult(await previewCode(familyId, code)));
    }}>
      <label className="block">
        {t("keyCode")}
        <input className={inputClass} name="code" value={code} maxLength={6} minLength={6} autoCapitalize="characters"
          autoComplete="off" spellCheck={false} required onChange={(event) => setCode(event.target.value.toUpperCase().trim())} />
      </label>
      <button type="submit" className={buttonClass} disabled={pending}>{t("checkCode")}</button>
      <AuthFeedback state={result} />
    </form>
  );
}
