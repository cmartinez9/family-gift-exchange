"use client";

import {useActionState, useState, type ReactNode} from "react";
import {useTranslations} from "next-intl";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton} from "@/components/ui/button";
import {Chevron, ListRow} from "@/components/ui/card";
import {Icon, type IconName} from "@/components/ui/icon";
import {Sheet} from "@/components/ui/sheet";
import {Bullet} from "../sign-in/get-in";
import type {AuthResult} from "../sign-in/actions";
import {reportEvent, setLanguage, signOut} from "./actions";
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
