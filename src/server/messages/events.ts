import "server-only";
import {and, eq, isNull} from "drizzle-orm";
import {organizerContacts} from "../auth/account";
import {withFamily} from "../db/client";
import type {FamilyTransaction} from "../db/database";
import {participants, people} from "../db/schema";
import {schedulePushDelivery} from "./delivery";
import {enqueueMessages, type Message} from "./queue";

type ExchangeEvent = {familyId: string; exchangeId: string};
type PlansChangedEvent = ExchangeEvent & {personIds: readonly string[]};
type ClaimedItemChangedEvent = {familyId: string; personId: string};
type PinResetRequest = {familyId: string; personId: string};

async function record(
  familyId: string,
  tx: FamilyTransaction | undefined,
  action: (tx: FamilyTransaction) => Promise<void>,
) {
  if (tx) await action(tx);
  else await withFamily(familyId, action);
  schedulePushDelivery(familyId);
}

export async function exchangeRecipients(tx: FamilyTransaction, event: ExchangeEvent) {
  return tx.select({personId: people.id, language: people.language})
    .from(participants)
    .innerJoin(people, and(eq(people.familyId, participants.familyId), eq(people.id, participants.personId)))
    .where(and(
      eq(participants.familyId, event.familyId),
      eq(participants.exchangeId, event.exchangeId),
      eq(participants.status, "in"),
      isNull(people.removedAt),
    ));
}

function notifyExchange(
  event: ExchangeEvent,
  template: "names-drawn" | "budget-changed" | "plans-changed",
  tx?: FamilyTransaction,
  personIds?: readonly string[],
) {
  return record(event.familyId, tx, async (transaction) => {
    const recipients = await exchangeRecipients(transaction, event);
    const optedIn = personIds ? recipients.filter((recipient) => personIds.includes(recipient.personId)) : recipients;
    await enqueueMessages(transaction, optedIn.map((recipient): Message => ({
      ...recipient, familyId: event.familyId, template,
    })));
  });
}

export const drawEvents = {
  namesDrawn: (event: ExchangeEvent & {personIds?: readonly string[]}, tx?: FamilyTransaction) =>
    notifyExchange(event, "names-drawn", tx, event.personIds),
  plansChanged: (event: PlansChangedEvent, tx?: FamilyTransaction) =>
    notifyExchange(event, "plans-changed", tx, event.personIds),
};

export const listEvents = {
  budgetChanged: (event: ExchangeEvent, tx?: FamilyTransaction) => notifyExchange(event, "budget-changed", tx),

  claimedItemChanged(event: ClaimedItemChangedEvent, tx: FamilyTransaction) {
    return record(event.familyId, tx, async (transaction) => {
      const recipients = await transaction.select({personId: people.id, language: people.language})
        .from(people)
        .where(and(
          eq(people.familyId, event.familyId),
          eq(people.id, event.personId),
          isNull(people.removedAt),
        ));
      await enqueueMessages(transaction, recipients.map((recipient): Message => ({
        ...recipient, familyId: event.familyId, template: "claimed-item-changed",
      })));
    });
  },
};

/** Call from sign-in after recording an accepted reset request. */
export function requestPinReset(event: PinResetRequest, tx?: FamilyTransaction) {
  return record(event.familyId, tx, async (transaction) => {
    const [requester] = await transaction.select({name: people.displayName}).from(people)
      .where(and(
        eq(people.familyId, event.familyId), eq(people.id, event.personId),
        isNull(people.removedAt), isNull(people.helperId),
      ));
    if (!requester) return;

    const organizers = (await organizerContacts(transaction, event.familyId)).filter(({personId}) => personId !== event.personId);
    await enqueueMessages(transaction, organizers.map((organizer): Message => ({
      ...organizer,
      familyId: event.familyId,
      template: "pin-reset-request",
      requesterName: requester.name,
    })));
  });
}
