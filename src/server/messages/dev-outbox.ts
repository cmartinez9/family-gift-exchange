import "server-only";
import {desc, eq} from "drizzle-orm";
import {getDatabase} from "../db/client";
import {outbox} from "../db/schema";

export async function listCapturedMessages() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("The outbox viewer requires a development server");
  }

  return getDatabase()
    .select({
      id: outbox.id,
      personId: outbox.personId,
      channel: outbox.channel,
      language: outbox.language,
      template: outbox.template,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .where(eq(outbox.status, "captured"))
    .orderBy(desc(outbox.createdAt), desc(outbox.id))
    .limit(100);
}
