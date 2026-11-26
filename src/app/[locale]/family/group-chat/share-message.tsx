"use client";

import {useTranslations} from "next-intl";
import {useState, useSyncExternalStore} from "react";

function ignoreBrowserChanges() {
  return () => {};
}

function supportsNativeShare() {
  return typeof navigator.share === "function";
}

export function ShareMessage({text, whatsapp}: {text: string; whatsapp: string}) {
  const t = useTranslations("notify.groupChat");
  const canShare = useSyncExternalStore(ignoreBrowserChanges, supportsNativeShare, () => false);
  const [feedback, setFeedback] = useState<"copied" | "copyError" | "shareError">();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("copied");
    } catch {
      setFeedback("copyError");
    }
  }

  async function share() {
    setFeedback(undefined);
    try {
      await navigator.share({text});
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFeedback("shareError");
    }
  }

  const action = "inline-flex min-h-12 items-center px-2 underline";
  return (
    <>
      <p className="break-words">{text}</p>
      <div className="flex flex-wrap gap-2">
        <button className={action} onClick={copy} type="button">{t("copy")}</button>
        {canShare && <button className={action} onClick={share} type="button">{t("share")}</button>}
        <a className={action} href={whatsapp} target="_blank" rel="noopener noreferrer">{t("whatsapp")}</a>
      </div>
      <p role="status">{feedback ? t(feedback) : ""}</p>
    </>
  );
}
