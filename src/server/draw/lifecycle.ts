import {and, eq} from "drizzle-orm";
import {exchanges, participants} from "../db/schema";
import {
  authorizeSubject, DrawError, lockOrganizer, requireOrganizer, type DrawViewer,
} from "./access";
import {publishDraw, type DrawEvents} from "./events";
import {selectRoster} from "./exchange";
import {participantIds, recordId} from "./inputs";
import {insertIntoDraw, removeFromDraw, repairReportedPair} from "./repair";
import {drawReports} from "./schema";
import {drawSeal, encryptionKey} from "./sealing";
import {checkRules, inspectDraw, maximumPeople, solveDraw} from "./solver";
import {
  auditedDraw, authorizeSealedSubject, checkVersion, currentParticipants, disputedGivers, exchangeScope,
  InvalidSeal, liveRoster, loadDraftRules, loadExchange, loadPairs, loadSnapshot, participantScope, requireOpen,
  privateDrawRepair, snapshotRules, writeDraw, writeRepair,
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
  return auditedDraw(viewer, async (tx) => {
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
  const snapshot = await auditedDraw(viewer, async (tx) => {
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

export async function runDraw(
  viewer: DrawViewer, id: string,
  request: {expectedVersion: number; confirmation?: string; selection?: readonly string[]},
  events?: DrawEvents,
) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return auditedDraw(viewer, async (tx, decrypt) => {
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
    const previous = exchange.version ? await loadPairs(tx, familyId, exchange, decrypt, "repair") : undefined;
    const active = new Set(snapshot.roster.map(({id}) => id));
    const exposed = [...((await disputedGivers(tx, familyId)).get(exchange.id) ?? [])].filter((id) => active.has(id));
    const pairs = previous && exposed.length
      ? await privateDrawRepair(tx, familyId, exchange, snapshot, previous, exposed, deadline(1500), true)
      : solveDraw(snapshotRules(snapshot), {checkTime: deadline(1500)});
    if (!pairs) throw new DrawError(exposed.length ? "repairImpossible" : "drawImpossible");

    const summary = await writeDraw(tx, familyId, exchange, pairs, snapshot, "drawn", previous, true);
    if (exposed.length) await tx.update(exchanges).set({disputedRevealRepairedAt: new Date()})
      .where(exchangeScope(familyId, exchange.id));
    await publishDraw(events, tx, {
      kind: exchange.version ? "redrawn" : "drawn",
      familyId, exchangeId: exchange.id, version: summary.version,
    }, [...pairs.keys()]);
    if (previous) await publishDraw(events, tx, {
      kind: "participationCancelled", familyId, exchangeId: exchange.id, version: summary.version,
    }, [...previous.keys()].filter((giver) => !pairs.has(giver)));
    return summary;
  }, false);
}

export async function checkSealedDraw(viewer: DrawViewer, id: string) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  return auditedDraw(viewer, async (tx, decrypt) => {
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

export async function changeParticipation(
  viewer: DrawViewer, id: string, person: string, status: "in" | "out", expectedVersion: number, events?: DrawEvents,
) {
  requireOrganizer(viewer);
  const familyId = viewer.familyId;
  const personId = recordId(person);
  if (status !== "in" && status !== "out") throw new DrawError("invalidParticipants");

  return auditedDraw(viewer, async (tx, decrypt) => {
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
      return writeRepair(tx, familyId, exchange, snapshot, previous, updated, events);
    }
    snapshot.roster = snapshot.roster.filter(({id}) => id !== personId);
    const updated = removeFromDraw(snapshotRules(snapshot), previous, personId, deadline(1500));
    return writeRepair(tx, familyId, exchange, snapshot, previous, updated, events);
  });
}

export async function reportPair(
  viewer: DrawViewer, id: string, expectedVersion: number, events?: DrawEvents,
) {
  const familyId = viewer.familyId;
  return auditedDraw(viewer, async (tx, decrypt) => {
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
    const next = repairReportedPair(snapshotRules(snapshot), previous, viewer.actingAs, deadline(1500));
    const {version} = await writeRepair(tx, familyId, exchange, snapshot, previous, next, events);
    return {version};
  });
}
