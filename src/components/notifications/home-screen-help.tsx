"use client";

import Image from "next/image";
import {useTranslations} from "next-intl";
import {useState, type ReactNode} from "react";
import {Button, TextButton} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon, type IconName} from "@/components/ui/icon";
import {Sheet} from "@/components/ui/sheet";

type Phone = "iphone" | "android";

/** The phone the page is open on, so the sheet starts with its steps. Anything not Android gets the iPhone steps. */
function detectPhone(): Phone {
  return /android/i.test(navigator.userAgent) ? "android" : "iphone";
}

/** A system button the step points at, on the sheet's track tone, in the phone's own blue. */
function SystemButton({icon}: {icon: IconName}) {
  return (
    <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-card-track text-[#0A6CDB]">
      <Icon name={icon} size={24} strokeWidth={2.2} />
    </span>
  );
}

function Step({number, children, picture}: {number: number; children: ReactNode; picture: ReactNode}) {
  return (
    <li className="flex items-center gap-3.5">
      <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-sweater-red text-body-strong text-snow-white">
        {number}
      </span>
      <p className="min-w-0 flex-1 text-body">{children}</p>
      {picture}
    </li>
  );
}

/**
 * "Put this on your home screen? Show me how": one sheet with the three steps for the phone in hand, and a
 * link to the other phone's steps. It starts with the in-app-browser warning, the one thing to do first.
 */
export function HomeScreenHelp({className}: {className?: string}) {
  const t = useTranslations("notify.install");
  const ui = useTranslations("ui");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<Phone>("iphone");
  const iphone = phone === "iphone";

  return (
    <>
      <TextButton className={cn("-ml-3 self-start text-left", className)} aria-haspopup="dialog"
        onClick={() => {
          setPhone(detectPhone());
          setOpen(true);
        }}>
        {t("prompt")}
      </TextButton>
      <Sheet open={open} onClose={() => setOpen(false)} title={t(iphone ? "iphoneTitle" : "androidTitle")} closeLabel={ui("close")}>
        <Card tone="next" className="flex-row items-start gap-3 px-[18px] py-4" data-install-in-app="">
          <Icon name="alert" size={24} strokeWidth={2.4} />
          <p className="min-w-0 flex-1 text-body font-semibold">{t(iphone ? "iphoneInApp" : "androidInApp")}</p>
        </Card>
        <ol aria-label={t("steps")} className="flex flex-col gap-4 py-1">
          <Step number={1} picture={<SystemButton icon={iphone ? "share" : "dots"} />}>{t(iphone ? "iphoneShare" : "androidMenu")}</Step>
          <Step number={2} picture={<SystemButton icon="plussq" />}>{t(iphone ? "iphoneAdd" : "androidAdd")}</Step>
          <Step number={3} picture={<Image src="/gift-192.png" alt="" width={48} height={48} unoptimized
            className="size-12 shrink-0 rounded-app-icon" />}>{t(iphone ? "iphoneDone" : "androidDone")}</Step>
        </ol>
        <p className="text-body text-muted-ink">{t("opens")}</p>
        <Button variant="card" onClick={() => setOpen(false)}>{t("gotIt")}</Button>
        <TextButton className="self-center" onClick={() => setPhone(iphone ? "android" : "iphone")}>
          {t(iphone ? "haveAndroid" : "haveIphone")}
        </TextButton>
      </Sheet>
    </>
  );
}
