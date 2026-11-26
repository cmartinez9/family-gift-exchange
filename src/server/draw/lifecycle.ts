import {and, eq, inArray} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {exchanges, participants} from "../db/schema";
import {
  authorizeSubject, DrawError, lockOrganizer, requireOrganizer, type DrawViewer,
} from "./access";
import {publishDraw, type DrawEvents} from "./events";
import {selectRoster} from "./exchange";
import {participantIds, recordId} from "./inputs";
import {insertIntoDraw, removeFromDraw, repairReportedPair} from "./repair";
import {assignments, drawReports, questions} from "./schema";
import {drawSeal, encryptionKey, sealText} from "./sealing";
import {checkRules, inspectDraw, maximumPeople, solveDraw, type Pairs} from "./solver";
import {
  assignmentScope, auditedDraw, authorizeSealedSubject, checkVersion, currentParticipants, exchangeScope,
  InvalidSeal, liveRoster, loadDraftRules, loadExchange, loadPairs, loadSnapshot, participantScope, requireOpen,
  saveSnapshot, snapshotRules, type Exchange, type RuleSnapshot,
} from "./store";

export const redrawConfirmation = {en: "REDRAW", es: "VOLVER A SORTEAR"} as const;

function deadline(ms: number) {
  const end = performance.now() + ms;
  return () => {
    if (performance.now() > end) throw new DrawError("checkTimedOut");
  };
}

export async function drawFeasibility(viewer: DrawViewer, id: string) {
  requireOrganizer(viewer);
  return auditedDraw(viewer.familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, viewer.familyId, recordId(id));
    requireOpen(exchange);
    const snapshot = exchange.version
      ? await loadSnapshot(tx, viewer.familyId, exchange.id)
      : await loadDraftRules(tx, viewer.familyId, exchange.id);
    return checkRules(snapshotRules(snapshot), {checkTime: deadline(1500)});
  });
}

export async function dryRunDraw(viewer: DrawViewer, id: string) {
  requireOrganizer(viewer);
  const snapshot = await auditedDraw(viewer.familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, viewer.familyId, recordId(id));
    requireOpen(exchange);
    return exchange.version
      ? loadSnapshot(tx, viewer.familyId, exchange.id)
      : loadDraftRules(tx, viewer.familyId, exchange.id);
  });
  const rules = snapshotRules(snapshot);
  const checkTime = deadline(8000);
  const {possible, fewestChoices} = checkRules(rules, {checkTime});
  if (possible) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (!solveDraw(rules, {checkTime})) throw new Error("Feasibility changed during dry run");
    }
  }
  return {possible, fewestChoices};
}

function questionScope(familyId: string, exchangeId: string) {
  return and(eq(questions.familyId, familyId), eq(questions.exchangeId, exchangeId));
}

async function writeDraw(
  tx: FamilyTransaction, familyId: string, exchange: Exchange,
  pairs: Pairs, snapshot: RuleSnapshot, status: "drawn" | "locked",
  previous?: Pairs,
) {
  const exchangeId = exchange.id;
  const version = exchange.version + 1;
  const key = encryptionKey();
  const seal = drawSeal(key, familyId, exchangeId, version, pairs);
  const replacement = [...pairs].map(([giverId, recipientId]) => ({
    familyId, exchangeId, giverId, version,
    recipientSealed: sealText(key, {field: "assignment", familyId, exchangeId, giverId, version}, recipientId),
  }));

  await tx.delete(assignments).where(assignmentScope(familyId, exchangeId));
  await tx.insert(assignments).values(replacement);
  await saveSnapshot(tx, familyId, exchangeId, snapshot);
  await tx.update(exchanges).set({drawVersion: version, seal, status}).where(exchangeScope(familyId, exchangeId));

  const scope = participantScope(familyId, exchangeId);
  if (!previous) {
    await tx.update(participants).set({seenVersion: null}).where(scope);
    await tx.delete(questions).where(questionScope(familyId, exchangeId));
    return {version, seal, participantCount: pairs.size};
  }

  // Preserve seen status only when the person still has the same recipient.
  const reset = [...previous].filter(([giver, recipient]) => pairs.get(giver) !== recipient)
    .map(([giver]) => giver);
  if (reset.length) {
    await tx.update(participants).set({seenVersion: null})
      .where(and(scope, inArray(participants.personId, reset)));
    await tx.delete(questions).where(and(questionScope(familyId, exchangeId), inArray(questions.askerId, reset)));
  }
  await tx.update(participants).set({seenVersion: version})
    .where(and(scope, eq(participants.status, "in"), eq(participants.seenVersion, exchange.version)));

  return {version, seal, participantCount: pairs.size};
}

export async function runDraw(
  viewer: DrawViewer, id: string,
  request: {expectedVersion: number; confirmation?: string; selection?: readonly string[]},
  events?: DrawEvents,
) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return auditedDraw(familyId, async (tx) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    checkVersion(exchange, request.expectedVersion);
    // The persisted lock also covers a member who opened it on a different device.
    if (exchange.status === "locked" && !Object.values(redrawConfirmation).some((value) =>
      value === request.confirmation?.trim()
    )) throw new DrawError("confirmationRequired");
    if (request.selection) await selectRoster(tx, familyId, exchange.id, participantIds(request.selection));

    const snapshot = await loadDraftRules(tx, familyId, exchange.id);
    if (snapshot.roster.length > maximumPeople) throw new DrawError("invalidParticipants");
    const pairs = solveDraw(snapshotRules(snapshot), {checkTime: deadline(1500)});
    if (!pairs) throw new DrawError("drawImpossible");

    const summary = await writeDraw(tx, familyId, exchange, pairs, snapshot, "drawn");
    await publishDraw(events, tx, {
      kind: exchange.version ? "redrawn" : "drawn",
      familyId, exchangeId: exchange.id, version: summary.version,
    }, [...pairs.keys()]);
    return summary;
  });
}

export async function checkSealedDraw(viewer: DrawViewer, id: string) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return auditedDraw(familyId, async (tx, decrypt) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    if (exchange.status === "closed") return {status: "closed" as const};
    if (!exchange.version) return {status: "pending" as const};

    const snapshot = await loadSnapshot(tx, familyId, exchange.id);
    try {
      const pairs = await loadPairs(tx, familyId, exchange, decrypt, "check");
      const inspection = inspectDraw(snapshotRules(snapshot), pairs, snapshot.keepApart);
      const active = (await currentParticipants(tx, familyId, exchange.id)).filter(({status}) => status === "in");
      const roster = new Set(snapshot.roster.map(({id}) => id));
      const rosterMatches = active.length === roster.size && active.every(({id}) => roster.has(id));
      const sealMatches = drawSeal(encryptionKey(), familyId, exchange.id, exchange.version, pairs) === exchange.seal;
      return {
        status: "checked" as const, ...inspection, rosterMatches, sealMatches,
        valid: inspection.valid && rosterMatches && sealMatches,
        count: active.length, seal: exchange.seal,
      };
    } catch (error) {
      if (error instanceof InvalidSeal) return {status: "invalidSeal" as const};
      throw error;
    }
  });
}

async function writeRepair(
  tx: FamilyTransaction, viewer: DrawViewer, exchange: Exchange, snapshot: RuleSnapshot,
  previous: Pairs, next: Pairs | null, events?: DrawEvents,
) {
  if (!next) throw new DrawError("repairImpossible");
  const familyId = viewer.familyId;
  const status = exchange.status === "locked" ? "locked" : "drawn";
  const summary = await writeDraw(tx, familyId, exchange, next, snapshot, status, previous);
  const destinations = [...next].filter(([giver, recipient]) => previous.get(giver) !== recipient)
    .map(([giver]) => giver);
  await publishDraw(events, tx, {
    kind: "reassigned", familyId, exchangeId: exchange.id, version: summary.version,
  }, destinations);
  return {...summary, changedGivers: destinations.filter((giver) => previous.has(giver)).length};
}

export async function changeParticipation(
  viewer: DrawViewer, id: string, person: string, status: "in" | "out", expectedVersion: number, events?: DrawEvents,
) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  const personId = recordId(person);
  if (status !== "in" && status !== "out") throw new DrawError("invalidParticipants");

  return auditedDraw(familyId, async (tx, decrypt) => {
    await lockOrganizer(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    checkVersion(exchange, expectedVersion);
    const current = await currentParticipants(tx, familyId, exchange.id);
    const included = current.some(({id, status}) => id === personId && status === "in");
    if (included === (status === "in")) {
      return {
        version: exchange.version, seal: exchange.seal, changedGivers: 0,
        participantCount: current.filter(({status}) => status === "in").length,
      };
    }

    const member = status === "in" ? (await liveRoster(tx, familyId)).find(({id}) => id === personId) : null;
    if (status === "in" && !member) throw new DrawError("invalidParticipants");
    await tx.insert(participants).values({familyId, exchangeId: exchange.id, personId, status})
      .onConflictDoUpdate({
        target: [participants.familyId, participants.exchangeId, participants.personId], set: {status, seenVersion: null},
      });
    if (!exchange.version) return {
      version: 0, seal: null, changedGivers: 0,
      participantCount: current.filter(({status}) => status === "in").length + (member ? 1 : -1),
    };

    const snapshot = await loadSnapshot(tx, familyId, exchange.id);
    const previous = await loadPairs(tx, familyId, exchange, decrypt, "repair");
    if (member) {
      const {id, helperId, householdId} = member;
      snapshot.roster.push({id, helperId, householdId});
      if (snapshot.roster.length > maximumPeople) throw new DrawError("invalidParticipants");
      const updated = insertIntoDraw(snapshotRules(snapshot), previous, personId);
      return writeRepair(tx, viewer, exchange, snapshot, previous, updated, events);
    }
    snapshot.roster = snapshot.roster.filter(({id}) => id !== personId);
    const updated = removeFromDraw(snapshotRules(snapshot), previous, personId);
    return writeRepair(tx, viewer, exchange, snapshot, previous, updated, events);
  });
}

export async function reportPair(
  viewer: DrawViewer, id: string, expectedVersion: number, events?: DrawEvents,
) {
  const familyId = viewer.familyId;
  return auditedDraw(familyId, async (tx, decrypt) => {
    await authorizeSubject(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    checkVersion(exchange, expectedVersion);
    if (!exchange.version) throw new DrawError("revealFirst");
    const snapshot = await loadSnapshot(tx, familyId, exchange.id);
    authorizeSealedSubject(snapshot, viewer);
    const [seen] = await tx.select({version: participants.seenVersion}).from(participants).where(and(
      participantScope(familyId, exchange.id), eq(participants.personId, viewer.actingAs), eq(participants.status, "in"),
    ));
    if (seen?.version !== exchange.version) throw new DrawError("revealFirst");
    const inserted = await tx.insert(drawReports)
      .values({familyId, exchangeId: exchange.id, giverId: viewer.actingAs}).onConflictDoNothing();
    if (!inserted.rowCount) throw new DrawError("alreadyReported");

    const previous = await loadPairs(tx, familyId, exchange, decrypt, "repair");
    const next = repairReportedPair(snapshotRules(snapshot), previous, viewer.actingAs);
    const {version} = await writeRepair(tx, viewer, exchange, snapshot, previous, next, events);
    return {version};
  });
}
