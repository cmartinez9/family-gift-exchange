import "server-only";
import {withFamily} from "../db/client";
import {outbox} from "../db/schema";

type OutboxRow = typeof outbox.$inferSelect;

export type Message = Pick<OutboxRow, "familyId" | "personId" | "language"> & {
  template: "practice-reminder";
};

/** Capture a message or queue it for the future production delivery worker. */
export async function sendMessage(message: Message): Promise<void> {
  const isProduction = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";

  await withFamily(message.familyId, async (transaction) => {
    await transaction.insert(outbox).values({
      familyId: message.familyId,
      personId: message.personId,
      channel: "push",
      language: message.language,
      template: message.template,
      status: isProduction ? "pending" : "captured",
    });
  });
}
