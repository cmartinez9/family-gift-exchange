import {getTranslations} from "next-intl/server";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {requireViewer} from "@/server/auth";
import {DrawError, organizerExchange} from "@/server/draw";
import {manage} from "../../../actions";
import {DetailsFields, DrawRecovery, drawPage, PersonStatusScreen} from "../../../components";
import {FormScreen} from "../../../form";

/** The exchange's details after setup: the same rows, saved in place. */
export default async function ExchangeDetailsPage({params}: {params: Promise<{exchangeId: string}>}) {
  const viewer = await requireViewer();
  const {exchangeId} = await params;
  const [t, ui] = await Promise.all([getTranslations("draw"), getTranslations("ui")]);
  const state = await drawPage(organizerExchange(viewer, exchangeId));
  if (state instanceof DrawError) return <DrawRecovery error={state} manageId={exchangeId} />;
  const hub = `/exchanges/${state.exchange.id}/manage`;
  if (state.exchange.status === "closed") {
    return <PersonStatusScreen status="closed" details={state.exchange} back={hub} backLabel={state.exchange.name} />;
  }
  return (
    <FormScreen action={manage.bind(null, state.exchange.id, {kind: "edit"})} label={t("saveDetails")} icon="check" back={hub} top={<>
      <BackRow href={hub} parent={state.exchange.name} backLabel={ui("back")} />
      <PageTitle title={t("setup.exchangeRow")} lead={t("setup.exchangeEditLead")} />
    </>}>
      <DetailsFields details={state.exchange} />
    </FormScreen>
  );
}
