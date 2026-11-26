"use client";

import {useTranslations} from "next-intl";
import {useActionState, useEffect, useId} from "react";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button, TextLink} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {TextField} from "@/components/ui/inputs";
import {haptic} from "@/components/ui/motion/haptic";
import {Screen} from "@/components/ui/screen";
import {startFamily, type AuthResult} from "../sign-in/actions";

/** The organizer's first form: the invitation, the family's name, your name and a PIN, on one yarn block. */
export function StartForm({hero}: {hero: React.ReactNode}) {
  const t = useTranslations("auth");
  const setup = useTranslations("draw.setup");
  const id = useId();
  const [state, submit, pending] = useActionState<AuthResult, FormData>(startFamily, {});
  useEffect(() => {
    if (state.error) haptic("error");
  }, [state]);
  return (
    <Screen actions={<>
      <Button type="submit" form={id} icon="arrow" disabled={pending}>{t("createFamily")}</Button>
      <TextLink href="/" className="self-center text-snow-white">{t("back")}</TextLink>
    </>}>
      {hero}
      <form id={id} action={submit} className="flex flex-col gap-3 px-edge pt-6 pb-4">
        <Card className="flex flex-col gap-4">
          <TextField label={t("organizerInvite")} name="invite" maxLength={128} required autoComplete="off" />
          <TextField label={t("familyName")} name="familyName" maxLength={80} required placeholder={setup("familyPlaceholder")} />
          <TextField label={t("yourName")} name="displayName" maxLength={60} required autoComplete="given-name" />
        </Card>
        <Card className="flex flex-col gap-4">
          <p className="text-body text-muted-ink">{t("makePin")}</p>
          <TextField label={t("pin")} name="pin" type="password" autoComplete="new-password" inputMode="numeric"
            pattern="[0-9]{4}" maxLength={4} required />
          <TextField label={t("confirmPin")} name="confirmation" type="password" autoComplete="new-password" inputMode="numeric"
            pattern="[0-9]{4}" maxLength={4} required />
        </Card>
        {state.error && <ErrorBlock title={t(`feedback.${state.error}` as Parameters<typeof t>[0])} />}
      </form>
    </Screen>
  );
}
