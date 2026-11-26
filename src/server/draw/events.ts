import type {FamilyTransaction} from "../db/database";
import {drawEvents, listEvents} from "../messages/events";

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

const notificationPublisher: DrawEvents = {
  publish(tx, {kind, familyId, exchangeId}, destinations) {
    const event = {familyId, exchangeId};
    switch (kind) {
      case "drawn":
        return drawEvents.namesDrawn({...event, personIds: destinations}, tx);
      case "redrawn":
      case "reassigned":
        return drawEvents.plansChanged({...event, personIds: destinations}, tx);
      case "budgetChanged":
        return listEvents.budgetChanged(event, tx);
    }
  },
};

export async function publishDraw(
  events: DrawEvents = notificationPublisher,
  tx: FamilyTransaction,
  event: DrawEvent,
  destinations: readonly string[],
) {
  if (destinations.length) await events.publish(tx, event, destinations);
}
