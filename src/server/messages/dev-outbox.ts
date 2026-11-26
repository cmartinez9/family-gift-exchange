import "server-only";
import {and, desc, eq} from "drizzle-orm";
import {getDatabase} from "../db/client";
import {outbox} from "../db/schema";
import {readTemplateContent, renderMessage} from "./templates";

export async function listCapturedMessages() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("The outbox viewer requires a development server");
  }

  const messages = await getDatabase()
    .select({
      id: outbox.id,
      personId: outbox.personId,
      channel: outbox.channel,
      language: outbox.language,
      template: outbox.template,
      requesterName: outbox.requesterName,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .where(and(eq(outbox.status, "captured"), eq(outbox.channel, "push")))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(100);
  return messages.flatMap(({requesterName, ...message}) => {
    const content = readTemplateContent({template: message.template, requesterName});
    return content ? [{...message, ...renderMessage(message.language, content)}] : [];
  });
}
