import type {FamilyTransaction} from "../db/database";

export type DrawEvent = {
  kind: "drawn" | "redrawn" | "reassigned" | "budgetChanged";
  familyId: string;
  exchangeId: string;
  version: number;
};

export type DrawEvents = {
  // Queue inside the draw transaction. Destinations are private delivery
  // routing and never part of templates or any organizer-facing response.
  publish(tx: FamilyTransaction, event: DrawEvent, destinations: readonly string[]): Promise<void>;
};

export async function publishDraw(
  events: DrawEvents | undefined,
  tx: FamilyTransaction,
  event: DrawEvent,
  destinations: readonly string[],
) {
  if (destinations.length) await events?.publish(tx, event, destinations);
}
