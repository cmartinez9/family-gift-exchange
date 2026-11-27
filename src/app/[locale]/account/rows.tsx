"use client";

import {useActionState, useRef, useState, useTransition, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import {useRouter} from "@/i18n/navigation";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton} from "@/components/ui/button";
import {Chevron, ListRow} from "@/components/ui/card";
import {Icon, type IconName} from "@/components/ui/icon";
import {Switch} from "@/components/ui/inputs";
import {DURATION, EASE} from "@/components/ui/motion/easing";
import {haptic} from "@/components/ui/motion/haptic";
import {prefersReducedMotion} from "@/components/ui/motion/reduced-motion";
import {Sheet} from "@/components/ui/sheet";
import {toast} from "@/components/ui/toast";
import {Bullet, useFaceId} from "../sign-in/get-in";
import type {AuthResult} from "../sign-in/actions";
import {faceIdOff, reportEvent, setLanguage, signOut, signOutPhone} from "./actions";
import styles from "./rows.module.css";

/** The leading 44px ink disc of a settings row. */
const DISC_TONE = {
  ink: "bg-ink text-snow-white",
  track: "bg-[var(--track)] text-ink",
  /** a notice you have not read yet */
  red: "bg-sweater-red text-snow-white",
} as const;

export function RowDisc({icon, tone = "ink"}: {icon: IconName; tone?: keyof typeof DISC_TONE}) {
  return (
    <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-full ${DISC_TONE[tone]}`}>
      <Icon name={icon} size={20} strokeWidth={2.3} />
    </span>
  );
}

/** A settings row that opens a sheet instead of a page. */
function SheetRow({icon, title, sub, sheetTitle, children}: {
  icon: IconName; title: string; sub?: string; sheetTitle: string; children: ReactNode;
}) {
  const ui = useTranslations("ui");
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" className="fge-press block w-full cursor-pointer rounded-[20px] text-left" onClick={() => setOpen(true)}>
        <ListRow as="span" className={styles.row} lead={<RowDisc icon={icon} />} title={title} sub={sub} trail={<Chevron />} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={sheetTitle} closeLabel={ui("close")}>{children}</Sheet>
    </li>
  );
}

/** Language: a sheet with the two languages; the app follows the choice everywhere. */
export function LanguageRow({current}: {current: "en" | "es"}) {
  const t = useTranslations("getIn.language");
  const you = useTranslations("getIn.you");
  return (
    <SheetRow icon="globe" title={you("language")} sub={t(current)} sheetTitle={t("title")}>
      {(["en", "es"] as const).map((language) => (
        <form key={language} action={setLanguage.bind(null, language)}>
          <Button type="submit" variant={language === current ? "card" : "soft"} lang={language}
            icon={language === current ? "check" : undefined} aria-current={language === current ? "true" : undefined}>
            {t(language)}
          </Button>
        </form>
      ))}
    </SheetRow>
  );
}

/** Sign out everywhere (11.3, 11.4): the outline button and its confirm sheet. */
export function SignOutEverywhere({name}: {name: string}) {
  const t = useTranslations("getIn.phones");
  const ui = useTranslations("ui");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>{t("signOutAll")}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("sheetTitle")} closeLabel={ui("close")}>
        <ul className="flex flex-col gap-3.5">
          <Bullet icon="phone">{t("sheetAll", {name})}</Bullet>
          <Bullet icon="lock">{t("sheetSafe")}</Bullet>
        </ul>
        <ActForm action={signOut.bind(null, true)}>
          <Button type="submit" variant="danger">{t("signOutAll")}</Button>
        </ActForm>
        <TextButton className="self-center" onClick={() => setOpen(false)}>{t("cancel")}</TextButton>
      </Sheet>
    </>
  );
}

type DeviceKind = "iphone" | "ipad" | "android" | "computer" | "other";
const deviceKind = (kind: string): DeviceKind => (["iphone", "ipad", "android", "computer"].includes(kind) ? kind : "other") as DeviceKind;

/**
 * Another phone on Your phones (11.3), with its own Sign out. Only that phone is signed out; this one stays.
 * The row slips left and folds away while the server signs it out, and comes back if it couldn't.
 */
export function PhoneRow({sessionId, kind, title, sub, lead, className}: {
  sessionId: string; kind: string; title: string; sub: string; lead: ReactNode; className?: string;
}) {
  const t = useTranslations("getIn.phones");
  const feedback = useTranslations("auth.feedback");
  const row = useRef<HTMLLIElement>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function leave(element: HTMLLIElement) {
    if (typeof element.animate !== "function") return null;
    const height = `${element.offsetHeight}px`;
    element.style.overflow = "hidden";
    const frames: Keyframe[] = prefersReducedMotion()
      ? [{opacity: 1}, {opacity: 0}]
      : [
        {opacity: 1, transform: "none", height},
        {opacity: 0, transform: "translateX(-28px)", height, offset: 0.5},
        {opacity: 0, transform: "translateX(-28px)", height: "0px", borderTopWidth: "0px"},
      ];
    return element.animate(frames, {duration: prefersReducedMotion() ? DURATION.reduced : 340, easing: EASE.interface, fill: "forwards"});
  }

  function signOutThis() {
    const element = row.current;
    if (!element) return;
    setError(null);
    haptic("light");
    start(async () => {
      const motion = leave(element);
      const [result] = await Promise.all([
        signOutPhone(sessionId).catch((): AuthResult => ({error: "connectionFailed"})),
        motion?.finished.catch(() => undefined),
      ]);
      if (result.error) {
        motion?.cancel();
        element.style.overflow = "";
        haptic("error");
        setError(feedback(result.error as Parameters<typeof feedback>[0]));
        return;
      }
      setGone(true);
      // the button is gone with its row: keep focus on the list rather than the top of the page
      const next = element.nextElementSibling?.querySelector("button") ?? element.previousElementSibling;
      if (next instanceof HTMLElement) {
        if (!next.matches("button")) next.tabIndex = -1;
        next.focus({preventScroll: true});
      }
      toast(t("signedOut", {kind: deviceKind(kind)}));
    });
  }

  return (
    <li ref={row} hidden={gone}>
      <ListRow className={className} lead={lead} title={title} sub={sub}
        trail={(
          <Button variant="smallSoft" onClick={signOutThis} disabled={pending}
            aria-label={t("signOutLabel", {kind: deviceKind(kind), when: sub})}>
            {t("signOut")}
          </Button>
        )} />
      {error && <div className="pb-3"><ErrorBlock title={error} /></div>}
    </li>
  );
}

/** Asks the phone to forget passkeys the app no longer accepts, where it can (Safari and Chrome can). */
function forgetCredentials(ids: readonly string[] = []) {
  const signal = (globalThis.PublicKeyCredential as unknown as {
    signalUnknownCredential?: (options: {rpId: string; credentialId: string}) => Promise<void>;
  } | undefined)?.signalUnknownCredential;
  for (const credentialId of ids) {
    signal?.call(globalThis.PublicKeyCredential, {rpId: location.hostname, credentialId}).catch(() => undefined);
  }
}

/**
 * Face ID on You (11.1): a switch for this phone. Off removes this phone's passkey and keeps the PIN; on
 * runs the usual Face ID setup. The line under the title says the state in words.
 */
export function FaceIdRow({on, device, className}: {on: boolean; device: string; className?: string}) {
  const t = useTranslations("getIn.you");
  const auth = useTranslations("auth");
  const feedback = useTranslations("auth.feedback");
  const router = useRouter();
  const [checked, setChecked] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [turningOff, startOff] = useTransition();
  const setup = useFaceId(true, () => {
    toast(t("faceTurnedOn", {device}));
    router.refresh();
  }, () => setChecked(false));

  function change(next: boolean) {
    setError(null);
    setChecked(next);
    if (next) {
      setup.begin();
      return;
    }
    startOff(async () => {
      const result = await faceIdOff().catch((): AuthResult => ({error: "connectionFailed"}));
      if (result.error) {
        setChecked(true);
        haptic("error");
        setError(feedback(result.error as Parameters<typeof feedback>[0]));
        return;
      }
      forgetCredentials("credentials" in result ? result.credentials : []);
      haptic("light");
      toast(t("faceTurnedOff", {device}));
    });
  }

  return (
    <li>
      <ListRow className={className} lead={<RowDisc icon="faceid" />} title={t("faceId")}
        sub={checked ? t("faceOn", {device}) : t("faceOff", {device})}
        trail={<Switch checked={checked} onCheckedChange={change} label={t("faceId")} disabled={setup.pending || turningOff} />} />
      {setup.failed && !checked && <div className="pb-3"><ErrorBlock title={auth("faceUnavailable")} /></div>}
      {error && <div className="pb-3"><ErrorBlock title={error} /></div>}
    </li>
  );
}

/** A form around a server action that may say why it could not finish. */
export function ActForm({action, className, children}: {action: () => Promise<AuthResult>; className?: string; children: ReactNode}) {
  const feedback = useTranslations("auth.feedback");
  const [state, submit] = useActionState(async () => action(), {} as AuthResult);
  return (
    <form action={submit} className={className}>
      {children}
      {state.error && <ErrorBlock title={feedback(state.error as Parameters<typeof feedback>[0])} />}
    </form>
  );
}

/** "That wasn't me" (11.5): reports the event; the server signs out what it reached and comes back here. */
export function NotMeButton({eventId}: {eventId: string}) {
  const t = useTranslations("getIn.wasThat");
  const feedback = useTranslations("auth.feedback");
  const [state, submit, pending] = useActionState(async () => reportEvent(eventId), {} as AuthResult);
  return (
    <form action={submit} className="flex flex-col gap-2">
      {state.error && <ErrorBlock title={feedback(state.error as Parameters<typeof feedback>[0])} />}
      <Button type="submit" disabled={pending}>{t("notMe")}</Button>
    </form>
  );
}
