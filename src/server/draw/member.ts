import {and, eq, ne} from "drizzle-orm";
import {listSessionDisputes} from "../auth/security";
import {sessions} from "../auth/schema";
import type {FamilyTransaction} from "../db/database";
import {exchanges, participants, people} from "../db/schema";
import {authorizeSubject, DrawError, withDrawFamily, type DrawViewer} from "./access";
import {recordId} from "./inputs";
import {drawOpenings, drawReports} from "./schema";
import {
  auditedDraw, authorizeSealedSubject, checkVersion, exchangeScope, InvalidSeal, loadExchange,
  loadRecipient, loadSnapshot, participantScope, requireOpen, type Exchange,
} from "./store";

export async function ownParticipant(tx: FamilyTransaction, viewer: DrawViewer, exchange: Exchange) {
  const [participant] = await tx.select({seenVersion: participants.seenVersion}).from(participants).where(and(
    participantScope(viewer.familyId, exchange.id), eq(participants.personId, viewer.actingAs),
    eq(participants.status, "in"),
  ));
  return participant;
}

export async function memberDrawStatus(viewer: DrawViewer, id: string) {
  return auditedDraw(viewer, async (tx) => {
    await authorizeSubject(tx, viewer);
    const exchange = await loadExchange(tx, viewer.familyId, recordId(id));
    const [subject] = await tx.select({displayName: people.displayName}).from(people).where(and(
      eq(people.familyId, viewer.familyId), eq(people.id, viewer.actingAs),
    ));
    const self = await ownParticipant(tx, viewer, exchange);
    if (exchange.status === "closed" || !self || !exchange.version) {
      return {
        status: (exchange.status === "closed" ? "closed" : self ? "waiting" : "notParticipating") as
          "closed" | "waiting" | "notParticipating",
        exchange, subjectName: subject.displayName,
      };
    }
    authorizeSealedSubject(await loadSnapshot(tx, viewer.familyId, exchange.id), viewer);
    const [report] = await tx.select({giverId: drawReports.giverId}).from(drawReports).where(and(
      eq(drawReports.familyId, viewer.familyId), eq(drawReports.exchangeId, exchange.id),
      eq(drawReports.giverId, viewer.actingAs),
    ));
    return {
      status: "ready" as const, exchange, subjectName: subject.displayName,
      seen: self.seenVersion === exchange.version,
      canReport: !report && self.seenVersion === exchange.version,
    };
  });
}

export async function revealMyPerson(viewer: DrawViewer, id: string, expectedVersion: number) {
  const familyId = viewer.familyId;
  return auditedDraw(viewer, async (tx, decrypt) => {
    await authorizeSubject(tx, viewer);
    const exchange = await loadExchange(tx, familyId, recordId(id));
    requireOpen(exchange);
    checkVersion(exchange, expectedVersion);
    if (!exchange.version || !(await ownParticipant(tx, viewer, exchange))) throw new DrawError("notFound");
    authorizeSealedSubject(await loadSnapshot(tx, familyId, exchange.id), viewer);

    const recipientId = await loadRecipient(tx, viewer, exchange, decrypt, "reveal");
    const [recipient] = await tx.select({id: people.id, displayName: people.displayName})
      .from(people).where(and(eq(people.familyId, familyId), eq(people.id, recipientId)));
    if (!recipient) throw new DrawError("notFound");

    await tx.insert(drawOpenings).values({
      familyId, exchangeId: exchange.id, giverId: viewer.actingAs,
      version: exchange.version, viewerId: viewer.personId, sessionId: viewer.sessionId,
    }).onConflictDoNothing();
    await tx.update(participants).set({seenVersion: exchange.version}).where(and(
      participantScope(familyId, exchange.id), eq(participants.personId, viewer.actingAs),
    ));
    if (exchange.status === "drawn") {
      await tx.update(exchanges).set({status: "locked"}).where(exchangeScope(familyId, exchange.id));
    }
    return {person: recipient, version: exchange.version};
  });
}

/** Read the current member's match without creating reveal evidence. */
export async function myPerson(viewer: DrawViewer, id: string) {
  try {
    return await auditedDraw(viewer, async (tx, decrypt) => {
      await authorizeSubject(tx, viewer);
      const exchange = await loadExchange(tx, viewer.familyId, recordId(id));
      if (exchange.status === "closed" || !exchange.version) return null;
      const participant = await ownParticipant(tx, viewer, exchange);
      if (!participant) return null;
      authorizeSealedSubject(await loadSnapshot(tx, viewer.familyId, exchange.id), viewer);
      const recipientId = participant.seenVersion === exchange.version
        ? await loadRecipient(tx, viewer, exchange, decrypt, "opened-recipient")
        : null;
      return {recipientId, version: exchange.version};
    });
  } catch (error) {
    // The list and Home remain available while the exchange needs recovery.
    if (error instanceof InvalidSeal || (error instanceof DrawError &&
      (error.code === "notFound" || error.code === "repairImpossible" || error.code === "checkTimedOut"))) return null;
    throw error;
  }
}

export async function ownRevealOpenings(viewer: DrawViewer, id?: string) {
  return withDrawFamily(viewer, async (tx) => {
    await authorizeSubject(tx, viewer);
    if (id) await loadExchange(tx, viewer.familyId, recordId(id));
    const disputes = await listSessionDisputes(tx, viewer.familyId, viewer.personId);
    const disputed = new Set(disputes.map(({sessionId}) => sessionId));
    const openings = await tx.select({
      exchangeId: drawOpenings.exchangeId, exchangeName: exchanges.name,
      version: drawOpenings.version, sessionId: drawOpenings.sessionId, openedAt: drawOpenings.openedAt,
      deviceKind: sessions.deviceKind,
    }).from(drawOpenings).innerJoin(exchanges, and(
      eq(exchanges.familyId, drawOpenings.familyId), eq(exchanges.id, drawOpenings.exchangeId),
    )).leftJoin(sessions, and(
      eq(sessions.familyId, drawOpenings.familyId), eq(sessions.id, drawOpenings.sessionId),
    )).where(and(
      eq(drawOpenings.familyId, viewer.familyId), id ? eq(drawOpenings.exchangeId, recordId(id)) : undefined,
      eq(drawOpenings.giverId, viewer.actingAs), eq(drawOpenings.viewerId, viewer.personId),
      ne(drawOpenings.sessionId, viewer.sessionId),
    )).orderBy(drawOpenings.openedAt, drawOpenings.sessionId);
    return openings.map((opening) => ({...opening, disputed: disputed.has(opening.sessionId)}));
  });
}

export async function repairDisputedReveals(viewer: DrawViewer) {
  return auditedDraw(viewer, async (tx) => { await authorizeSubject(tx, viewer); });
}
