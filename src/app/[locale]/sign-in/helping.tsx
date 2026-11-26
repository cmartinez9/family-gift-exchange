"use client";

import {useTranslations} from "next-intl";
import {useState, type ReactNode} from "react";
import {Button, TextButton} from "@/components/ui/button";
import {Card, Chevron, IconDisc, ListRow, Rows} from "@/components/ui/card";
import {Icon, type IconName} from "@/components/ui/icon";
import {StitchedText} from "@/components/ui/knit/stitched-text";
import {haptic} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {toast} from "@/components/ui/toast";

function Choice({icon, title, sub, onClick}: {icon: IconName; title: string; sub: string; onClick: () => void}) {
  return (
    <li>
      <button type="button" onClick={onClick} className="fge-press block w-full cursor-pointer text-left">
        <ListRow as="span" lead={<IconDisc icon={icon} iconSize={24} />} title={title} sub={sub} trail={<Chevron />}
          className="min-h-[76px] py-3" />
      </button>
    </li>
  );
}

function Line({icon, children}: {icon: IconName; children: ReactNode}) {
  return (
    <li className="flex items-start gap-3.5">
      <Icon name={icon} size={24} strokeWidth={2.3} className="mt-0.5 text-pine" />
      <p className="min-w-0 flex-1 text-body font-semibold">{children}</p>
    </li>
  );
}

/**
 * "No, I'm helping {name}" on someone's key. The key stays theirs: send it on to their phone, or hand them
 * this phone for their own PIN, or, without a phone of their own, ask the organizer to make you their helper.
 */
export function HelpingKey({name, typed, onHandOver, onBack}: {
  name: string;
  /** A typed code has no link to send on. */
  typed: boolean;
  /** They have the phone: on to their own PIN. */
  onHandOver: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("helping");
  const auth = useTranslations("auth");
  const [view, setView] = useState<"choose" | "hand" | "noPhone">("choose");

  async function send() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({url});
        haptic("success");
        return;
      }
      await navigator.clipboard.writeText(url);
      haptic("success");
      toast(t("copied", {name}));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast({message: t("shareError"), icon: "alert"});
    }
  }

  if (view === "hand") {
    return (
      <div className="flex flex-col gap-6 text-snow-white" data-helping="hand">
        <div className="flex flex-col items-center gap-4 pt-2 text-center">
          <h2 className="text-section">
            {t("handTitle")}<span className="sr-only"> {name}</span>
          </h2>
          <StitchedText text={name} cell={10} knit className="max-w-full [&>svg]:h-auto [&>svg]:max-w-full" />
        </div>
        <Card>
          <ul className="flex flex-col gap-3.5">
            <Line icon="lock">{t("handPin", {name})}</Line>
            <Line icon="phone">{t("handFace", {name, notNow: auth("notNow")})}</Line>
            <Line icon="user">{t("handSignOut", {name, signOut: auth("switchPerson")})}</Line>
          </ul>
        </Card>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => {
            haptic("success");
            onHandOver();
          }}>{t("handReady", {name})}</Button>
          <TextButton onClick={() => setView("choose")}>{auth("back")}</TextButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 text-snow-white" data-helping="choose">
      <div className="flex flex-col gap-2">
        <h2 className="text-title">{t("keyTitle", {name})}</h2>
        <p className="text-lead">{t("keyLead", {name})}</p>
      </div>
      {view === "noPhone" ? (
        <Card className="flex-row items-start gap-3.5">
          <Icon name="user" size={24} strokeWidth={2.3} className="mt-0.5 text-pine" />
          <p className="min-w-0 flex-1 text-body font-semibold" role="status">{t("noPhoneBody", {name})}</p>
        </Card>
      ) : (
        <KnitIn>
          <Card flush className="px-5 py-1.5">
            <Rows as="ul">
              {!typed && <Choice icon="share" title={t("sendTitle", {name})} sub={t("sendSub", {name})} onClick={send} />}
              <Choice icon="phone" title={t("hereTitle", {name})} sub={t("hereSub", {name})} onClick={() => setView("hand")} />
              <Choice icon="home" title={t("noPhoneTitle", {name})} sub={t("noPhoneSub", {name})} onClick={() => setView("noPhone")} />
            </Rows>
          </Card>
        </KnitIn>
      )}
      <TextButton className="self-center" onClick={view === "noPhone" ? () => setView("choose") : onBack}>{auth("back")}</TextButton>
    </div>
  );
}
