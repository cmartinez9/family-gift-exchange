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

/** Phase 4 can enqueue within the originating transaction. personId is the destination. */
export interface ListEvents {
  claimedItemChanged(tx: FamilyTransaction, event: ItemEvent): Promise<void>;
  budgetChanged(tx: FamilyTransaction, event: {familyId: string; exchangeId: string}): Promise<void>;
}

export const listEvents: ListEvents = {
  claimedItemChanged: (tx, {familyId, personId}) => messageEvents.claimedItemChanged({familyId, personId}, tx),
  budgetChanged: (tx, event) => messageEvents.budgetChanged(event, tx),
};
