"use client";

import {useFormatter, useTranslations} from "next-intl";
import {useActionState, useEffect, useId, useRef, useState, useTransition} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextButton, TextLink} from "@/components/ui/button";
import {Card, IconDisc, OnlyYou, Track, Chevron} from "@/components/ui/card";
import {Chip} from "@/components/ui/chip";
import {Icon} from "@/components/ui/icon";
import {TextArea} from "@/components/ui/inputs";
import {BudgetMeasure, ItemCard, ItemPicture, NoPicture, WantsLine} from "@/components/ui/item-card";
import {STITCH_CELL, StitchedText} from "@/components/ui/knit/stitched-text";
import {ModeBanner, modeActionClass} from "@/components/ui/mode-banner";
import {haptic} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {UnravelReveal} from "@/components/ui/motion/unravel-reveal";
import {AppLink} from "@/components/ui/navigation";
import {BackRow, SectionHeading} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {Sheet} from "@/components/ui/sheet";
import {toast} from "@/components/ui/toast";
import {useLocale} from "next-intl";
import {memberAction, reveal, type FormState, type MemberContext, type PersonList, type RevealState} from "./actions";

export type Outgoing = {id: string; text: string; answer: string | null};

type Person = {id: string; name: string; list?: PersonList};

const SUGGESTIONS = ["size", "color", "have"] as const;

/**
 * Your person: the reveal the first time, then their page — pine, because only you may see it.
 * The name comes from the reveal itself; until it is opened on this visit the page keeps it hidden.
 */
export function MemberPerson({context, seen, canReport, canAsk, budget, outgoing, incoming, back, backLabel, answerHref, helping}: {
  context: MemberContext;
  seen: boolean;
  canReport: boolean;
  canAsk: boolean;
  /** The exchange budget in dollars, or null. */
  budget: number | null;
  outgoing: Outgoing[];
  /** Unanswered questions for you, and where to answer them. */
  incoming: string[];
  back: string;
  backLabel: string;
  answerHref: string;
  /** A mode: "You're helping Tito" or "Viewing as Pinewisp", and the way out of it. */
  helping?: {label: string; href: string; action: string};
}) {
  const t = useTranslations("draw");
  const ui = useTranslations("ui");
  const [view, setView] = useState<"reveal" | "person">(seen ? "person" : "reveal");
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [, startReveal] = useTransition();
  const asked = useRef(false);
  const [ask, setAsk] = useState(false);
  const [report, setReport] = useState(false);

  function open(then?: () => void) {
    if (asked.current) return;
    asked.current = true;
    setError(null);
    startReveal(async () => {
      const result: RevealState = await reveal(context);
      if (result.error || !result.personName || !result.personId) {
        asked.current = false;
        setError(result.error ?? t("errors.unavailable"));
        return;
      }
      setPerson({id: result.personId, name: result.personName, list: result.list});
      then?.();
    });
  }

  const banner = helping && (
    <ModeBanner icon="user" action={<AppLink href={helping.href} className={modeActionClass}>{helping.action}</AppLink>}>
      {helping.label}
    </ModeBanner>
  );

  if (view === "reveal") {
    return (
      <Screen ground="red" back={back}>
        {banner}
        {incoming.length > 0 && (
          // a question for you can be answered before you open your own person
          <ModeBanner icon="message" action={<AppLink href={answerHref} transition="push" className={modeActionClass}>{t("person.answer")}</AppLink>}>
            {t("person.incomingCard")}
          </ModeBanner>
        )}
        <UnravelReveal key={attempt} name={person?.name ?? null} onStart={() => open()}
          labels={{
            ready: t("person.revealReady"), readyHint: t("person.revealReadyHint"),
            holding: t("person.revealHolding"), holdingHint: t("person.revealHoldingHint"), holdLonger: t("person.revealHoldLonger"),
            letGo: t("person.revealLetGo"), watching: t("person.revealWatching"), watchingHint: t("person.revealWatchingHint"),
            tapToOpen: t("person.revealTap"), gift: t("person.revealGift"), progress: t("person.revealProgress"),
            lead: t("person.lead"), onlyYou: t("person.onlyYou"),
          }}
          next={person && (
            <Button icon="arrow" onClick={() => setView("person")}>{t("person.seePage", {name: person.name})}</Button>
          )} />
        {error && (
          <div className="absolute inset-x-edge top-[150px] z-10 flex flex-col gap-2">
            <ErrorBlock title={error} />
            <Button variant="outline" onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}>{t("person.tryAgain")}</Button>
          </div>
        )}
      </Screen>
    );
  }

  const name = person?.name;
  const list = person?.list;
  const empty = list && list.items.length === 0;
  const askLabel = name ? t("person.ask", {name}) : t("person.askAnonymous");
  return (
    <Screen ground="pine" back={back} actions={canAsk && (name ? !empty : false) ? (
      <>
        <Button icon="message" onClick={() => setAsk(true)}>{askLabel}</Button>
        <p className="text-center text-body">{t("person.askNote", {name: name ?? ""})}</p>
      </>
    ) : !name ? (
      <Button icon="gift" onClick={() => open()}>{t("reveal")}</Button>
    ) : undefined}>
      {banner}
      <BackRow href={back} parent={backLabel} backLabel={ui("back")}
        right={canReport && <TextButton className="text-snow-white" onClick={() => setReport(true)}>{t("report")}</TextButton>} />

      <header className="flex flex-col gap-2.5 px-edge pt-4" data-person-header="">
        {name ? (
          <h1 className="flex flex-col gap-2.5">
            <span className="text-body-strong">{t("person.lead")}</span>{" "}
            <StitchedText text={name} cell={STITCH_CELL.personPage} knit stepMs={4}
              className="max-w-full [&>svg]:h-auto [&>svg]:max-w-full" />
          </h1>
        ) : (
          <>
            <h1 className="text-title">{t("yourPerson")}</h1>
            <p className="text-lead">{t("person.hiddenHint")}</p>
          </>
        )}
        <OnlyYou>{t("person.onlyYou")}</OnlyYou>
        {error && <ErrorBlock title={error} />}
      </header>

      <KnitIn className="flex flex-col gap-3 px-edge pt-5 pb-6">
        {list && (list.sizes || list.likes) && (
          <Card className="flex flex-col gap-2 py-4">
            {list.sizes && <p className="flex items-start gap-2.5 text-body font-semibold"><Icon name="shirt" size={22} className="mt-0.5" />{list.sizes}</p>}
            {list.likes && <p className="flex items-start gap-2.5 text-body font-semibold"><Icon name="heart" size={22} className="mt-0.5" />
              <span className="min-w-0 break-words">{t("person.likes", {likes: list.likes})}</span></p>}
          </Card>
        )}
        {outgoing.map((question, index) => (
          <QuestionCard key={question.id} question={question} name={name}
            onAskAnother={canAsk && name && index === outgoing.length - 1 && question.answer !== null ? () => setAsk(true) : undefined} />
        ))}
        {incoming.length > 0 && (
          <AppLink href={answerHref} transition="push" className="fge-press block rounded-card">
            <Card as="span" className="flex flex-row items-center gap-3.5 py-4">
              <IconDisc icon="message" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-card-title">{t("person.incomingCard")}</span>
                <span className="text-body text-muted-ink">{t("person.incomingCount", {count: incoming.length})}</span>
                <span className="text-body break-words text-muted-ink">“{incoming[0]}”</span>
              </span>
              <Chevron />
            </Card>
          </AppLink>
        )}
      </KnitIn>

      {name && list && <PersonListSection name={name} id={person!.id} list={list} budget={budget}
        onAsk={canAsk ? () => setAsk(true) : undefined} />}

      {canAsk && <AskSheet open={ask} onClose={() => setAsk(false)} context={context} name={name} />}
      {canReport && <ReportSheet open={report} onClose={() => setReport(false)} context={context} name={name} />}
    </Screen>
  );
}

function PersonListSection({name, id, list, budget, onAsk}: {
  name: string; id: string; list: PersonList; budget: number | null; onAsk?: () => void;
}) {
  const t = useTranslations("draw");
  const format = useFormatter();
  const locale = useLocale();
  const money = (amount: number) => format.number(amount, {style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2});
  const count = list.items.length;
  return (
    <section aria-labelledby="person-list" className="flex flex-col pb-6">
      <SectionHeading title={<span id="person-list">{t("person.listTitle", {name})}</span>}
        count={count ? t("person.count", {count}) : t("person.nothingYet")} className="pt-1" />
      {count === 0 ? (
        <div className="px-edge">
          <Card tone="next" className="flex flex-col gap-1">
            <h3 className="text-card-title">{t("person.emptyTitle", {name})}</h3>
            <p className="pb-3 text-body text-gold-ink">{t("person.emptyHint")}</p>
            {onAsk && <Button variant="card" icon="message" onClick={onAsk}>{t("person.askForIdeas", {name})}</Button>}
          </Card>
        </div>
      ) : (
        <KnitIn as="ul" className="flex flex-col gap-3 px-edge">
          {list.items.map((item) => {
            const price = item.price === null ? null : Number(item.price);
            return (
              <ItemCard key={item.id} as="li" title={item.title}
                picture={item.photo ? <ItemPicture src={`/${locale}/lists/photo/${item.id}/${item.photo}`} /> : <NoPicture camera={false} />}
                store={item.store ?? undefined}
                price={item.store && price !== null ? money(price) : undefined}
                details={<>
                  {!item.store && price !== null && <p className="text-body font-bold">{money(price)}</p>}
                  {item.starred && <WantsLine>{t("person.starred")}</WantsLine>}
                  {price !== null && budget !== null && budget > 0 && (
                    <BudgetMeasure price={price} budget={budget}
                      underLabel={t("person.budgetUnder", {budget: money(budget)})} overLabel={t("person.budgetOver", {budget: money(budget)})} />
                  )}
                </>}
                note={item.note ?? undefined} />
            );
          })}
        </KnitIn>
      )}
      <div className="flex justify-center px-edge pt-3">
        <TextLink href={`/lists/${id}`} transition="push" prefetch={false} className="text-snow-white">
          {t("viewWishlist", {name})}
        </TextLink>
      </div>
    </section>
  );
}

function QuestionCard({question, name, onAskAnother}: {question: Outgoing; name?: string; onAskAnother?: () => void}) {
  const t = useTranslations("draw");
  if (question.answer === null) {
    return (
      <Card className="flex flex-col gap-3" data-question="waiting">
        <div className="flex items-start gap-3.5">
          <IconDisc icon="message" className="bg-pine" />
          <div className="flex min-w-0 flex-col">
            <p className="text-card-title">{name ? t("person.sentTo", {name}) : t("person.sentToAnonymous")}</p>
            <p className="text-body text-muted-ink">{t("person.sentHint")}</p>
          </div>
        </div>
        <Track className="text-body font-semibold break-words whitespace-pre-wrap">“{question.text}”</Track>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-2" data-question="answered">
      <p className="flex items-center gap-2 text-card-title"><Icon name="message" size={22} className="text-pine" />
        {name ? t("person.answeredBy", {name}) : t("person.answeredAnonymous")}</p>
      <p className="text-body break-words whitespace-pre-wrap text-muted-ink">{t("person.youAsked", {text: question.text})}</p>
      <Track className="text-body-strong break-words whitespace-pre-wrap">{question.answer}</Track>
      {onAskAnother && <Button variant="card" icon="message" className="mt-2" onClick={onAskAnother}>{t("person.askAnother")}</Button>}
    </Card>
  );
}

function AskSheet({open, onClose, context, name}: {open: boolean; onClose: () => void; context: MemberContext; name?: string}) {
  const t = useTranslations("draw");
  const ui = useTranslations("ui");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [state, submit, pending] = useActionState(
    (previous: FormState, data: FormData) => memberAction(context, {kind: "ask"}, previous, data), {});
  const id = useId();
  useEffect(() => {
    if (!state.feedback) return;
    haptic("success");
    onClose();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the sent question is cleared for the next one
    setText("");
    setPicked(null);
    window.setTimeout(() => toast(state.feedback!), 280);
  }, [state, onClose]);
  return (
    <Sheet open={open} onClose={onClose} title={name ? t("person.askSheet", {name}) : t("askTitle")} closeLabel={ui("close")}>
      <p className="text-body text-muted-ink">{t("person.askSheetLead")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("person.suggestionsLabel")}>
        {SUGGESTIONS.map((key) => (
          <Chip key={key} pressed={picked === key} onPressedChange={(on) => {
            setPicked(on ? key : null);
            if (on) setText(t(`person.suggestionText.${key}`));
          }}>{t(`person.suggestions.${key}`)}</Chip>
        ))}
      </div>
      <form id={id} action={submit} className="flex flex-col gap-3.5">
        <TextArea label={t("askLabel")} name="text" required maxLength={500} rows={3} value={text}
          onChange={(event) => setText(event.target.value)} />
        {state.error && <ErrorBlock title={state.error} />}
        <Button type="submit" variant="card" icon="message" disabled={pending}>{t("askButton")}</Button>
      </form>
    </Sheet>
  );
}

function ReportSheet({open, onClose, context, name}: {open: boolean; onClose: () => void; context: MemberContext; name?: string}) {
  const t = useTranslations("draw");
  const ui = useTranslations("ui");
  // on success the action moves on to "Fixing it quietly"
  const [state, submit, pending] = useActionState(
    (previous: FormState, data: FormData) => memberAction(context, {kind: "report"}, previous, data), {});
  return (
    <Sheet open={open} onClose={onClose} title={name ? t("person.reportTitle", {name}) : t("person.reportTitleAnonymous")} closeLabel={ui("close")}>
      <p className="text-body text-muted-ink">{t("reportHelp")} {t("person.reportLead")}</p>
      <form action={submit} className="flex flex-col gap-3">
        {state.error && <ErrorBlock title={state.error} />}
        <Button type="submit" variant="card" icon="shuffle" disabled={pending}>{t("reportButton")}</Button>
      </form>
      <TextButton onClick={onClose} className="self-center">{t("person.neverMind")}</TextButton>
    </Sheet>
  );
}
