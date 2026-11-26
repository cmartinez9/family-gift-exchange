import {and, desc, eq, inArray, ne, sql} from "drizzle-orm";
import {exchanges, keepApart, participants, people} from "../db/schema";
import type {FamilyTransaction} from "../db/database";
import {
  authorizeSubject, DrawError, lockOrganizer, requireOrganizer, withDrawFamily, type DrawViewer,
} from "./access";
import {publishDraw, type DrawEvents} from "./events";
import {exchangeDetails, participantIds, recordId, type ExchangeDetails} from "./inputs";
import {assignments, drawRuleSnapshots, questions} from "./schema";
import {
  assignmentScope, currentParticipants, exchangeFields, exchangeScope, liveRoster, loadExchange,
  participantScope, requireOpen,
} from "./store";

export async function createExchange(viewer: DrawViewer, details: ExchangeDetails) {
  requireOrganizer(viewer);
  return withDrawFamily(viewer.familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const [open] = await tx.select({id: exchanges.id}).from(exchanges)
      .where(and(eq(exchanges.familyId, viewer.familyId), ne(exchanges.status, "closed"))).limit(1);
    if (open) throw new DrawError("exchangeAlreadyOpen");
    const [exchange] = await tx.insert(exchanges)
      .values({familyId: viewer.familyId, ...exchangeDetails(details), status: "open"})
      .returning({id: exchanges.id});
    return exchange;
  }, "update");
}

export async function editExchange(
  viewer: DrawViewer, id: string, input: ExchangeDetails, events?: DrawEvents,
) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return withDrawFamily(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    const details = exchangeDetails(input);
    await tx.update(exchanges).set({
      ...details, status: exchange.status === "setup" ? "open" : exchange.status,
    }).where(exchangeScope(familyId, exchange.id));
    if (exchange.version && details.budgetAmount !== exchange.budgetAmount) {
      const active = (await currentParticipants(tx, familyId, exchange.id)).filter(({status}) => status === "in");
      await publishDraw(events, tx, {
        kind: "budgetChanged", familyId, exchangeId: exchange.id, version: exchange.version,
      }, active.map(({id}) => id));
    }
  });
}

export async function closeExchange(viewer: DrawViewer, id: string) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return withDrawFamily(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    await tx.update(exchanges).set({status: "closed"}).where(exchangeScope(familyId, exchange.id));
    // A closed exchange retains its details and seal, with no pairing history.
    await tx.delete(assignments).where(assignmentScope(familyId, exchange.id));
    await tx.delete(questions).where(and(eq(questions.familyId, familyId), eq(questions.exchangeId, exchange.id)));
    await tx.delete(drawRuleSnapshots).where(and(
      eq(drawRuleSnapshots.familyId, familyId), eq(drawRuleSnapshots.exchangeId, exchange.id),
    ));
  });
}

export async function listExchanges(viewer: DrawViewer) {
  return withDrawFamily(viewer.familyId, async (tx) => {
    await authorizeSubject(tx, viewer);
    return tx.select(exchangeFields).from(exchanges).where(eq(exchanges.familyId, viewer.familyId))
      .orderBy(sql`(${exchanges.status} = 'closed')`, desc(exchanges.giftDay), exchanges.name);
  });
}

export async function organizerExchange(viewer: DrawViewer, id: string) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return withDrawFamily(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    const members = await liveRoster(tx, familyId);
    const current = await currentParticipants(tx, familyId, exchange.id);
    const rules = await tx.select({
      personA: keepApart.personA, personB: keepApart.personB, reason: keepApart.reason,
    }).from(keepApart).where(and(eq(keepApart.familyId, familyId), eq(keepApart.exchangeId, exchange.id)));
    const active = new Set(current.filter(({status}) => status === "in").map(({id}) => id));
    const names = new Map(members.map(({id, displayName}) => [id, displayName]));
    // Include inactive profiles still in the exchange, so a soft-removed person can drop out.
    const missing = [...active].filter((id) => !names.has(id));
    if (missing.length) {
      const inactive = await tx.select({id: people.id, displayName: people.displayName})
        .from(people).where(and(eq(people.familyId, familyId), inArray(people.id, missing)));
      for (const {id, displayName} of inactive) names.set(id, displayName);
    }
    return {
      exchange, rules, participantCount: active.size,
      seenCount: exchange.version
        ? current.filter(({status, seenVersion}) => status === "in" && seenVersion === exchange.version).length
        : 0,
      people: [...names].map(([personId, displayName]) => ({
        id: personId, displayName, participating: active.has(personId), available: !missing.includes(personId),
      })),
    };
  });
}

export async function selectRoster(
  tx: FamilyTransaction, familyId: string, exchangeId: string, selected: readonly string[],
) {
  const members = new Set((await liveRoster(tx, familyId)).map(({id}) => id));
  if (selected.some((id) => !members.has(id))) throw new DrawError("invalidParticipants");
  await tx.update(participants).set({status: "out", seenVersion: null})
    .where(participantScope(familyId, exchangeId));
  if (selected.length) {
    await tx.insert(participants).values(selected.map((personId) => ({familyId, exchangeId, personId})))
      .onConflictDoUpdate({
        target: [participants.familyId, participants.exchangeId, participants.personId],
        set: {status: "in", seenVersion: null},
      });
  }
}

export async function setParticipants(viewer: DrawViewer, id: string, selection: readonly string[]) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return withDrawFamily(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    if (exchange.version) throw new DrawError("drawLocked");
    await selectRoster(tx, familyId, exchange.id, participantIds(selection));
  });
}

export async function setKeepApart(
  viewer: DrawViewer, id: string, first: string, second: string, reason: "partner" | "custom" | null,
) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  const [personA, personB] = participantIds([first, second]).sort();
  if (!personB || (reason !== null && reason !== "partner" && reason !== "custom")) {
    throw new DrawError("invalidKeepApart");
  }
  return withDrawFamily(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    if (exchange.version) throw new DrawError("drawLocked");
    if (reason === null) {
      await tx.delete(keepApart).where(and(
        eq(keepApart.familyId, familyId), eq(keepApart.exchangeId, exchange.id),
        eq(keepApart.personA, personA), eq(keepApart.personB, personB),
      ));
      return;
    }
    const members = new Set((await liveRoster(tx, familyId)).map(({id}) => id));
    if (!members.has(personA) || !members.has(personB)) throw new DrawError("invalidKeepApart");
    await tx.insert(participants).values([personA, personB].map((personId) => ({
      familyId, exchangeId: exchange.id, personId, status: "out" as const,
    }))).onConflictDoNothing();
    await tx.insert(keepApart).values({familyId, exchangeId: exchange.id, personA, personB, reason})
      .onConflictDoUpdate({
        target: [keepApart.familyId, keepApart.exchangeId, keepApart.personA, keepApart.personB],
        set: {reason},
      });
  });
}

export async function previewAsMember(viewer: DrawViewer, id: string, personId: string) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return withDrawFamily(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    const subjectId = recordId(personId);
    const member = (await liveRoster(tx, familyId)).find(({id}) => id === subjectId);
    if (!member) throw new DrawError("notFound");
    return {
      displayName: member.displayName,
      exchange: {
        name: exchange.name, giftDay: exchange.giftDay, giftTime: exchange.giftTime,
        place: exchange.place, budgetAmount: exchange.budgetAmount,
        listDeadline: exchange.listDeadline, drawDay: exchange.drawDay,
      },
      draw: "hiddenInPreview" as const,
    };
  });
}
