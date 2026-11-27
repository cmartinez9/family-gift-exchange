"use client";

import {useTranslations} from "next-intl";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button} from "@/components/ui/button";
import {Screen} from "@/components/ui/screen";
import {WelcomeSteps} from "../../sign-in/get-in";

export default function BorrowedPhoneError() {
  const t = useTranslations("borrowed");
  const draw = useTranslations("draw");
  return (
    <Screen label={t("title")}>
      <WelcomeSteps step={2} />
      <div className="flex flex-col gap-3 px-edge pt-10">
        <h1 className="text-section">{t("title")}</h1>
        <ErrorBlock title={t("revealFailed")} />
        <Button onClick={() => window.location.reload()}>{draw("person.tryAgain")}</Button>
      </div>
    </Screen>
  );
}
