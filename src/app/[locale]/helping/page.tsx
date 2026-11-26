import {getLocale, getTranslations} from "next-intl/server";
import {redirect} from "next/navigation";
import {ButtonLink, TextLink} from "@/components/ui/button";
import {KnitMotif} from "@/components/ui/knit/knit-motif";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {DrawError, listExchanges, memberDrawStatus} from "@/server/draw";

/** The open exchange whose person the helped person has not opened yet, if there is one. */
async function unopenedPerson(viewer: Awaited<ReturnType<typeof requireViewer>>) {
  try {
    const current = (await listExchanges(viewer)).find(({status}) => status !== "closed");
    if (!current) return null;
    const state = await memberDrawStatus(viewer, current.id);
    return state.status === "ready" && !state.seen ? {id: state.exchange.id, name: state.subjectName} : null;
  } catch (error) {
    if (error instanceof DrawError) return null;
    throw error;
  }
}

/**
 * Where helping someone starts. When their person is ready and still wrapped, handing them the phone is the
 * one thing to do; otherwise their list is.
 */
export default async function HelpingPage() {
  const viewer = await requireViewer();
  const locale = await getLocale();
  if (viewer.actingAs === viewer.personId) redirect(`/${locale}/account`);
  const ready = await unopenedPerson(viewer);
  if (!ready) redirect(`/${locale}/lists/${viewer.actingAs}`);
  const t = await getTranslations("helping");

  return (
    <Screen actions={<>
      <ButtonLink href={`/exchanges/${ready.id}`} transition="push" icon="eye" prefetch={false}>{t("show", {name: ready.name})}</ButtonLink>
      <TextLink href={`/lists/${viewer.actingAs}`} transition="push" className="self-center text-snow-white">{t("later")}</TextLink>
    </>}>
      <div className="flex flex-col items-center gap-3 px-edge pt-8 text-center">
        <h1 className="text-title">{t("readyTitle", {name: ready.name})}</h1>
        <p className="text-lead">{t("readyLead", {name: ready.name})}</p>
      </div>
      <div className="flex justify-center px-edge pt-12 pb-8">
        <KnitMotif name="gift" cell={12} className="max-w-full [&>svg]:h-auto [&>svg]:max-w-full" />
      </div>
    </Screen>
  );
}
