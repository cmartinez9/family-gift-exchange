import {getTranslations} from "next-intl/server";
import {notFound} from "next/navigation";
import {listCapturedMessages} from "@/server/messages/dev-outbox";

export const dynamic = "force-dynamic";

export default async function DevMessagesPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const [messages, t] = await Promise.all([
    listCapturedMessages(),
    getTranslations({locale: "en", namespace: "devMessages"}),
  ]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {messages.length === 0 ? (
        <p className="mt-4">{t("empty")}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {messages.map((message) => (
            <li key={message.id}>
              <dl>
                <dt>{t("created")}</dt>
                <dd><time dateTime={message.createdAt.toISOString()}>{message.createdAt.toISOString()}</time></dd>
                <dt>{t("channel")}</dt>
                <dd>{message.channel}</dd>
                <dt>{t("template")}</dt>
                <dd>{message.template}</dd>
                <dt>{t("language")}</dt>
                <dd>{message.language}</dd>
                <dt>{t("person")}</dt>
                <dd>{message.personId}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
