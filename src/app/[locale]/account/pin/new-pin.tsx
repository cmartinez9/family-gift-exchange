"use client";

import {useTranslations} from "next-intl";
import {useRouter} from "@/i18n/navigation";
import {BackRow} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {toast} from "@/components/ui/toast";
import {changePin} from "../../sign-in/actions";
import {MakePin, pinForm} from "../../sign-in/pin-screens";

export function NewPin() {
  const t = useTranslations("getIn.pin");
  const you = useTranslations("getIn.you");
  const ui = useTranslations("ui");
  const router = useRouter();
  return (
    <Screen back="/account">
      <BackRow href="/account" parent={you("label")} backLabel={ui("back")} />
      <MakePin save={async (pin) => {
        const result = await changePin({}, pinForm(pin));
        if (result.success) {
          toast(t("made"));
          router.replace("/account");
        }
        return result;
      }} />
    </Screen>
  );
}
