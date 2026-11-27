import "server-only";
import {and, eq, gt, isNotNull, isNull, lt, lte, ne, notExists, or, sql} from "drizzle-orm";
import type {Viewer} from "../auth";
import {isManager} from "../auth/access";
import {pinCredentials} from "../auth/schema";
import {getDatabase, withFamily} from "../db/client";
import type {FamilyTransaction} from "../db/database";
import {exchanges, items, participants, people} from "../db/schema";
import {todayInExchangeCalendar} from "./calendar";
import {schedulePushDelivery} from "./delivery";
import {enqueueMessages, type Message} from "./queue";
import {listNudges} from "./schema";

export type NudgeResult = "sent" | "already" | "unavailable" | "forbidden";

type NudgeViewer = Pick<Viewer, "familyId" | "personId" | "actingAs" | "sessionId" | "isOrganizer">;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every nudge for a person on one exchange day shares this key, so the outbox keeps only the first. */
export function nudgeKey(exchangeId: string, day: string) {
  return `list-nudge:${exchangeId}:${day}`;
}

async function nudgeTarget(tx: FamilyTransaction, familyId: string, exchangeId: string, personId: string, kind: "organizer" | "viewed") {
  const [target] = await tx.select({language: people.language, helperId: people.helperId})
    .from(participants)
    .innerJoin(exchanges, and(eq(exchanges.familyId, participants.familyId), eq(exchanges.id, participants.exchangeId)))
    .innerJoin(people, and(eq(people.familyId, participants.familyId), eq(people.id, participants.personId)))
    .leftJoin(pinCredentials, and(eq(pinCredentials.familyId, people.familyId), eq(pinCredentials.personId, people.id)))
    .where(and(
      eq(participants.familyId, familyId),
      eq(participants.exchangeId, exchangeId),
      eq(participants.personId, personId),
      eq(participants.status, "in"),
      ne(exchanges.status, "closed"),
      isNull(people.removedAt),
      notExists(tx.select({id: items.id}).from(items).where(and(
        eq(items.familyId, familyId), eq(items.ownerId, personId), isNull(items.archivedAt),
      ))),
      kind === "viewed" ? or(isNotNull(pinCredentials.personId), isNotNull(people.helperId)) : undefined,
    ));
  return target;
}

function nudgeMessage(familyId: string, exchangeId: string, personId: string, language: Message["language"], day: string): Message {
  return {familyId, personId, language, template: "list-nudge", dedupeKey: nudgeKey(exchangeId, day)};
}

/** An organizer, as themselves, nudges one person. Once per person per exchange day. */
export async function nudgeList(viewer: NudgeViewer, exchangeId: unknown, personId: unknown, now = new Date()): Promise<NudgeResult> {
  if (typeof exchangeId !== "string" || !uuid.test(exchangeId) || typeof personId !== "string" || !uuid.test(personId)) {
    return "unavailable";
  }
  const {familyId} = viewer;
  const day = todayInExchangeCalendar(now);
  const result = await withFamily(familyId, async (tx): Promise<NudgeResult> => {
    if (!await isManager(tx, viewer)) return "forbidden";
    if (personId === viewer.personId) return "unavailable";
    const target = await nudgeTarget(tx, familyId, exchangeId, personId, "organizer");
    if (!target) return "unavailable";
    await tx.delete(listNudges).where(and(
      eq(listNudges.familyId, familyId), eq(listNudges.kind, "organizer"), lt(listNudges.day, day),
    ));
    const added = await tx.insert(listNudges)
      .values({familyId, exchangeId, personId, kind: "organizer", day})
      .onConflictDoNothing()
      .returning({personId: listNudges.personId});
    if (added.length === 0) return "already";
    await enqueueMessages(tx, [nudgeMessage(familyId, exchangeId, personId, target.language, day)]);
    return "sent";
  });
  if (result === "sent") schedulePushDelivery(familyId);
  return result;
}

/**
 * Keep opening state private: valid organizer calls return "sent" even for empty batches and
 * same-day repeats. Never return target identities or counts, or reuse them in per-person controls.
 * See tests/integration/nudges.test.ts for organizer-response privacy regressions.
 */
export async function nudgeUnopened(viewer: NudgeViewer, exchangeId: unknown, now = new Date()): Promise<Exclude<NudgeResult, "already">> {
  if (typeof exchangeId !== "string" || !uuid.test(exchangeId)) return "unavailable";
  const {familyId} = viewer;
  const day = todayInExchangeCalendar(now);
  const result = await withFamily(familyId, async (tx): Promise<Exclude<NudgeResult, "already">> => {
    if (!await isManager(tx, viewer)) return "forbidden";
    const scope = and(eq(exchanges.familyId, familyId), eq(exchanges.id, exchangeId));
    const [exchange] = await tx.select({version: exchanges.drawVersion, nudgedOn: exchanges.personNudgedOn}).from(exchanges)
      .where(and(scope, gt(exchanges.drawVersion, 0), ne(exchanges.status, "closed"))).for("update");
    if (!exchange) return "unavailable";
    if (exchange.nudgedOn && exchange.nudgedOn >= day) return "sent";
    await tx.update(exchanges).set({personNudgedOn: day}).where(scope);
    const targets = await tx.select({personId: people.id, language: people.language}).from(participants)
      .innerJoin(people, and(eq(people.familyId, participants.familyId), eq(people.id, participants.personId)))
      .where(and(
        eq(participants.familyId, familyId), eq(participants.exchangeId, exchangeId), eq(participants.status, "in"),
        isNull(people.removedAt), or(isNull(participants.seenVersion), ne(participants.seenVersion, exchange.version)),
      ));
    await enqueueMessages(tx, targets.map(({personId, language}) => ({
      familyId, personId, language, template: "person-nudge", dedupeKey: nudgeKey(exchangeId, day),
    })));
    return "sent";
  });
  if (result === "sent") schedulePushDelivery(familyId);
  return result;
}

/** Only explicit per-person list requests may affect row state; private reminder targets and visits would expose opening activity. */
export async function nudgedToday(viewer: NudgeViewer, exchangeId: string, now = new Date()) {
  if (!uuid.test(exchangeId)) return [];
  return withFamily(viewer.familyId, async (tx) => {
    if (!await isManager(tx, viewer)) return [];
    const rows = await tx.select({personId: listNudges.personId}).from(listNudges).where(and(
      eq(listNudges.familyId, viewer.familyId), eq(listNudges.exchangeId, exchangeId),
      eq(listNudges.kind, "organizer"), eq(listNudges.day, todayInExchangeCalendar(now)),
    ));
    return rows.map(({personId}) => personId);
  });
}

/**
 * Someone opened their person and found an empty list. Call only after the draw module revealed
 * `personId` to this viewer. Records nothing about who looked: the daily job sends the nudge.
 * True when an eligible request is recorded; delivery rechecks eligibility and shares the daily limit.
 */
export async function noteEmptyListViewed(viewer: NudgeViewer, exchangeId: string, personId: string, now = new Date()) {
  if (!uuid.test(exchangeId) || !uuid.test(personId)) return false;
  if (personId === viewer.personId || personId === viewer.actingAs) return false;
  const {familyId} = viewer;
  return withFamily(familyId, async (tx) => {
    const target = await nudgeTarget(tx, familyId, exchangeId, personId, "viewed");
    // a helper looking for someone they also look after would only be nudging their own phone
    if (!target || target.helperId === viewer.personId) return false;
    await tx.insert(listNudges)
      .values({familyId, exchangeId, personId, kind: "viewed", day: todayInExchangeCalendar(now)})
      .onConflictDoNothing();
    return true;
  });
}

/** The daily job: turn empty-list visits into nudges, still at most one a day per person. */
export async function queueViewedNudges(now = new Date()) {
  const day = todayInExchangeCalendar(now);
  // The discovery function returns only family IDs with waiting nudges. Their rows are read and
  // written as fge_app in the corresponding family scope.
  const families = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fge_app`);
    return tx.execute<{family_id: string}>(sql`select family_id from public.fge_nudge_work()`);
  });

  for (const {family_id: familyId} of families.rows) {
    await withFamily(familyId, async (tx) => {
      // only visits up to the job's own day, so a run with an earlier clock leaves later visits waiting
      const viewed = await tx.delete(listNudges)
        .where(and(eq(listNudges.familyId, familyId), eq(listNudges.kind, "viewed"), lte(listNudges.day, day)))
        .returning({exchangeId: listNudges.exchangeId, personId: listNudges.personId});
      await tx.delete(listNudges).where(and(
        eq(listNudges.familyId, familyId), eq(listNudges.kind, "organizer"), lt(listNudges.day, day),
      ));
      const waiting = new Map(viewed.map((row) => [`${row.exchangeId}:${row.personId}`, row]));
      const messages: Message[] = [];
      for (const {exchangeId, personId} of waiting.values()) {
        const target = await nudgeTarget(tx, familyId, exchangeId, personId, "viewed");
        if (target) messages.push(nudgeMessage(familyId, exchangeId, personId, target.language, day));
      }
      await enqueueMessages(tx, messages);
    });
  }
}
