"use client";

import {useLayoutEffect, useRef, useState, useTransition, type ReactNode} from "react";
import {useFormatter, useTranslations} from "next-intl";
import {Button, TextButton} from "@/components/ui/button";
import {Track, stackRow, stackWords} from "@/components/ui/card";
import {cn} from "@/components/ui/cn";
import {Icon} from "@/components/ui/icon";
import {ItemCard} from "@/components/ui/item-card";
import {DURATION, EASE} from "@/components/ui/motion/easing";
import {haptic} from "@/components/ui/motion/haptic";
import {prefersReducedMotion} from "@/components/ui/motion/reduced-motion";
import {toast} from "@/components/ui/toast";
import {useRouter} from "@/i18n/navigation";
import type {ItemChange} from "@/server/lists/claims/changes";
import {acknowledgeChange, claimCommand} from "../actions";
import {runListAction} from "../client-action";

type Phase = "changed" | "settling" | "settled";

/**
 * Change card for the workflow in README.md#wishlists-and-gifts. Acknowledgment reveals the settled
 * card with a receding layer, or a fade with reduced motion. Only the first changed gift is gold;
 * the rest use yarn white.
 */
export function ChangedItem({actingAs, itemId, title, ownerName, version, changes, gold, picture, settled}: {
  /** Who you are getting gifts as: you, or the person you look after. */
  actingAs: string;
  itemId: string;
  title: string;
  ownerName: string;
  version: string;
  changes: ItemChange[];
  gold: boolean;
  picture: ReactNode;
  /** The card as it reads once you have seen the change: Bought and Wrapped. */
  settled: ReactNode;
}) {
  const t = useTranslations("lists.changed");
  const lists = useTranslations("lists");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(changes.length ? "changed" : "settled");
  const [shown, setShown] = useState(version);
  // a newer change from the server shows again, even after you saw an older one
  if (shown !== version) {
    setShown(version);
    setPhase(changes.length ? "changed" : "settled");
  }
  const [pending, startTransition] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const origin = useRef("50% 85%");

  useLayoutEffect(() => {
    if (phase !== "settling") return;
    const box = wrap.current, layer = top.current, below = under.current;
    if (!box || !layer || !below) return;
    const reduce = prefersReducedMotion();
    const from = layer.offsetHeight, to = below.offsetHeight;
    const recede = reduce
      ? layer.animate([{opacity: 1}, {opacity: 0}], {duration: DURATION.reduced, fill: "forwards"})
      : layer.animate([
        {clipPath: `circle(160% at ${origin.current})`},
        {clipPath: `circle(0px at ${origin.current})`},
      ], {duration: DURATION.claimDye, easing: EASE.pine, fill: "forwards"});
    const fit = reduce ? undefined : box.animate([{height: `${from}px`}, {height: `${to}px`}],
      {duration: DURATION.claimDye, easing: EASE.interface});
    recede.onfinish = () => {
      fit?.cancel();
      setPhase((current) => current === "settling" ? "settled" : current);
    };
    return () => {
      recede.cancel();
      fit?.cancel();
    };
  }, [phase]);

  useLayoutEffect(() => {
    if (phase === "settled" && changes.length) wrap.current?.focus({preventScroll: true});
  }, [phase, changes.length]);

  if (phase === "settled") {
    return <div ref={wrap} tabIndex={-1} className="outline-none" data-change="seen">{settled}</div>;
  }

  const keep = (button: HTMLElement) => {
    const box = wrap.current?.getBoundingClientRect(), at = button.getBoundingClientRect();
    if (box) origin.current = `${Math.round(at.left + at.width / 2 - box.left)}px ${Math.round(at.top + at.height / 2 - box.top)}px`;
    haptic("tick");
    setPhase("settling");
    startTransition(async () => {
      const {error} = await runListAction(() => acknowledgeChange(actingAs, itemId, version));
      if (!error) {
        toast(t("kept"));
        return;
      }
      setPhase("changed");
      toast({message: lists(`feedback.${error}`), icon: "alert"});
      if (error === "item-changed") router.refresh();
    });
  };

  const letGo = () => {
    startTransition(async () => {
      const result = await runListAction(() => claimCommand(actingAs, itemId, "undo", false));
      const {error} = result;
      if (error) {
        toast({message: lists(`feedback.${error}`), icon: "alert"});
        return;
      }
      const released = "released" in result ? result.released : undefined;
      toast({
        message: t("letGone"),
        undo: released && (() => {
          void runListAction(() => claimCommand(actingAs, itemId, "claim", true, {released})).then(({error: undoError}) => {
            if (undoError) toast({message: lists(`feedback.${undoError}`), icon: "alert"});
          });
        }),
      });
    });
  };

  return (
    <div ref={wrap} className="relative grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[28px]"
      data-change={phase} aria-busy={pending}>
      {/* the usual card only exists while the gold recedes off it */}
      {phase === "settling" && <div ref={under} className="[grid-area:1/1] self-start" inert aria-hidden="true">{settled}</div>}
      <div ref={top} className="[grid-area:1/1] self-start" inert={phase === "settling"}>
        <ItemCard tone={gold ? "next" : "info"} titleAs="h2" picture={picture}
          title={<span className="font-extrabold">{t("title", {name: ownerName})}</span>}
          store={<span className="break-words">{t("for", {title, name: ownerName})}</span>}
          after={(
            <>
              <Track className="mt-3 gap-2.5 py-2.5">
                {changes.map((change) => <ChangeLines key={change.field} change={change} />)}
              </Track>
              <div className="flex flex-wrap items-center gap-2 pt-3">
                <Button variant="small" disabled={pending} onClick={(event) => keep(event.currentTarget)}>{t("keep")}</Button>
                <TextButton disabled={pending} onClick={letGo}>{t("letGo")}</TextButton>
              </div>
            </>
          )} />
      </div>
    </div>
  );
}

function ChangeLines({change}: {change: ItemChange}) {
  const t = useTranslations("lists.changed");
  const format = useFormatter();
  if (change.field === "photo") {
    return (
      <div className={cn("flex items-start gap-2 text-body-strong", stackRow)} data-changed="photo">
        <Icon name="arrow" size={20} strokeWidth={2.2} className="mt-[2.5px]" />
        <span className={cn("min-w-0 break-words", stackWords)}>{t(change.hasPhoto ? "newPicture" : "pictureRemoved")}</span>
      </div>
    );
  }
  const value = (side: "before" | "after") => {
    const text = change[side];
    if (change.field === "price") {
      return text === null ? t("noPrice") : format.number(Number(text), {style: "currency", currency: "USD"});
    }
    if (change.field === "note") return text ?? t("noNote");
    if (change.field === "link") {
      if (text === null) return t("noLink");
      return side === "after" && change.before === text ? t("newLinkAt", {store: text}) : t("linkAt", {store: text});
    }
    return text ?? "";
  };
  const after = value("after");
  return (
    <div className="flex flex-col" data-changed={change.field}>
      <del className="text-body font-medium whitespace-pre-wrap break-words text-[var(--fg-muted)] line-through decoration-[1.5px]">
        <span className="sr-only">{t("was")} </span>{value("before")}
      </del>
      <ins className={cn("flex items-start gap-2 text-body-strong no-underline", stackRow)}>
        <Icon name="arrow" size={20} strokeWidth={2.2} className="mt-[2.5px]" />
        <span className={cn("min-w-0 whitespace-pre-wrap break-words", stackWords)}>
          <span className="sr-only">{t("now")} </span>
          {change.field === "link" && change.url
            ? <a href={change.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">{after}</a>
            : after}
        </span>
      </ins>
    </div>
  );
}
