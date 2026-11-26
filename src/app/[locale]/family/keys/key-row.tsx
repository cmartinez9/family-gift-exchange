"use client";

import Image from "next/image";
import {useState, useTransition} from "react";
import {useFormatter, useTranslations} from "next-intl";
import type {KeyKind} from "@/server/auth/access";
import {AuthFeedback} from "../../sign-in/controls";
import {activityDateFormat, buttonClass, linkClass} from "../../sign-in/styles";
import type {AuthResult} from "../../sign-in/actions";
import {prepareKey, sentKey, type Prepared} from "../actions";

export function KeyRow({id, name, joined, initiallySent, requestedAt}: {
  id: string; name: string; joined: boolean; initiallySent: boolean; requestedAt?: string;
}) {
  const t = useTranslations("auth");
  const format = useFormatter();
  const [pending, transition] = useTransition();
  const [prepared, setPrepared] = useState<Prepared>({});
  const [feedback, setFeedback] = useState<AuthResult>({});
  const [sent, setSent] = useState(initiallySent);
  const key = prepared.key;

  function prepare(kind: KeyKind) {
    setFeedback({});
    transition(async () => setPrepared(await prepareKey(id, kind)));
  }

  async function recordSent() {
    if (!key) return;
    const result = await sentKey(key.id);
    setFeedback(result);
    if (result.success) setSent(true);
  }

  function share() {
    if (!key) return;
    if (typeof navigator.share !== "function") {
      setFeedback({error: "shareUnavailable"});
      return;
    }
    transition(async () => {
      try {
        await navigator.share({text: key.message});
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) setFeedback({error: "shareUnavailable"});
        return;
      }
      await recordSent();
    });
  }

  return (
    <li id={`member-${id}`} className={`space-y-3 border-b border-current/25 pb-4 ${key?.qr ? "print:break-inside-avoid" : "print:hidden"}`}>
      <h2 className="text-xl font-semibold">{name}</h2>
      <p className="print:hidden">{t(`status.${joined ? "joined" : sent ? "sent" : "invited"}`)}</p>
      <div className="space-y-3 print:hidden">
        {!joined ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={pending} onClick={() => prepare("share")}>{t("prepareKey")}</button>
            <button type="button" className={linkClass} disabled={pending} onClick={() => prepare("qr")}>{t("showQr")}</button>
            <button type="button" className={linkClass} disabled={pending} onClick={() => prepare("print")}>{t("printCard")}</button>
          </div>
        ) : (
          <details className="space-y-2">
            <summary className={linkClass}>{t("resetPin")}</summary>
            <p>{requestedAt ? t("requestAt", {at: format.dateTime(new Date(requestedAt), activityDateFormat)}) : t("noResetRequest")}</p>
            <p>{t("resetConfirm")}</p>
            <button type="button" className={buttonClass} disabled={pending} onClick={() => prepare("reset")}>{t("prepareReset")}</button>
          </details>
        )}
        <AuthFeedback state={prepared} />
      </div>
      {key && (
        <div className="space-y-2 rounded border border-current p-3">
          <p className="[overflow-wrap:anywhere]">{key.message}</p>
          <p>{t("codeOnCard", {code: key.code})}</p>
          <p className="break-all">{t("familyAddressOnCard", {url: key.familyAddress})}</p>
          <p>{t("expires", {at: format.dateTime(new Date(key.expiresAt), activityDateFormat)})}</p>
          {key.qr && <Image unoptimized src={key.qr} width={320} height={320} alt={t("keyQr")} />}
          <div className="flex flex-wrap gap-3 print:hidden">
            <button type="button" className={buttonClass} disabled={pending} onClick={share}>{t("send")}</button>
            <a className={linkClass} href={`https://wa.me/?text=${encodeURIComponent(key.message)}`}
              target="_blank" rel="noopener noreferrer" onClick={() => transition(recordSent)}>{t("sendWhatsapp")}</a>
            <button type="button" className={linkClass} disabled={pending} onClick={() => transition(recordSent)}>{t("markSent")}</button>
            {key.qr && <button type="button" className={linkClass} onClick={() => window.print()}>{t("print")}</button>}
          </div>
          <div className="print:hidden"><AuthFeedback state={feedback} /></div>
        </div>
      )}
    </li>
  );
}
