import {and, eq, isNull, sql} from "drizzle-orm";
import type {FamilyTransaction} from "../db/database";
import {audit, exchanges, keepApart, participants, people} from "../db/schema";
import {DrawError, scopeDrawFamily, withDrawFamily, type DrawViewer} from "./access";
import {assignments, drawRuleSnapshots} from "./schema";
import {encryptionKey, openText} from "./sealing";
import {drawRules, type DrawPerson, type KeepApartPair} from "./solver";

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

type DecryptPurpose = "reveal" | "check" | "repair" | "practice" | "ask" | "question-inbox" | "question-outbox" | "answer";

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
  familyId: string, action: (tx: FamilyTransaction, decrypt: DrawDecryptor) => Promise<T>,
) {
  const decrypt = drawDecryptor();
  try {
    return await withDrawFamily(familyId, async (tx) => {
      const result = await action(tx, decrypt);
      if (decrypt.purposes.length) {
        // A practice action temporarily switches scopes, but audits belong to its owning family.
        await scopeDrawFamily(tx, familyId);
        await tx.insert(audit).values(decrypt.purposes.map((purpose) => ({
          familyId, action: `draw.decrypt.${purpose}`,
        })));
      }
      return result;
    });
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
  purpose: "ask" | "reveal",
) {
  const {rows: [assignment]} = await tx.execute<{sealed: Buffer | null}>(sql`
    SELECT public.fge_sealed_recipient(
      ${exchange.id}::uuid, ${viewer.personId}::uuid, ${viewer.actingAs}::uuid, ${exchange.version}::integer
    ) AS sealed
  `);
  if (!assignment?.sealed) throw new DrawError("notFound");
  return decrypt.open(purpose, {
    field: "assignment", familyId: viewer.familyId, exchangeId: exchange.id,
    giverId: viewer.actingAs, version: exchange.version,
  }, assignment.sealed);
}
