"use client";

import {useTranslations} from "next-intl";
import {useRouter} from "@/i18n/navigation";
import {ErrorBlock} from "@/components/ui/blocks";
import {Button} from "@/components/ui/button";
import {Screen} from "@/components/ui/screen";
import {WelcomeSteps} from "../../sign-in/get-in";

export default function BorrowedPhoneError({reset}: {reset: () => void}) {
  const t = useTranslations("borrowed");
  const draw = useTranslations("draw");
  const router = useRouter();
  return (
    <Screen label={t("title")}>
      <WelcomeSteps step={2} />
      <div className="flex flex-col gap-3 px-edge pt-10">
        <ErrorBlock title={t("revealFailed")} />
        <Button onClick={() => { router.refresh(); reset(); }}>{draw("person.tryAgain")}</Button>
      </div>
    </Screen>
  );
}
