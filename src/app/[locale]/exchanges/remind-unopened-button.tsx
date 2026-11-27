"use client";

import {useTranslations} from "next-intl";
import {useTransition} from "react";
import {Button} from "@/components/ui/button";
import {haptic} from "@/components/ui/motion/haptic";
import {toast} from "@/components/ui/toast";
import {remindUnopenedPeople} from "./nudge-actions";

export function RemindUnopenedButton({exchangeId}: {exchangeId: string}) {
  const t = useTranslations("draw.season");
  const [pending, start] = useTransition();

  function send() {
    if (pending) return;
    start(async () => {
      const result = await remindUnopenedPeople(exchangeId).catch(() => "unavailable" as const);
      const sent = result === "sent";
      haptic(sent ? "success" : "error");
      toast({message: t(sent ? "unopenedNudgeSent" : "nudgeFailed"), icon: sent ? "bell" : "alert"});
    });
  }

  return (
    <Button variant="card" icon="bell" className="w-full" onClick={send} disabled={pending} aria-busy={pending || undefined}>
      {t("remindUnopened")}
    </Button>
  );
}
