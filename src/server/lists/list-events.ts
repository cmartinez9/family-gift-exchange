import "server-only";
import type {FamilyTransaction} from "../db/database";

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

// TODO(phase 4): wire these handlers to the message queue.
export const listEvents: ListEvents = {
  async claimedItemChanged() {},
  async budgetChanged() {},
};
