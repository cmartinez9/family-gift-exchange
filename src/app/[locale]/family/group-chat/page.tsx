import {getLocale, getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {Link} from "@/i18n/navigation";
import {requireViewer} from "@/server/auth";
import {appOrigin} from "@/server/auth/request";
import {groupChatMessages} from "@/server/messages/group-chat";
import {ShareMessage} from "./share-message";

export default async function GroupChatPage() {
  const viewer = await requireViewer();
  if (!viewer.isOrganizer || viewer.personId !== viewer.actingAs) notFound();
  const [locale, t] = await Promise.all([getLocale(), getTranslations("notify.groupChat")]);
  const messages = groupChatMessages(locale, appOrigin().href, viewer.familyId);

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6 text-lg">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Link href="/family" className="inline-flex min-h-12 items-center underline">{t("back")}</Link>
      {messages.map(({id, text, whatsapp}) => (
        <section key={id} className="space-y-2 border-b border-current/25 pb-3" aria-labelledby={id}>
          <h2 id={id} className="text-xl font-semibold">{t(`topic.${id}`)}</h2>
          <ShareMessage text={text} whatsapp={whatsapp} />
        </section>
      ))}
    </main>
  );
}
