import {getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {requireViewer} from "@/server/auth";
import {create} from "../actions";
import {DetailsFields} from "../components";
import {FormScreen} from "../form";
import {SetupSteps} from "../setup";

export default async function NewExchangePage() {
  const viewer = await requireViewer();
  if (!viewer.isOrganizer || viewer.actingAs !== viewer.personId) notFound();
  const [t, ui] = await Promise.all([getTranslations("draw"), getTranslations("ui")]);
  return (
    <FormScreen action={create} label={t("setup.nextPeople")} back="/exchanges" top={<>
      <BackRow href="/exchanges" parent={t("title")} backLabel={ui("back")} />
      <SetupSteps step={1} />
      <PageTitle title={t("setup.exchangeTitle")} lead={t("setup.exchangeLead")} />
    </>}>
      <DetailsFields />
    </FormScreen>
  );
}
