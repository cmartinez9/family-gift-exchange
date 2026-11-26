"use client";

import {useState, useTransition, type ReactNode} from "react";
import {useFormatter, useTranslations} from "next-intl";
import {Button, TextButton} from "@/components/ui/button";
import {Track} from "@/components/ui/card";
import {BudgetMeasure, ItemCard, MineLine, StatusLine, WantsLine} from "@/components/ui/item-card";
import {ClaimCard} from "@/components/ui/motion/claim";
import {toast} from "@/components/ui/toast";
import {claimCommand} from "../actions";
import {ItemThumb, type ListItemView} from "../item-view";

/**
 * One gift on someone else's list. Rose when someone else is getting it, with no name. "I'm getting this"
 * dyes the card pine from your thumb and hangs a knitted tag on it; Undo lifts the tag. If someone else
 * got there a second first, the card turns rose and says so in words.
 */
export function ClaimItem({actingAs, item, ownerName, budget, canClaim}: {
  actingAs: string;
  item: ListItemView;
  ownerName: string;
  canClaim: boolean;
  /** Your person's budget, for the measure under each price. */
  budget?: string | null;
}) {
  const t = useTranslations("lists");
  const format = useFormatter();
  const [claimed, setClaimed] = useState(item.claim === "mine");
  const [late, setLate] = useState(false);
  const [pending, startTransition] = useTransition();
  const money = (amount: string | number) => format.number(Number(amount), {style: "currency", currency: "USD"});

  const run = (command: "claim" | "undo") => {
    const next = command === "claim";
    setClaimed(next);
    startTransition(async () => {
      const result = await claimCommand(actingAs, item.id, command, next);
      if (!result.error) return;
      setClaimed(!next);
      if (result.error === "already-claimed") setLate(true);
      else toast({message: t(`feedback.${result.error}`), icon: "alert"});
    });
  };

  const store = item.store && (item.url
    ? (
      <a href={item.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
        <span className="sr-only">{t("openStore", {store: item.store})}</span>
        <span aria-hidden="true">{item.store}</span>
      </a>
    )
    : item.store);
  const common = {
    titleAs: "h2" as const,
    picture: <ItemThumb item={item} />,
    title: <span className="break-words hyphens-auto">{item.title}</span>,
    store: store || undefined,
    price: item.price !== null ? money(item.price) : undefined,
    note: item.note ? <span className="whitespace-pre-wrap break-words">{item.note}</span> : undefined,
  };
  const measure = budget && item.price !== null
    ? <BudgetMeasure price={Number(item.price)} budget={Number(budget)}
      underLabel={t("budgetOf", {amount: money(budget)})} overLabel={t("budgetOver", {amount: money(budget)})} />
    : null;
  const wants = item.starred ? <WantsLine>{t("wants", {name: ownerName})}</WantsLine> : null;

  let card: ReactNode;
  if (!canClaim) {
    card = <ItemCard {...common} details={wants} />;
  } else if (late || item.claim === "someone") {
    card = (
      <ItemCard tone="taken" {...common}
        details={<>{measure}<StatusLine>{late ? t("justGot") : t("someone")}</StatusLine></>}
        after={late ? <Track className="mt-3"><p className="text-body" role="status">{t("lateTap")}</p></Track> : undefined} />
    );
  } else {
    card = (
      <ClaimCard claimed={claimed}
        base={(
          <ItemCard tag="space" {...common}
            details={<>
              {measure}
              {wants}
              <Button variant="small" icon="gift" className="mt-2.5" data-claim-origin="" disabled={pending}
                onClick={() => run("claim")}>{t("claim")}</Button>
            </>} />
        )}
        mine={(
          <ItemCard tone="mine" tag="space" {...common}
            details={<>{measure}{wants}</>}
            after={(
              <MineLine action={<TextButton disabled={pending} onClick={() => run("undo")}>{t("undoClaim")}</TextButton>}>
                {t("mine")}
              </MineLine>
            )} />
        )} />
    );
  }
  return (
    <article aria-label={item.title} aria-busy={pending}
      data-claim={late ? "late" : item.claim === "someone" ? "someone" : claimed ? "mine" : "open"}>
      {card}
    </article>
  );
}
