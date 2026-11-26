"use client";

import {useTranslations} from "next-intl";
import {useState, useSyncExternalStore} from "react";
import {Button, buttonClass} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {ChoiceChips} from "@/components/ui/chip";
import {Icon} from "@/components/ui/icon";
import {TextArea} from "@/components/ui/inputs";
import {haptic} from "@/components/ui/motion/haptic";
import {toast} from "@/components/ui/toast";

type Message = {id: string; text: string; topic: string; chip: string};

/** Copy and Edit: pills on the card's track tone, as wide as their words. */
const pill = "fge-press inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-pill bg-[var(--track)] px-5 text-body-strong text-ink";

function ignoreBrowserChanges() {
  return () => {};
}

function supportsNativeShare() {
  return typeof navigator.share === "function";
}

const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/**
 * Tell the family: one ready-made message on a yarn-white card, with Copy and Edit, and one way out on the
 * ground: the phone's share menu, or WhatsApp where the browser has no share menu.
 */
export function ShareMessage({messages, initial}: {messages: readonly Message[]; initial: string}) {
  const t = useTranslations("notify.groupChat");
  const canShare = useSyncExternalStore(ignoreBrowserChanges, supportsNativeShare, () => false);
  const [topic, setTopic] = useState(messages.some(({id}) => id === initial) ? initial : messages[0].id);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const message = messages.find(({id}) => id === topic) ?? messages[0];
  const text = edited[message.id] ?? message.text;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      haptic("success");
      toast(t("copied"));
    } catch {
      toast({message: t("copyError"), icon: "alert"});
    }
  }

  async function share() {
    try {
      await navigator.share({text});
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast({message: t("shareError"), icon: "alert"});
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="px-edge pt-6 pb-6">
        <Card className="gap-4">
          <ChoiceChips legend={t("which")} name="topic" value={topic}
            options={messages.map(({id, chip}) => ({value: id, label: chip}))}
            onChange={(value) => {
              setTopic(value);
              setEditing(false);
            }} />
          <section aria-label={message.topic} className="flex flex-col gap-3" data-chat-message={message.id}>
            {editing ? (
              <TextArea label={t("field")} rows={6} value={text}
                onChange={(event) => setEdited({...edited, [message.id]: event.target.value})} />
            ) : (
              <p className="rounded-[24px] bg-snow-white px-6 py-5 text-body break-words">{text}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={pill} aria-label={t("copy")} onClick={copy}>
                <Icon name="copy" size={22} strokeWidth={2.4} />{t("copyShort")}
              </button>
              <button type="button" className={pill} aria-expanded={editing} onClick={() => setEditing(!editing)}>
                <Icon name={editing ? "check" : "pencil"} size={22} strokeWidth={2.4} />{t(editing ? "doneEditing" : "edit")}
              </button>
            </div>
          </section>
        </Card>
      </div>
      <div data-actions="" className="sticky bottom-0 z-10 mt-auto flex flex-col items-center gap-2 bg-sweater-red px-edge pt-4 pb-[34px] max-[299px]:static">
        {canShare ? (
          <>
            <Button icon="share" onClick={share}>{t("shareGroup")}</Button>
            <a href={whatsappLink(text)} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center px-3 text-body font-semibold text-snow-white underline underline-offset-4">
              {t("whatsapp")}
            </a>
          </>
        ) : (
          <a className={buttonClass("ground")} href={whatsappLink(text)} target="_blank" rel="noopener noreferrer">
            <Icon name="share" size={22} strokeWidth={2.4} />
            <span>{t("whatsapp")}</span>
          </a>
        )}
      </div>
    </div>
  );
}
