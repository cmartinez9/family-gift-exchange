import {and, eq, inArray, isNull, sql} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {audit, exchanges, keepApart, participants, people} from "../db/schema";
import {DrawError, scopeDrawFamily, withDrawFamily, type DrawViewer} from "./access";
import {assignments, drawOpenings, drawRuleSnapshots, questions} from "./schema";
import {drawSeal, encryptionKey, openText, sealText} from "./sealing";
import {listSessionDisputes} from "../auth/security";
import {publishDraw, type DrawEvents} from "./events";
import {repairDraw} from "./repair";
import {drawRules, solveDraw, type DrawPerson, type KeepApartPair, type Pairs} from "./solver";

export const exchangeFields = {
  id: exchanges.id,
  name: exchanges.name,
  giftDay: exchanges.giftDay,
  giftTime: exchanges.giftTime,
  place: exchanges.place,
  budgetAmount: exchanges.budgetAmount,
  listDeadline: exchanges.listDeadline,
  drawDay: exchanges.drawDay,
  status: exchanges.status,
  version: exchanges.drawVersion,
  seal: exchanges.seal,
  disputedRevealRepairedAt: exchanges.disputedRevealRepairedAt,
};

export function exchangeScope(familyId: string, exchangeId: string) {
  return and(eq(exchanges.familyId, familyId), eq(exchanges.id, exchangeId));
}

export function participantScope(familyId: string, exchangeId: string) {
  return and(eq(participants.familyId, familyId), eq(participants.exchangeId, exchangeId));
}

export function assignmentScope(familyId: string, exchangeId: string) {
  return and(eq(assignments.familyId, familyId), eq(assignments.exchangeId, exchangeId));
}

export async function loadExchange(tx: FamilyTransaction, familyId: string, exchangeId: string) {
  const [exchange] = await tx.select(exchangeFields).from(exchanges)
    .where(exchangeScope(familyId, exchangeId)).for("update");
  if (!exchange) throw new DrawError("notFound");
  return exchange;
}

export type Exchange = Awaited<ReturnType<typeof loadExchange>>;

export function requireOpen(exchange: Exchange) {
  if (exchange.status === "closed") throw new DrawError("closed");
}

export function checkVersion(exchange: Exchange, expectedVersion: number) {
  if (exchange.version !== expectedVersion) throw new DrawError("drawChanged");
}

export async function liveRoster(tx: FamilyTransaction, familyId: string) {
  return tx.select({
    id: people.id, displayName: people.displayName,
    householdId: people.householdId, helperId: people.helperId,
  }).from(people).where(and(eq(people.familyId, familyId), isNull(people.removedAt))).for("share");
}

export async function currentParticipants(tx: FamilyTransaction, familyId: string, exchangeId: string) {
  return tx.select({
    id: participants.personId, status: participants.status, seenVersion: participants.seenVersion,
  }).from(participants).where(participantScope(familyId, exchangeId));
}

export async function loadDraftRules(tx: FamilyTransaction, familyId: string, exchangeId: string) {
  const members = await liveRoster(tx, familyId);
  const active = (await currentParticipants(tx, familyId, exchangeId)).filter(({status}) => status === "in");
  const byId = new Map(members.map((person) => [person.id, person]));
  const roster = active.map(({id}) => {
    const person = byId.get(id);
    if (!person) throw new DrawError("invalidParticipants");
    return {id, householdId: person.householdId, helperId: person.helperId};
  });
  const pairs = await tx.select({
    personA: keepApart.personA, personB: keepApart.personB,
  }).from(keepApart).where(and(eq(keepApart.familyId, familyId), eq(keepApart.exchangeId, exchangeId)));
  return {roster, keepApart: pairs};
}

export type RuleSnapshot = {roster: DrawPerson[]; keepApart: KeepApartPair[]};

export async function loadSnapshot(tx: FamilyTransaction, familyId: string, exchangeId: string) {
  const [snapshot] = await tx.select({
    roster: drawRuleSnapshots.roster, keepApart: drawRuleSnapshots.keepApart,
  }).from(drawRuleSnapshots).where(and(
    eq(drawRuleSnapshots.familyId, familyId), eq(drawRuleSnapshots.exchangeId, exchangeId),
  ));
  if (!snapshot) throw new Error("Draw rule snapshot missing");
  return snapshot;
}

export async function saveSnapshot(
  tx: FamilyTransaction, familyId: string, exchangeId: string, snapshot: RuleSnapshot,
) {
  await tx.insert(drawRuleSnapshots).values({familyId, exchangeId, ...snapshot}).onConflictDoUpdate({
    target: [drawRuleSnapshots.familyId, drawRuleSnapshots.exchangeId],
    set: snapshot,
  });
}

export function snapshotRules(snapshot: RuleSnapshot) {
  return drawRules(snapshot.roster, snapshot.keepApart);
}

export function authorizeSealedSubject(snapshot: RuleSnapshot, viewer: DrawViewer) {
  const giver = snapshot.roster.find(({id}) => id === viewer.actingAs);
  if (!giver || (giver.helperId ?? giver.id) !== viewer.personId) throw new DrawError("notFound");
}

type DecryptPurpose = "reveal" | "opened-recipient" | "check" | "repair" | "practice" | "ask" | "question-inbox" | "question-outbox" | "answer";

export class InvalidSeal extends Error {
  constructor() {
    super("A sealed draw record could not be authenticated");
  }
}

function drawDecryptor() {
  const purposes: DecryptPurpose[] = [];
  let key: Buffer | undefined;
  return {
    purposes,
    open(purpose: DecryptPurpose, binding: Parameters<typeof openText>[1], sealed: Buffer) {
      key ??= encryptionKey();
      purposes.push(purpose);
      try {
        return openText(key, binding, sealed);
      } catch {
        throw new InvalidSeal();
      }
    },
  };
}

export type DrawDecryptor = ReturnType<typeof drawDecryptor>;

export async function auditedDraw<T>(
  viewer: DrawViewer, action: (tx: FamilyTransaction, decrypt: DrawDecryptor) => Promise<T>,
  repairDisputes = true,
) {
  const familyId = viewer.familyId;
  const decrypt = drawDecryptor();
  try {
    return await withDrawFamily(viewer, async (tx) => {
      if (repairDisputes) await reconcileDisputedReveals(tx, familyId, decrypt);
      const result = await action(tx, decrypt);
      if (decrypt.purposes.length) {
        // A practice action temporarily switches scopes, but audits belong to its owning family.
        await scopeDrawFamily(tx, familyId);
        await tx.insert(audit).values(decrypt.purposes.map((purpose) => ({
          familyId, action: `draw.decrypt.${purpose}`,
        })));
      }
      return result;
    }, "update");
  } catch (error) {
    // If the transaction rolled back there is no database audit row.
    for (const purpose of decrypt.purposes) console.info("draw.decrypt", purpose);
    if (error instanceof DrawError || error instanceof InvalidSeal) throw error;
    throw new Error("Draw operation failed");
  }
}

export async function loadPairs(
  tx: FamilyTransaction, familyId: string, exchange: Exchange, decrypt: DrawDecryptor,
  purpose: "check" | "repair" | "practice",
) {
  const rows = await tx.select().from(assignments).where(assignmentScope(familyId, exchange.id));
  return new Map(rows.map(({giverId, version, recipientSealed}) => {
    if (version !== exchange.version) throw new InvalidSeal();
    return [giverId, decrypt.open(purpose, {
      field: "assignment", familyId, exchangeId: exchange.id, giverId, version,
    }, recipientSealed)];
  }));
}

export async function loadRecipient(
  tx: FamilyTransaction, viewer: DrawViewer, exchange: Exchange, decrypt: DrawDecryptor,
  purpose: "ask" | "reveal" | "opened-recipient",
) {
  const {rows: [assignment]} = await tx.execute<{sealed: Buffer | null}>(sql`
    SELECT public.fge_sealed_recipient(
      ${exchange.id}::uuid, ${viewer.personId}::uuid, ${viewer.actingAs}::uuid, ${exchange.version}::integer
    ) AS sealed
  `);
  if (!assignment?.sealed) throw new DrawError("notFound");
  const recipientId = decrypt.open(purpose, {
    field: "assignment", familyId: viewer.familyId, exchangeId: exchange.id,
    giverId: viewer.actingAs, version: exchange.version,
  }, assignment.sealed);
  await tx.insert(drawOpenings).values({
    familyId: viewer.familyId, exchangeId: exchange.id, giverId: viewer.actingAs,
    version: exchange.version, viewerId: viewer.personId, sessionId: viewer.sessionId,
  }).onConflictDoNothing();
  return recipientId;
}

function questionScope(familyId: string, exchangeId: string) {
  return and(eq(questions.familyId, familyId), eq(questions.exchangeId, exchangeId));
}

export async function writeDraw(
  tx: FamilyTransaction, familyId: string, exchange: Exchange,
  pairs: Pairs, snapshot: RuleSnapshot, status: "drawn" | "locked",
  previous?: Pairs, resetSeen = false,
) {
  const exchangeId = exchange.id;
  const version = exchange.version + 1;
  const key = encryptionKey();
  const seal = drawSeal(key, familyId, exchangeId, version, pairs);
  const replacement = [...pairs].map(([giverId, recipientId]) => ({
    familyId, exchangeId, giverId, version,
    recipientSealed: sealText(key, {field: "assignment", familyId, exchangeId, giverId, version}, recipientId),
  }));

  const changed = previous
    ? [...previous].filter(([giver, recipient]) => pairs.get(giver) !== recipient).map(([giver]) => giver)
    : [];
  if (changed.length) await tx.update(drawOpenings).set({invalidatedAt: new Date()}).where(and(
    eq(drawOpenings.familyId, familyId), eq(drawOpenings.exchangeId, exchangeId),
    isNull(drawOpenings.invalidatedAt), inArray(drawOpenings.giverId, changed),
  ));
  await tx.delete(assignments).where(assignmentScope(familyId, exchangeId));
  await tx.insert(assignments).values(replacement);
  await saveSnapshot(tx, familyId, exchangeId, snapshot);
  await tx.update(exchanges).set({drawVersion: version, seal, status}).where(exchangeScope(familyId, exchangeId));

  const scope = participantScope(familyId, exchangeId);
  if (!previous || resetSeen) {
    await tx.update(participants).set({seenVersion: null}).where(scope);
    await tx.delete(questions).where(questionScope(familyId, exchangeId));
    return {version, seal, participantCount: pairs.size};
  }

  // Preserve seen status only when the person still has the same recipient.
  const reset = changed;
  if (reset.length) {
    await tx.update(participants).set({seenVersion: null})
      .where(and(scope, inArray(participants.personId, reset)));
    await tx.delete(questions).where(and(questionScope(familyId, exchangeId), inArray(questions.askerId, reset)));
  }
  await tx.update(participants).set({seenVersion: version})
    .where(and(scope, eq(participants.status, "in"), eq(participants.seenVersion, exchange.version)));

  return {version, seal, participantCount: pairs.size};
}

export async function writeRepair(
  tx: FamilyTransaction, familyId: string, exchange: Exchange, snapshot: RuleSnapshot,
  previous: Pairs, next: Pairs | null, events?: DrawEvents,
) {
  if (!next) throw new DrawError("repairImpossible");
  const status = exchange.status === "locked" ? "locked" : "drawn";
  const summary = await writeDraw(tx, familyId, exchange, next, snapshot, status, previous);
  const destinations = [...next].filter(([giver, recipient]) => previous.get(giver) !== recipient)
    .map(([giver]) => giver);
  await publishDraw(events, tx, {
    kind: "reassigned", familyId, exchangeId: exchange.id, version: summary.version,
  }, destinations);
  await publishDraw(events, tx, {
    kind: "participationCancelled", familyId, exchangeId: exchange.id, version: summary.version,
  }, [...previous.keys()].filter((giver) => !next.has(giver)));
  return {...summary, changedGivers: destinations.filter((giver) => previous.has(giver)).length};
}

export async function disputedGivers(tx: FamilyTransaction, familyId: string) {
  const openings = await tx.select({
    exchangeId: drawOpenings.exchangeId, giverId: drawOpenings.giverId,
    viewerId: drawOpenings.viewerId, sessionId: drawOpenings.sessionId,
  }).from(drawOpenings).where(and(eq(drawOpenings.familyId, familyId), isNull(drawOpenings.invalidatedAt)));
  const affected = new Map<string, Set<string>>();
  for (const personId of new Set(openings.map(({viewerId}) => viewerId))) {
    const disputes = await listSessionDisputes(tx, familyId, personId);
    const sessions = new Set(disputes.map(({sessionId}) => sessionId));
    for (const opening of openings) {
      if (opening.viewerId !== personId || !sessions.has(opening.sessionId)) continue;
      const givers = affected.get(opening.exchangeId) ?? new Set<string>();
      givers.add(opening.giverId);
      affected.set(opening.exchangeId, givers);
    }
  }
  return affected;
}

export async function privateDrawRepair(
  tx: FamilyTransaction, familyId: string, exchange: Exchange, snapshot: RuleSnapshot, previous: Pairs,
  givers: readonly string[], checkTime: () => void, fullRedraw = false,
) {
  const organizers = await tx.select({id: people.id}).from(people).where(and(
    eq(people.familyId, familyId), isNull(people.removedAt), inArray(people.role, ["organizer", "co_organizer"]),
  ));
  const organizerIds = new Set(organizers.map(({id}) => id));
  const observers = snapshot.roster.filter(({id, helperId}) => organizerIds.has(helperId ?? id)).map(({id}) => id);
  const seenGivers = fullRedraw ? [] : (await currentParticipants(tx, familyId, exchange.id))
    .filter(({status, seenVersion}) => status === "in" && seenVersion === exchange.version).map(({id}) => id);
  const observerIds = new Set(observers);
  const visibleGivers = [...previous].filter(([giver, recipient]) => observerIds.has(giver) || observerIds.has(recipient))
    .map(([giver]) => giver);
  const questionGivers = fullRedraw ? [] : (await tx.selectDistinct({id: questions.askerId}).from(questions).where(and(
    questionScope(familyId, exchange.id), inArray(questions.askerId, visibleGivers),
  ))).map(({id}) => id);
  const rules = snapshotRules(snapshot);
  return repairDraw(rules, previous, givers, checkTime, {observers, seenGivers, questionGivers, fullRedraw})
    ?? repairDraw(rules, previous, givers, checkTime)
    ?? solveDraw(rules, {checkTime});
}

async function reconcileDisputedReveals(tx: FamilyTransaction, familyId: string, decrypt: DrawDecryptor) {
  for (const [exchangeId, givers] of await disputedGivers(tx, familyId)) {
    const exchange = await loadExchange(tx, familyId, exchangeId);
    if (exchange.status === "closed" || !exchange.version) continue;
    const snapshot = await loadSnapshot(tx, familyId, exchangeId);
    const previous = await loadPairs(tx, familyId, exchange, decrypt, "repair");
    const end = performance.now() + 1500;
    const next = await privateDrawRepair(tx, familyId, exchange, snapshot, previous, [...givers], () => {
      if (performance.now() > end) throw new DrawError("checkTimedOut");
    });
    await writeRepair(tx, familyId, exchange, snapshot, previous, next);
    await tx.update(exchanges).set({disputedRevealRepairedAt: new Date()}).where(exchangeScope(familyId, exchangeId));
  }
}
