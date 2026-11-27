import {getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {BackRow, PageTitle} from "@/components/ui/page-header";
import {Screen} from "@/components/ui/screen";
import {requireViewer} from "@/server/auth";
import {appOrigin} from "@/server/auth/request";
import {DrawError, listExchanges} from "@/server/draw";
import {groupChatMessages} from "@/server/messages/group-chat";
import {ShareMessage} from "./share-message";

/** The message that fits the season: the draw's news once names are drawn, otherwise the wishlist nudge. */
async function seasonTopic(viewer: Awaited<ReturnType<typeof requireViewer>>) {
  try {
    const exchanges = await listExchanges(viewer);
    return exchanges.some(({status}) => status === "drawn" || status === "locked") ? "draw" : "wishlists";
  } catch (error) {
    if (error instanceof DrawError) return "wishlists";
    throw error;
  }
}

export default async function GroupChatPage() {
  const viewer = await requireViewer();
  if (!viewer.isOrganizer || viewer.personId !== viewer.actingAs) notFound();
  const [locale, t, ui, topic] = await Promise.all([
    getLocale(), getTranslations("notify.groupChat"), getTranslations("ui"), seasonTopic(viewer),
  ]);
  const messages = groupChatMessages(locale, appOrigin().href, viewer.familyId)
    .map(({id, text}) => ({id, text, topic: t(`topic.${id}`), chip: t(`chip.${id}`)}));

  return (
    <Screen back="/family">
      <BackRow href="/family" parent={t("parent")} backLabel={ui("back")} />
      <PageTitle title={t("heading")} lead={t("lead")} />
      <ShareMessage messages={messages} initial={topic} />
    </Screen>
  );
}
