import {getTranslations} from "next-intl/server";
import {ButtonLink} from "@/components/ui/button";
import {ErrorBlock} from "@/components/ui/blocks";
import {Screen} from "@/components/ui/screen";

export default async function ListNotFound() {
  const t = await getTranslations("lists");
  return (
    <Screen label={t("feedback.not-found")}>
      <div className="flex flex-col gap-4 px-edge pt-12">
        <h1 className="sr-only">{t("feedback.not-found")}</h1>
        <ErrorBlock live={false} title={t("feedback.not-found")}
          action={<ButtonLink variant="card" href="/lists" transition="back" icon="family">{t("familyLists")}</ButtonLink>} />
      </div>
    </Screen>
  );
}
