import "server-only";
import {and, desc, eq, ne, sql} from "drizzle-orm";
import {withFamily} from "../db/client";
import type {FamilyTransaction} from "../db/database";
import {exchanges} from "../db/schema";
import {isListId, ListError, requireListActor, type ListViewer} from "./access";
import {listEvents, type ListEvents} from "./list-events";
import {usdAmount} from "./validation";

export function exchangeCard(tx: FamilyTransaction, familyId: string) {
  return tx.select({
    id: exchanges.id, name: exchanges.name, budgetAmount: exchanges.budgetAmount,
    giftDay: exchanges.giftDay, place: exchanges.place,
  }).from(exchanges).where(and(eq(exchanges.familyId, familyId), ne(exchanges.status, "closed")))
    .orderBy(sql`${exchanges.giftDay} desc nulls last`, desc(exchanges.id)).limit(1);
}

export async function getListExchangeCard(viewer: ListViewer) {
  return withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    const [exchange] = await exchangeCard(tx, viewer.familyId);
    return exchange ?? null;
  });
}

export async function setExchangeBudget(
  viewer: ListViewer & {isOrganizer: boolean}, exchangeId: string, rawValue: string, events: ListEvents = listEvents,
) {
  const budgetAmount = usdAmount(rawValue);
  if (budgetAmount === undefined) throw new ListError("invalid-budget");
  if (!isListId(exchangeId)) throw new ListError("not-found");
  await withFamily(viewer.familyId, async (tx) => {
    await requireListActor(tx, viewer);
    if (!viewer.isOrganizer || viewer.actingAs !== viewer.personId) throw new ListError("forbidden");
    const scope = and(eq(exchanges.familyId, viewer.familyId), eq(exchanges.id, exchangeId));
    const [exchange] = await tx.select({
      budgetAmount: exchanges.budgetAmount, status: exchanges.status,
    }).from(exchanges).where(scope).for("no key update");
    if (!exchange) throw new ListError("not-found");
    if (exchange.budgetAmount === budgetAmount) return;
    await tx.update(exchanges).set({budgetAmount}).where(scope);
    if (exchange.status === "drawn" || exchange.status === "locked") {
      await events.budgetChanged(tx, {familyId: viewer.familyId, exchangeId});
    }
  });
}
