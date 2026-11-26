import "server-only";
import type {FamilyTransaction} from "../db/database";
import {outbox} from "../db/schema";
import type {Language, Template} from "./templates";

export type Message = {
  familyId: string;
  personId: string;
  language: Language;
  dedupeKey?: string;
} & (
  | {template: Exclude<Template, "pin-reset-request">}
  | {template: "pin-reset-request"; requesterName: string}
);

export function isPushProduction() {
  return (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";
}

export async function enqueueMessages(tx: FamilyTransaction, messages: Message[]) {
  if (messages.length === 0) return;
  const insert = tx.insert(outbox).values(messages.map((message) => ({
    familyId: message.familyId,
    personId: message.personId,
    channel: "push" as const,
    language: message.language,
    template: message.template,
    requesterName: message.template === "pin-reset-request" ? message.requesterName : null,
    dedupeKey: message.dedupeKey,
    status: isPushProduction() ? "pending" as const : "captured" as const,
  })));
  // Only messages with dedupe keys need the conflict target, which requires SELECT privileges.
  if (messages.some(({dedupeKey}) => dedupeKey !== undefined)) {
    await insert.onConflictDoNothing({target: [outbox.familyId, outbox.personId, outbox.dedupeKey]});
  } else {
    await insert;
  }
}
