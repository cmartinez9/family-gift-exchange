"use client";

import Image from "next/image";
import {useState, useTransition, type ReactNode} from "react";
import {useFormatter, useTranslations} from "next-intl";
import {Avatar} from "@/components/ui/avatar";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton} from "@/components/ui/button";
import {Card, IconDisc} from "@/components/ui/card";
import {Icon} from "@/components/ui/icon";
import {STITCH_CELL, StitchedText} from "@/components/ui/knit/stitched-text";
import {haptic} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {PageTitle} from "@/components/ui/page-header";
import {Sheet} from "@/components/ui/sheet";
import type {KeyKind} from "@/server/auth/access";
import {activityDateFormat} from "../../sign-in/styles";
import type {AuthResult} from "../../sign-in/actions";
import {prepareKey, sentKey, type Prepared} from "../actions";

export type KeyPerson = {id: string; name: string; joined: boolean; sent: boolean; requestedAt?: string};
type PreparedKey = NonNullable<Prepared["key"]>;

function Feedback({state}: {state: AuthResult}) {
  const t = useTranslations("auth");
  if (state.error) return <ErrorBlock title={t(`feedback.${state.error}` as Parameters<typeof t>[0])} />;
  if (state.success) return <p role="status" className="text-center text-body font-semibold text-muted-ink">{t(`feedback.${state.success}` as Parameters<typeof t>[0])}</p>;
  return null;
}

/** One prepared key: the message on a track, how to send it, and the card details when it is for paper. */
function KeyPanel({person, prepared, pending, onShare, onWhatsapp, onMarkSent, onPrepare, onPrint, feedback}: {
  person: KeyPerson; prepared: PreparedKey; pending: boolean; feedback: AuthResult;
  onShare: () => void; onWhatsapp: () => void; onMarkSent: () => void; onPrepare: (kind: KeyKind) => void; onPrint: () => void;
}) {
  const t = useTranslations("auth");
  const k = useTranslations("draw.keys");
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex flex-col gap-1 rounded-[24px] bg-card-track px-[18px] py-4">
        <p className="text-body font-bold text-muted-ink">{k("yourMessage")}</p>
        <p className="text-body font-semibold [overflow-wrap:anywhere]">{prepared.message}</p>
      </div>
      {prepared.qr && (
        <div className="flex flex-col items-center gap-2 rounded-[24px] bg-snow-white p-4">
          <Image unoptimized src={prepared.qr} width={220} height={220} alt={t("keyQr")} />
          <p className="text-body font-semibold">{t("codeOnCard", {code: prepared.code})}</p>
          <p className="text-center text-body break-all text-muted-ink">{t("familyAddressOnCard", {url: prepared.familyAddress})}</p>
        </div>
      )}
      {!prepared.qr && <p className="text-body text-muted-ink">{t("codeOnCard", {code: prepared.code})}</p>}
      <p className="text-body text-muted-ink">{t("expires", {at: format.dateTime(new Date(prepared.expiresAt), activityDateFormat)})}</p>
      <Button variant="card" icon="share" disabled={pending} onClick={onShare}>{t("send")}</Button>
      <p className="text-center text-body text-muted-ink">{k("shareHint", {name: person.name})}</p>
      <div className="flex flex-wrap justify-center gap-x-2">
        <a className="fge-press inline-flex min-h-12 items-center px-2 text-body font-semibold underline underline-offset-4"
          href={`https://wa.me/?text=${encodeURIComponent(prepared.message)}`} target="_blank" rel="noopener noreferrer" onClick={onWhatsapp}>
          {t("sendWhatsapp")}
        </a>
        <TextButton disabled={pending} onClick={onMarkSent}>{t("markSent")}</TextButton>
        {!person.joined && <TextButton disabled={pending} onClick={() => onPrepare("qr")}>{t("showQr")}</TextButton>}
        {!person.joined && <TextButton disabled={pending} onClick={() => onPrepare("print")}>{t("printCard")}</TextButton>}
        {prepared.qr && <TextButton disabled={pending} onClick={onPrint}>{t("print")}</TextButton>}
      </div>
      <Feedback state={feedback} />
    </div>
  );
}

/**
 * Send keys: each person gets their own key in their own chat. A row prepares a key and opens it in
 * place; "Show QR" walks through everyone still waiting, one code at a time; "Print cards" lays out a
 * card for each of them.
 */
export function KeysList({people, helped}: {people: KeyPerson[]; helped: Array<{id: string; name: string; helper: string}>}) {
  const t = useTranslations("auth");
  const k = useTranslations("draw.keys");
  const ui = useTranslations("ui");
  const format = useFormatter();
  const [pending, transition] = useTransition();
  const [prepared, setPrepared] = useState<Record<string, Prepared>>({});
  const [shown, setShown] = useState<Record<string, Prepared>>({});
  const [feedback, setFeedback] = useState<Record<string, AuthResult>>({});
  const [sent, setSent] = useState<Set<string>>(() => new Set(people.filter(({sent}) => sent).map(({id}) => id)));
  const [reset, setReset] = useState<KeyPerson | null>(null);
  const [qr, setQr] = useState<number | null>(null);
  const [printBatch, setPrintBatch] = useState<Array<{person: KeyPerson; prepared?: Prepared}> | null>(null);
  const waiting = people.filter(({joined}) => !joined);
  const printReady = !pending && !!printBatch?.length && printBatch.every(({prepared}) =>
    prepared?.key?.qr && prepared.key.code && prepared.key.familyAddress);

  function prepare(person: KeyPerson, kind: KeyKind, into: "row" | "overlay" = "row") {
    if (into === "row") setFeedback((all) => ({...all, [person.id]: {}}));
    transition(async () => {
      const result = await prepareKey(person.id, kind);
      (into === "row" ? setPrepared : setShown)((all) => ({...all, [person.id]: result}));
      if (result.key) haptic("light");
    });
  }

  async function markSent(person: KeyPerson) {
    const key = prepared[person.id]?.key;
    if (!key) return;
    const result = await sentKey(key.id);
    setFeedback((all) => ({...all, [person.id]: result}));
    if (result.success) {
      haptic("success");
      setSent((all) => new Set(all).add(person.id));
    }
  }

  function share(person: KeyPerson) {
    const key = prepared[person.id]?.key;
    if (!key) return;
    if (typeof navigator.share !== "function") {
      setFeedback((all) => ({...all, [person.id]: {error: "shareUnavailable"}}));
      return;
    }
    transition(async () => {
      try {
        await navigator.share({text: key.message});
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) setFeedback((all) => ({...all, [person.id]: {error: "shareUnavailable"}}));
        return;
      }
      await markSent(person);
    });
  }

  async function showQr(index: number) {
    const person = waiting[index];
    if (!person) {
      setQr(null);
      return;
    }
    setQr(index);
    prepare(person, "qr", "overlay");
  }

  function printAll() {
    setPrintBatch(waiting.map((person) => ({person})));
    transition(async () => {
      for (const person of waiting) {
        let result: Prepared;
        try {
          result = await prepareKey(person.id, "print");
        } catch {
          result = {error: "unavailable"};
        }
        setPrintBatch((batch) => batch?.map((card) => card.person.id === person.id ? {...card, prepared: result} : card) ?? null);
      }
    });
  }

  const panel = (person: KeyPerson) => {
    const key = prepared[person.id]?.key;
    if (!key) return null;
    return (
      <KeyPanel person={person} prepared={key} pending={pending} feedback={feedback[person.id] ?? {}}
        onShare={() => share(person)} onWhatsapp={() => transition(() => markSent(person))}
        onMarkSent={() => transition(() => markSent(person))} onPrepare={(kind) => prepare(person, kind)}
        onPrint={() => setPrintBatch([{person, prepared: {key}}])} />
    );
  };

  return (
    <>
      <div className="print:hidden" inert={qr !== null || printBatch !== null}>
      <KnitIn className="flex flex-col gap-3 px-edge pt-6">
        <Card flush className="px-5 py-1">
          <ul className="fge-rows flex flex-col">
            {people.map((person) => {
              const isSent = sent.has(person.id);
              const status = person.joined ? t("status.joined") : isSent ? t("status.sent") : k("notSentYet");
              return (
                <li key={person.id} id={`member-${person.id}`} className="flex flex-col">
                  <div className="flex min-h-16 items-center gap-3.5 py-2">
                    <Avatar name={person.name} size={44} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h2 className="text-row-title break-words">{person.name}</h2>
                      <p className="text-body text-muted-ink">{status}</p>
                      {person.requestedAt && <p className="text-body font-semibold text-gold-ink">
                        {t("requestAt", {at: format.dateTime(new Date(person.requestedAt), activityDateFormat)})}</p>}
                      {person.joined && (
                        <Button variant="small" icon="lock" disabled={pending} className={person.requestedAt ? "mt-1.5" : "mt-1.5 bg-card-track! text-ink!"}
                          onClick={() => {
                            setPrepared((all) => ({...all, [person.id]: {}}));
                            setReset(person);
                          }}>{t("resetPin")}</Button>
                      )}
                    </div>
                    {person.joined ? null : isSent && !prepared[person.id]?.key ? (
                      <span className="flex items-center gap-1.5 rounded-pill bg-card-track px-3.5 py-2 text-body-strong text-pine">
                        <Icon name="check" size={18} strokeWidth={2.8} />{t("status.sent")}
                      </span>
                    ) : null}
                    {!person.joined && (!isSent || prepared[person.id]?.key) && (
                      <Button variant="small" icon="share" className="self-center" disabled={pending}
                        onClick={() => prepare(person, "share")}>{t("prepareKey")}</Button>
                    )}
                  </div>
                  {isSent && !person.joined && !prepared[person.id]?.key && (
                    <TextButton className="-mt-2 self-start px-0 pl-[58px] text-muted-ink" disabled={pending}
                      onClick={() => prepare(person, "share")}>{k("sendAgain")}</TextButton>
                  )}
                  {!person.joined && (prepared[person.id]?.error ? <Feedback state={prepared[person.id]} /> : panel(person))}
                  {person.joined && reset?.id === person.id && (
                    <Sheet open onClose={() => setReset(null)} title={k("resetTitle", {name: person.name})} closeLabel={ui("close")}>
                      <div className="flex flex-col gap-3">
                        <Line icon="lock">{k("resetOldPin")}</Line>
                        <Line icon="eye">{person.requestedAt
                          ? t("requestAt", {at: format.dateTime(new Date(person.requestedAt), activityDateFormat)})
                          : t("noResetRequest")}</Line>
                        <Line icon="gift">{t("resetConfirm")}</Line>
                      </div>
                      {prepared[person.id]?.key ? panel(person) : (
                        <>
                          <Button variant="card" icon="share" disabled={pending} onClick={() => prepare(person, "reset")}>{t("prepareReset")}</Button>
                          <Feedback state={prepared[person.id] ?? {}} />
                          <TextButton className="self-center" onClick={() => setReset(null)}>{k("cancel")}</TextButton>
                        </>
                      )}
                    </Sheet>
                  )}
                </li>
              );
            })}
            {helped.map(({id, name, helper}) => (
              <li key={id} className="flex min-h-16 items-center gap-3.5 py-2">
                <Avatar name={name} size={44} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-row-title break-words">{name}</p>
                  <p className="flex items-center gap-1.5 text-body text-muted-ink"><Icon name="phone" size={18} />{k("noPhoneHelps", {name: helper})}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        {waiting.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="small" icon="qr" className="bg-snow-white! text-ink!" onClick={() => showQr(0)}>{t("showQr")}</Button>
            <Button variant="small" icon="print" className="bg-snow-white! text-ink!" disabled={pending} onClick={printAll}>{k("printCards")}</Button>
          </div>
        )}
      </KnitIn>
      </div>

      {qr !== null && waiting[qr] && (
        <Overlay onClose={() => setQr(null)} backLabel={t("sendKeys")}
          action={<Button icon="arrow" onClick={() => showQr(qr + 1)}>{qr + 1 < waiting.length ? k("nextPerson") : k("done")}</Button>}>
          <PageTitle title={k("qrTitle", {name: waiting[qr].name})} lead={k("qrLead")} as="h2" />
          <div className="px-edge pt-6">
            <Card className="flex flex-col items-center gap-4 py-6">
              {shown[waiting[qr].id]?.key?.qr ? (
                <Image unoptimized src={shown[waiting[qr].id]!.key!.qr!} width={240} height={240} alt={t("keyQr")} className="rounded-[18px]" />
              ) : shown[waiting[qr].id]?.error ? <Feedback state={shown[waiting[qr].id]} /> : (
                <div className="size-[240px] animate-pulse rounded-[18px] bg-card-track" aria-busy="true" />
              )}
              <p className="flex items-center gap-2.5 text-row-title"><Avatar name={waiting[qr].name} size={40} />{k("keyFor", {name: waiting[qr].name})}</p>
            </Card>
          </div>
        </Overlay>
      )}

      {printBatch && (
        <Overlay onClose={() => setPrintBatch(null)} backLabel={t("sendKeys")} printable
          action={<Button icon="print" disabled={!printReady} onClick={() => window.print()}>{k("printCount", {count: printBatch.length})}</Button>}>
          <div className="print:hidden">
            <PageTitle title={t("print")} as="h2" lead={k("printLead", {names: new Intl.ListFormat(undefined, {type: "conjunction"}).format(printBatch.map(({person}) => person.name))})} />
          </div>
          <ul className="grid grid-cols-2 gap-3 px-edge pt-6 pb-6 print:grid-cols-3 print:gap-6">
            {printBatch.map(({person, prepared}) => {
              const key = prepared?.key;
              return (
                <li key={person.id} className="flex break-inside-avoid flex-col overflow-hidden rounded-[22px] bg-snow-white text-ink print:border print:border-black">
                  <div className="flex h-16 items-center justify-center bg-ink px-2">
                    <StitchedText text={person.name} cell={STITCH_CELL.pass * 0.7} className="max-w-full [&>svg]:h-auto [&>svg]:max-w-full" />
                  </div>
                  <div className="flex flex-col items-center gap-1.5 p-3 text-center">
                    {prepared?.error ? <Feedback state={prepared} /> : key?.qr ? <Image unoptimized src={key.qr} width={140} height={140} alt={t("keyQr")} /> : (
                      <div className="size-[140px] animate-pulse rounded-[14px] bg-card-track" aria-busy="true" />
                    )}
                    <p className="text-label normal-case tracking-normal">{k("scanCard")}</p>
                    {key && <>
                      <p className="text-body-strong">{key.code}</p>
                      <p className="text-label break-all normal-case tracking-normal">{t("familyAddressOnCard", {url: key.familyAddress})}</p>
                    </>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Overlay>
      )}
    </>
  );
}

function Line({icon, children}: {icon: Parameters<typeof IconDisc>[0]["icon"]; children: ReactNode}) {
  return (
    <p className="flex items-start gap-3 text-body font-semibold">
      <Icon name={icon} size={22} strokeWidth={2.3} className="mt-0.5 shrink-0 text-pine" />
      <span>{children}</span>
    </p>
  );
}

/** A page pushed over Send keys (show a QR, print cards), with its own back disc. */
function Overlay({children, action, onClose, backLabel, printable = false}: {
  children: ReactNode; action: ReactNode; onClose: () => void; backLabel: string; printable?: boolean;
}) {
  return (
    <section aria-label={backLabel}
      className={`fixed inset-0 z-40 mx-auto flex max-w-[480px] flex-col overflow-y-auto bg-sweater-red text-snow-white fge-arrive-one ${printable ? "print:static print:bg-white print:text-black" : "print:hidden"}`}>
      <div className="flex items-center px-4 pt-[calc(8px+var(--safe-top))] print:hidden">
        <button type="button" onClick={onClose} className="fge-press inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-pill pr-2">
          <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-on-ground"><Icon name="back" size={24} strokeWidth={2.5} /></span>
          <span className="text-body font-semibold">{backLabel}</span>
        </button>
      </div>
      <div className="flex-1">{children}</div>
      <div className="sticky bottom-0 flex flex-col gap-2 bg-sweater-red px-edge pt-4 pb-[calc(34px+var(--safe-bottom))] print:hidden">{action}</div>
    </section>
  );
}

