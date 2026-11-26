"use client";

import {useTranslations} from "next-intl";
import {useActionState, useEffect, useId} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, ButtonLink, TextLink} from "@/components/ui/button";
import {Card, Track} from "@/components/ui/card";
import {TextArea} from "@/components/ui/inputs";
import {haptic} from "@/components/ui/motion/haptic";
import {KnitIn} from "@/components/ui/motion/knit-in";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {toast} from "@/components/ui/toast";
import {memberAction, type FormState, type MemberContext} from "./actions";

type Incoming = {id: string; text: string; answered: boolean};

/**
 * A question for you: the person who has you asked it. One at a time, on the red ground; the answer
 * goes only to them. Answered questions stay as quiet cards.
 */
export function AnswerScreen({context, questions, back, backLabel}: {
  context: MemberContext; questions: Incoming[]; back: string; backLabel: string;
}) {
  const t = useTranslations("draw");
  const ui = useTranslations("ui");
  const next = questions.find(({answered}) => !answered);
  const answered = questions.filter(({answered}) => answered);
  const formId = useId();
  const [state, submit, pending] = useActionState(
    (previous: FormState, data: FormData) => next
      ? memberAction(context, {kind: "answer", questionId: next.id}, previous, data)
      : Promise.resolve(previous),
    {});
  useEffect(() => {
    if (!state.feedback) return;
    haptic("success");
    toast(state.feedback);
  }, [state]);

  return (
    <Screen back={back} actions={next ? (
      <>
        <Button type="submit" form={formId} icon="message" disabled={pending}>{t("answerButton")}</Button>
        <TextLink href={back} transition="back" className="self-center text-snow-white">{t("person.later")}</TextLink>
      </>
    ) : <ButtonLink href={back} transition="back">{t("person.done")}</ButtonLink>}>
      <BackRow href={back} parent={backLabel} backLabel={ui("back")} />
      <PageTitle title={next || !answered.length ? t("person.incomingTitle") : t("person.incomingDone")}
        lead={next ? t("person.incomingLead") : answered.length ? t("person.incomingDoneLead") : t("noIncoming")} />
      <KnitIn className="flex flex-col gap-3 px-edge pt-6 pb-6">
        {next && (
          <Card key={next.id}>
            <form id={formId} action={submit} className="flex flex-col gap-3">
              <h2 className="text-card-title break-words whitespace-pre-wrap">{next.text}</h2>
              <TextArea label={t("answerLabel")} name="text" required maxLength={500} rows={3} className="[&_textarea]:bg-snow-white" />
              {state.error && <ErrorBlock title={state.error} />}
            </form>
          </Card>
        )}
        {answered.map(({id, text}) => (
          <Card key={id} className="flex flex-col gap-2 py-4">
            <p className="text-row-title break-words whitespace-pre-wrap">{text}</p>
            <Track className="text-body font-semibold text-muted-ink">{t("answered")}</Track>
          </Card>
        ))}
      </KnitIn>
    </Screen>
  );
}
