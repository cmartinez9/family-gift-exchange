import "server-only";
import type {FamilyTransaction} from "../db/database";
import {listEvents as messageEvents} from "../messages/events";

type ItemEvent = {
  familyId: string;
  personId: string;
  itemId: string;
  title: string;
  change: "edited" | "deleted";
};

/**
 * Enqueue in the originating transaction. For item changes, personId is already
 * resolved even for claims without an exchange; item details must stay out of notification payloads.
 */
export interface ListEvents {
  claimedItemChanged(tx: FamilyTransaction, event: ItemEvent): Promise<void>;
  budgetChanged(tx: FamilyTransaction, event: {familyId: string; exchangeId: string}): Promise<void>;
}

export const listEvents: ListEvents = {
  claimedItemChanged: (tx, {familyId, personId}) => messageEvents.claimedItemChanged({familyId, personId}, tx),
  budgetChanged: (tx, event) => messageEvents.budgetChanged(event, tx),
};
