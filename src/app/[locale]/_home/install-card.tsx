"use client";

import {useState, useSyncExternalStore} from "react";
import {useTranslations} from "next-intl";
import {Button, IconButton, TextButton} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Icon} from "@/components/ui/icon";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {haptic} from "@/components/ui/motion/haptic";
import {Sheet} from "@/components/ui/sheet";
import {toast} from "@/components/ui/toast";

const DISMISSED = "fge-install-dismissed";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
    window.removeEventListener("storage", listener);
  };
}

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

function setDismissed(on: boolean) {
  try {
    if (on) window.localStorage.setItem(DISMISSED, "1");
    else window.localStorage.removeItem(DISMISSED);
  } catch {
    // private browsing: the card simply comes back next time
  }
  listeners.forEach((listener) => listener());
}

/** Hidden once the app is on the home screen, or once you said "not now". */
function hidden() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & {standalone?: boolean}).standalone === true;
  return standalone || readDismissed();
}

type Phone = "iphone" | "android";

/**
 * "Put it on your home screen": the gold next step on Home until the app is installed. "Show me how"
 * opens the steps for this phone; the cross puts the card away with Undo ("It's in Settings any time").
 */
export function InstallCard() {
  const t = useTranslations("homeScreen");
  const ui = useTranslations("ui");
  const isHidden = useSyncExternalStore(subscribe, hidden, () => true);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<Phone | null>(null);
  if (isHidden) return null;

  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const shown: Phone = phone ?? (/Android/i.test(agent) ? "android" : "iphone");
  const inApp = /WhatsApp|FBAN|FBAV|Instagram/i.test(agent);
  const steps = shown === "iphone"
    ? [["iphoneStep1", "share"], ["iphoneStep2", "plussq"], ["iphoneStep3", null]] as const
    : [["androidStep1", "dots"], ["androidStep2", "plussq"], ["androidStep3", null]] as const;

  return (
    <>
      <Card tone="next" data-install="">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-app-icon bg-sweater-red">
            <KnitMotif name="flake" cell={3.6} colors={{"#": "var(--color-yarn-white)"}} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-card-title">{t("installTitle")}</h2>
            <p className="pt-0.5 text-body text-gold-ink">{t("installLead")}</p>
          </div>
          <IconButton icon="close" label={t("installDismiss")} tone="track" onClick={() => {
            haptic("soft");
            setDismissed(true);
            toast({message: t("installDismissed"), icon: "undo", undo: () => setDismissed(false)});
          }} />
        </div>
        <Button variant="card" className="mt-3.5" onClick={() => {
          haptic("soft");
          setOpen(true);
        }}>{t("installButton")}</Button>
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} title={shown === "iphone" ? t("iphoneTitle") : t("androidTitle")} closeLabel={ui("close")}>
        {inApp && shown === "iphone" && (
          <p className="flex items-start gap-3 rounded-[28px] bg-gold px-5 py-4 text-body font-semibold">
            <Icon name="alert" size={24} strokeWidth={2.4} className="mt-0.5" />
            <span>{t("inAppWarning")}</span>
          </p>
        )}
        <ol className="flex flex-col gap-3.5">
          {steps.map(([key, icon], index) => (
            <li key={key} className="flex min-h-12 items-center gap-4">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sweater-red text-body-strong text-snow-white">
                {index + 1}
              </span>
              <p className="min-w-0 flex-1 text-body">{t(key)}</p>
              {icon
                ? <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card-track text-[#0A6CDB]"><Icon name={icon} size={24} /></span>
                : (
                  <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-app-icon bg-sweater-red">
                    <KnitMotif name="flake" cell={3.6} colors={{"#": "var(--color-yarn-white)"}} />
                  </span>
                )}
            </li>
          ))}
        </ol>
        <p className="text-body text-muted-ink">{t("installAfter")}</p>
        <Button variant="card" onClick={() => setOpen(false)}>{t("gotIt")}</Button>
        <TextButton className="self-center" onClick={() => setPhone(shown === "iphone" ? "android" : "iphone")}>
          {shown === "iphone" ? t("haveAndroid") : t("haveIphone")}
        </TextButton>
      </Sheet>
    </>
  );
}
