"use client";

import {useTranslations} from "next-intl";
import {useRef, useState, useSyncExternalStore, useTransition} from "react";
import {Button} from "@/components/ui/button";
import {Icon} from "@/components/ui/icon";
import {EASE} from "@/components/ui/motion/easing";
import {haptic} from "@/components/ui/motion/haptic";
import {prefersReducedMotion} from "@/components/ui/motion/reduced-motion";
import {toast} from "@/components/ui/toast";
import {todayInExchangeCalendar} from "@/server/messages/calendar";
import {nudgePerson} from "./nudge-actions";

function calendarDay() {
  return todayInExchangeCalendar(new Date());
}

function subscribeDay(refresh: () => void) {
  const timer = window.setInterval(refresh, 30_000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

/**
 * Who's in: a row's Nudge. The bell rings once as it goes; then the row says "Nudged" for the rest of
 * the day. A nudge is the same plain notice whoever sends it, so nothing here names a giver.
 */
export function NudgeButton({exchangeId, personId, name, day, nudged = false}: {
  exchangeId: string; personId: string; name: string; day: string; nudged?: boolean;
}) {
  const t = useTranslations("draw.season");
  const [completion, setCompletion] = useState({exchangeId, personId, day, nudged, sentOn: ""});
  const today = useSyncExternalStore(subscribeDay, calendarDay, () => day);
  const [pending, start] = useTransition();
  const bell = useRef<HTMLSpanElement>(null);

  if (completion.exchangeId !== exchangeId || completion.personId !== personId || completion.day !== day || completion.nudged !== nudged) {
    setCompletion({exchangeId, personId, day, nudged, sentOn: ""});
  }

  const done = (nudged && day === today) || completion.sentOn === today;
  if (done) {
    return (
      <span className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-pill bg-[var(--track)] px-[18px] text-body-strong text-[var(--fg-muted)]"
        data-nudge="done">
        <Icon name="check" size={20} strokeWidth={2.6} />{t("nudged")}
      </span>
    );
  }

  function send() {
    if (pending) return;
    if (!prefersReducedMotion()) {
      bell.current?.animate([
        {transform: "rotate(0)"}, {transform: "rotate(-18deg)"}, {transform: "rotate(14deg)"},
        {transform: "rotate(-9deg)"}, {transform: "rotate(5deg)"}, {transform: "rotate(0)"},
      ], {duration: 620, easing: EASE.swing});
    }
    start(async () => {
      const sentOn = todayInExchangeCalendar(new Date());
      const result = await nudgePerson(exchangeId, personId).catch(() => "unavailable" as const);
      if (result === "sent" || result === "already") {
        haptic("success");
        setCompletion({exchangeId, personId, day, nudged, sentOn});
        toast({message: t("nudgeSent", {name}), icon: "bell"});
      } else {
        haptic("error");
        toast({message: t("nudgeFailed"), icon: "alert"});
      }
    });
  }

  return (
    // the wrapper keeps the pill centred in its row; the small button aligns itself to the top
    <span className="flex shrink-0">
      <Button variant="small" onClick={send} aria-busy={pending || undefined} aria-label={t("nudgeLabel", {name})} data-nudge="ready">
        <span className="inline-flex items-center gap-2">
          <span ref={bell} className="inline-flex origin-[50%_10%]"><Icon name="bell" size={20} strokeWidth={2.4} /></span>
          {t("nudge")}
        </span>
      </Button>
    </span>
  );
}
