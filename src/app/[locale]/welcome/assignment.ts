import "server-only";
import type {Viewer} from "@/server/auth";
import {myPerson} from "@/server/draw";
import {getListExchangeCard} from "@/server/lists";

export async function welcomeAssignment(viewer: Viewer) {
  const exchange = await getListExchangeCard(viewer);
  if (!exchange) return null;
  const assignment = await myPerson(viewer, exchange.id);
  return assignment && {...assignment, exchangeId: exchange.id, budgetAmount: exchange.budgetAmount};
}
