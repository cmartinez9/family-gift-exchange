import {randomBytes, randomUUID} from "node:crypto";
import {renderToStaticMarkup} from "react-dom/server";
import {and, eq, sql} from "drizzle-orm";
import {afterAll, afterEach, beforeAll, expect, it, vi} from "vitest";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {audit, families, households, keepApart, participants, people} from "../../src/server/db/schema";
import {
  answerQuestion, askYourPerson, changeParticipation, checkSealedDraw, closeExchange, createExchange,
  drawFeasibility, dryRunDraw, editExchange, listExchanges, listOwnQuestions, memberDrawStatus,
  organizerExchange, ownRevealOpenings, practiceCommand, practiceMemberView, practiceSeason,
  previewAsMember, repairDisputedReveals, reportPair, revealMyPerson, runDraw, setKeepApart, setParticipants, startPractice,
  type DrawEvents, type DrawViewer, type ExchangeDetails,
} from "../../src/server/draw";
import {issueKey, redeemKey, signInDevice, signInWithPin, type Device} from "../../src/server/auth/access";
import {account, disputeEvent, disputeSession, endSessions, listSessionDisputes} from "../../src/server/auth/security";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {requireIssuedKey} from "../helpers/issued-key";
import {possibleDraws} from "../helpers/possible-draws";
import * as solver from "../../src/server/draw/solver";
import AccountPage from "../../src/app/[locale]/account/page";
import {reportEvent, reportSession, signOut, switchProfile} from "../../src/app/[locale]/account/actions";
import {withDrawFamily} from "../../src/server/draw/access";
import {assignments, practiceFamilies, questions} from "../../src/server/draw/schema";

const signedIn = vi.hoisted(() => ({viewer: null as DrawViewer | null, clearSession: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", async () => {
  const {createTranslator} = await import("next-intl");
  const {default: messages} = await import("../../messages/en.json");
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: "auth" | "draw") => createTranslator({locale: "en", messages, namespace}),
    getFormatter: async () => ({dateTime: (date: Date) => date.toISOString()}),
  };
});
vi.mock("@/i18n/navigation", async () => {
  const {createElement} = await import("react");
  return {Link: ({href, children}: {href: string; children: import("react").ReactNode}) => createElement("a", {href}, children)};
});
vi.mock("../../src/app/[locale]/sign-in/controls", async () => {
  const {createElement} = await import("react");
  return {
    AuthForm: ({label, children}: {label: string; children?: import("react").ReactNode}) => createElement(
      "form", null, children, createElement("button", {type: "submit"}, label),
    ),
    PinFields: () => null,
  };
});
vi.mock("@/server/auth/request", async (original) => ({
  ...await original<typeof import("../../src/server/auth/request")>(), clearSession: signedIn.clearSession,
}));
vi.mock("next/navigation", () => ({redirect: (url: string) => { throw new Error(`redirect:${url}`); }}));
vi.mock("@/server/auth", async (original) => ({
  ...await original<typeof import("../../src/server/auth")>(),
  requireViewer: async () => signedIn.viewer!,
}));

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("The draw integration tests need a disposable Postgres database");
const admin = connectDatabase(databaseUrl);
const suffix = randomBytes(6).toString("hex");
const appRole = `draw_test_app_${suffix}`;
const drawRole = `draw_test_sealed_${suffix}`;
const testFamilies = new Set<string>();

function testLogin(name: string, password: string) {
  const url = new URL(databaseUrl!);
  url.username = name;
  url.password = password;
  return url.toString();
}

const password = randomBytes(24).toString("hex");
const app = connectDatabase(testLogin(appRole, password));
const sealed = connectDatabase(testLogin(drawRole, password));

beforeAll(async () => {
  for (const [login, membership] of [[appRole, "fge_app"], [drawRole, "fge_draw"]]) {
    await admin.db.execute(sql`CREATE ROLE ${sql.identifier(login)} LOGIN NOINHERIT PASSWORD ${sql.raw(`'${password}'`)}`);
    await admin.db.execute(sql`GRANT ${sql.identifier(membership)} TO ${sql.identifier(login)}`);
  }
  vi.stubEnv("DATABASE_URL", testLogin(appRole, password));
  vi.stubEnv("DRAW_DATABASE_URL", testLogin(drawRole, password));
  vi.stubEnv("ASSIGNMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

afterAll(async () => {
  for (const familyId of testFamilies) {
    await admin.db.delete(families).where(eq(families.id, familyId));
  }
  await Promise.all([app.close(), sealed.close()]);
  await admin.db.execute(sql`DROP ROLE IF EXISTS ${sql.identifier(appRole)}, ${sql.identifier(drawRole)}`);
  await admin.close();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  signedIn.viewer = null;
  signedIn.clearSession.mockClear();
});

function cycle(ids: readonly string[]) {
  return new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
}

const details: ExchangeDetails = {
  name: "Snowbell Gifts", giftDay: "2023-01-06", giftTime: "18:30", place: "Lantern Hall",
  budgetAmount: "25", listDeadline: "2022-12-30", drawDay: "2023-01-01",
};
const names = ["Mintflake", "Frostsprig", "Candleplum", "Jinglemoss", "Starfern", "Bellswirl", "Driftpetal", "Pinegleam"];

async function fixture({helpers = false, count = 7, active = 6, organizerIndex = 0, coOrganizerIndex = 2 as number | null} = {}) {
  const familyId = randomUUID();
  testFamilies.add(familyId);
  const ids = names.slice(0, count).map(() => randomUUID());
  await runForFamily(app.db, familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "The Pinegleam Family"});
    await tx.insert(people).values(ids.map((id, index) => ({
      familyId, id, displayName: names[index],
      role: index === organizerIndex ? "organizer" as const : index === coOrganizerIndex ? "co_organizer" as const : "member" as const,
      helperId: index === 1 && helpers ? ids[0] : null,
    })));
  });
  const viewers = await runForFamily(app.db, familyId, async (tx) => {
    const result: DrawViewer[] = [];
    for (const [index, personId] of ids.entries()) {
      const session = await signInDevice(tx, familyId, personId, {
        hash: digest(secret()), kind: "iphone", network: null,
      }, new Date());
      result.push({familyId, personId, actingAs: personId, sessionId: session.id, isOrganizer: index === organizerIndex || index === coOrganizerIndex});
    }
    return result;
  });
  const organizer = viewers[organizerIndex];
  const {id: exchangeId} = await createExchange(organizer, details);
  await setParticipants(organizer, exchangeId, ids.slice(0, active));
  return {familyId, exchangeId, ids, viewers, organizer, coOrganizer: viewers[coOrganizerIndex ?? organizerIndex]};
}

function verifyNoPairing(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(verifyNoPairing);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      expect(key).not.toMatch(/^(assignments?|pairs?|giv(er|ing)(Id|Name)?|recipient.*|asker.*|question.*|sealed.*|sessionId|person)$/i);
      verifyNoPairing(nested);
    }
  }
}

it("denies the app login sealed reads and role assumption, and scopes the draw login", async () => {
  const a = await fixture();
  const b = await fixture();
  await runDraw(a.organizer, a.exchangeId, {expectedVersion: 0});
  for (const table of ["assignments", "questions", "draw_practice_families", "draw_rule_snapshots", "draw_openings"]) {
    await expect(runForFamily(app.db, a.familyId, (tx) => tx.execute(
      sql`SELECT * FROM ${sql.identifier(table)}`,
    ))).rejects.toMatchObject({cause: {code: "42501"}});
  }
  await expect(runForFamily(app.db, a.familyId, (tx) => tx.execute(sql`
    SELECT public.fge_sealed_recipient(${a.exchangeId}::uuid, ${a.ids[0]}::uuid, ${a.ids[0]}::uuid, 1)
  `))).rejects.toMatchObject({cause: {code: "42501"}});
  const foreignGiver = await withDrawFamily(a.familyId, (tx) => tx.execute(sql`
    SELECT public.fge_sealed_recipient(${a.exchangeId}::uuid, ${a.ids[0]}::uuid, ${a.ids[1]}::uuid, 1) AS sealed
  `));
  expect(foreignGiver.rows).toEqual([{sealed: null}]);
  await expect(app.db.execute(sql`SET ROLE fge_draw`)).rejects.toMatchObject({cause: {code: "42501"}});
  await expect(sealed.db.execute(sql`SET ROLE fge_app`)).rejects.toMatchObject({cause: {code: "42501"}});
  const unscoped = await sealed.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fge_draw`);
    return tx.select().from(assignments);
  });
  expect(unscoped).toEqual([]);
  expect(await withDrawFamily(b.familyId, (tx) => tx.select().from(assignments).where(
    eq(assignments.exchangeId, a.exchangeId),
  ))).toEqual([]);
  await expect(revealMyPerson(b.organizer, a.exchangeId, 1)).rejects.toMatchObject({code: "notFound"});
  await expect(previewAsMember(b.organizer, a.exchangeId, a.ids[0])).rejects.toMatchObject({code: "notFound"});
});

it("locks on first reveal, records device openings, and redraws atomically", async () => {
  const {familyId, organizer, ids, viewers, exchangeId} = await fixture({helpers: true});
  await setKeepApart(organizer, exchangeId, ids[3], ids[4], "partner");
  const outputs: unknown[] = [];
  const events: DrawEvents = {
    async publish(_tx, event, destinations) {
      expect(Object.keys(event).sort()).toEqual(["exchangeId", "familyId", "kind", "version"]);
      expect(destinations).toHaveLength(6);
      outputs.push(event);
    },
  };
  outputs.push(await drawFeasibility(organizer, exchangeId));
  expect(await dryRunDraw(organizer, exchangeId)).toEqual({possible: true, fewestChoices: 4});
  const first = await runDraw(organizer, exchangeId, {expectedVersion: 0}, events);
  const second = await runDraw(organizer, exchangeId, {expectedVersion: 1}, events);
  expect(second).toMatchObject({version: 2, participantCount: 6});
  expect(first.seal).not.toBe(second.seal);
  outputs.push(first, second, await organizerExchange(organizer, exchangeId), await checkSealedDraw(organizer, exchangeId));
  expect(await checkSealedDraw(organizer, exchangeId)).toMatchObject({
    status: "checked", valid: true, oneLoop: true, sealMatches: true, rosterMatches: true,
  });
  const helper = {...organizer, actingAs: ids[1]};
  await expect(revealMyPerson(viewers[1], exchangeId, 2)).rejects.toMatchObject({code: "forbidden"});
  await expect(revealMyPerson({...viewers[3], actingAs: ids[1]}, exchangeId, 2))
    .rejects.toMatchObject({code: "forbidden"});
  await expect(revealMyPerson({...organizer, actingAs: ids[3]}, exchangeId, 2))
    .rejects.toMatchObject({code: "forbidden"});
  const opened = await revealMyPerson(helper, exchangeId, 2);
  expect(Object.keys(opened).sort()).toEqual(["person", "version"]);
  expect(opened.person.id).not.toBe(ids[0]);
  expect(opened.person.id).not.toBe(ids[1]);
  const deviceTwo = {...helper, sessionId: randomUUID()};
  expect(await revealMyPerson(deviceTwo, exchangeId, 2)).toEqual(opened);
  await revealMyPerson(deviceTwo, exchangeId, 2);
  expect((await ownRevealOpenings(helper, exchangeId)).map(({sessionId}) => sessionId).sort())
    .toEqual([deviceTwo.sessionId]);
  expect(await ownRevealOpenings(organizer, exchangeId)).toEqual([]);
  await expect(runDraw(organizer, exchangeId, {expectedVersion: 2, confirmation: "yes"}))
    .rejects.toMatchObject({code: "confirmationRequired"});

  const preview = await previewAsMember(organizer, exchangeId, ids[1]);
  expect(preview).toEqual({displayName: names[1], exchange: {...details, giftTime: "18:30:00", budgetAmount: "25.00"}, draw: "hiddenInPreview"});
  for (const secret of [opened.person.id, opened.person.displayName, second.seal]) {
    expect(JSON.stringify(preview)).not.toContain(secret);
  }
  outputs.push(preview);

  const failingSink: DrawEvents = {async publish() { throw new Error("Synthetic queue failure"); }};
  await expect(runDraw(organizer, exchangeId, {expectedVersion: 2, confirmation: "REDRAW"}, failingSink))
    .rejects.toThrow("Draw operation failed");
  expect(await revealMyPerson(helper, exchangeId, 2)).toEqual(opened);
  const forced = await runDraw(organizer, exchangeId, {expectedVersion: 2, confirmation: "VOLVER A SORTEAR"}, events);
  expect(forced).toMatchObject({version: 3, participantCount: 6});
  expect(await organizerExchange(organizer, exchangeId)).toMatchObject({seenCount: 0});
  expect(await memberDrawStatus(helper, exchangeId)).toMatchObject({status: "ready", seen: false});
  await expect(revealMyPerson(helper, exchangeId, 2)).rejects.toMatchObject({code: "drawChanged"});
  verifyNoPairing(outputs);
  expect(await admin.db.select({action: audit.action, target: audit.target, actorId: audit.actorId})
    .from(audit).where(eq(audit.familyId, familyId))).toEqual(expect.arrayContaining([
      {action: "draw.decrypt.reveal", target: null, actorId: null},
      {action: "draw.decrypt.check", target: null, actorId: null},
    ]));
});

it("changes one giver for a simple dropout and inserts a newcomer without erasing other seen ticks", async () => {
  const {organizer, exchangeId, ids, viewers, familyId} = await fixture();
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  const known = new Map(await Promise.all(viewers.slice(0, 6).map(async (viewer) =>
    [viewer.personId, (await revealMyPerson(viewer, exchangeId, 1)).person.id] as const)));
  const events: {destinations: readonly string[]}[] = [];
  const sink: DrawEvents = {
    async publish(_tx, event, destinations) {
      verifyNoPairing(event);
      expect(event.kind).toBe("reassigned");
      events.push({destinations});
    },
  };
  const dropout = await changeParticipation(organizer, exchangeId, ids[1], "out", 1, sink);
  expect(dropout).toMatchObject({version: 2, changedGivers: 1, participantCount: 5});
  const [changed] = events[0].destinations;
  expect(known.get(changed)).toBe(ids[1]);
  expect(await organizerExchange(organizer, exchangeId)).toMatchObject({seenCount: 4});
  const entry = await changeParticipation(organizer, exchangeId, ids[6], "in", 2, sink);
  expect(entry).toMatchObject({version: 3, changedGivers: 1, participantCount: 6});
  expect(events[1].destinations).toHaveLength(2);
  expect(events[1].destinations).toContain(ids[6]);
  await expect(revealMyPerson(viewers[1], exchangeId, 3)).rejects.toMatchObject({code: "notFound"});
  const rows = await runForFamily(app.db, familyId, (tx) => tx.select({
    id: participants.personId, seen: participants.seenVersion,
  }).from(participants).where(and(eq(participants.familyId, familyId), eq(participants.exchangeId, exchangeId))));
  for (const row of rows) {
    if (row.id === ids[1] || [changed, ...events[1].destinations].includes(row.id)) expect(row.seen).toBeNull();
    else expect(row.seen).toBe(3);
  }
  expect(await checkSealedDraw(organizer, exchangeId)).toMatchObject({valid: true, oneLoop: true});
  verifyNoPairing([dropout, entry]);
});

it("only repairs a reported pairing after the owner opens it, and limits the change to two givers", async () => {
  const {organizer, exchangeId, viewers} = await fixture();
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  await expect(reportPair(viewers[1], exchangeId, 1)).rejects.toMatchObject({code: "revealFirst"});
  const previous = await revealMyPerson(viewers[1], exchangeId, 1);
  const publish = vi.fn<DrawEvents["publish"]>(async () => {});
  expect(await reportPair(viewers[1], exchangeId, 1, {publish})).toEqual({version: 2});
  expect(publish.mock.calls[0][2]).toHaveLength(2);
  expect((await revealMyPerson(viewers[1], exchangeId, 2)).person.id).not.toBe(previous.person.id);
  await expect(reportPair(viewers[1], exchangeId, 2)).rejects.toMatchObject({code: "alreadyReported"});
  expect(await checkSealedDraw(organizer, exchangeId)).toMatchObject({valid: true});
});

it("protects anonymous questions and only returns the answer to the asker", async () => {
  const {organizer, familyId, exchangeId, viewers} = await fixture();
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  const asker = viewers[3];
  await expect(askYourPerson(asker, exchangeId, 1, "Favorite color?")).rejects.toMatchObject({code: "revealFirst"});
  const opened = await revealMyPerson(asker, exchangeId, 1);
  const recipient = viewers.find(({personId}) => personId === opened.person.id)!;
  const bystander = viewers.find(({personId}) => personId !== asker.personId && personId !== recipient.personId)!;
  const {id} = await askYourPerson(asker, exchangeId, 1, "Favorite color?");
  expect(await listOwnQuestions(recipient, exchangeId)).toEqual({
    version: 1, incoming: [{id, text: "Favorite color?", answered: false}], outgoing: [],
  });
  expect(await listOwnQuestions(bystander, exchangeId)).toEqual({version: 1, incoming: [], outgoing: []});
  await expect(answerQuestion(bystander, exchangeId, id, 1, "Wrong account")).rejects.toMatchObject({code: "notFound"});
  await answerQuestion(recipient, exchangeId, id, 1, "Moonlight blue");
  expect(await listOwnQuestions(asker, exchangeId)).toEqual({
    version: 1, outgoing: [{id, text: "Favorite color?", answer: "Moonlight blue"}], incoming: [],
  });
  expect(await listOwnQuestions(recipient, exchangeId)).toEqual({
    version: 1, incoming: [{id, text: "Favorite color?", answered: true}], outgoing: [],
  });
  const [stored] = await admin.db.select().from(questions).where(and(eq(questions.familyId, familyId), eq(questions.id, id)));
  expect(stored.text).not.toContain("Favorite color?");
  expect(stored.answer).not.toContain("Moonlight blue");
  expect(stored.recipientSealed.includes(Buffer.from(recipient.personId))).toBe(false);

  await runDraw(organizer, exchangeId, {expectedVersion: 1, confirmation: "REDRAW"});
  expect(await listOwnQuestions(asker, exchangeId)).toEqual({version: 2, incoming: [], outgoing: []});
});

it("checks the sealed rules even if household information changes after the draw", async () => {
  const {familyId, organizer, ids, exchangeId} = await fixture();
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  await runForFamily(app.db, familyId, async (tx) => {
    const [household] = await tx.insert(households).values({familyId, name: "Snowflake House"})
      .returning({id: households.id});
    await tx.update(people).set({householdId: household.id}).where(eq(people.familyId, familyId));
  });
  await expect(setKeepApart(organizer, exchangeId, ids[0], ids[1], "custom")).rejects.toMatchObject({code: "drawLocked"});
  expect(await checkSealedDraw(organizer, exchangeId)).toMatchObject({valid: true, noHouseholdPairs: true});
  await expect(runDraw(organizer, exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "drawImpossible"});
  expect(await checkSealedDraw(organizer, exchangeId)).toMatchObject({valid: true});
});

it("creates, edits and closes an exchange manually regardless of its gift day", async () => {
  const {organizer, viewers, exchangeId, familyId} = await fixture();
  await expect(createExchange(viewers[1], details)).rejects.toMatchObject({code: "forbidden"});
  await expect(editExchange(organizer, exchangeId, {...details, giftDay: "2025-02-30"}))
    .rejects.toMatchObject({code: "invalidDetails"});
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  const publish = vi.fn<DrawEvents["publish"]>(async () => {});
  await editExchange(organizer, exchangeId, {...details, budgetAmount: "40"}, {publish});
  expect(publish.mock.calls[0][1]).toMatchObject({kind: "budgetChanged", version: 1});
  expect(await listExchanges(viewers[1])).toEqual([expect.objectContaining({
    giftDay: details.giftDay, giftTime: "18:30:00", budgetAmount: "40.00", status: "drawn",
  })]);
  await revealMyPerson(viewers[1], exchangeId, 1);
  await askYourPerson(viewers[1], exchangeId, 1, "Any favorite snacks?");
  await closeExchange(organizer, exchangeId);
  expect(await checkSealedDraw(organizer, exchangeId)).toEqual({status: "closed"});
  expect(await admin.db.select().from(assignments).where(eq(assignments.familyId, familyId))).toEqual([]);
  expect(await admin.db.select().from(questions).where(eq(questions.familyId, familyId))).toEqual([]);
  await expect(runDraw(organizer, exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "closed"});
  expect(await memberDrawStatus(viewers[1], exchangeId)).toMatchObject({status: "closed"});
});

it("gates a full synthetic practice season to its owner", async () => {
  const owner = await fixture();
  const other = await fixture();
  await startPractice(owner.organizer, "en");
  const [mapping] = await admin.db.select({id: practiceFamilies.practiceFamilyId}).from(practiceFamilies)
    .where(eq(practiceFamilies.familyId, owner.familyId));
  testFamilies.add(mapping.id);
  expect(await practiceSeason(other.organizer)).toBeNull();
  expect(await practiceSeason(owner.coOrganizer)).toBeNull();
  await expect(startPractice(owner.viewers[3], "en")).rejects.toMatchObject({code: "forbidden"});
  const setup = (await practiceSeason(owner.organizer))!;
  expect(setup.people.filter(({participating}) => participating)).toHaveLength(6);
  await practiceCommand(owner.organizer, {kind: "draw", expectedVersion: 0});
  const drawn = (await practiceSeason(owner.organizer))!;
  expect(drawn.pairs).toHaveLength(6);
  expect(drawn.people.map(({displayName}) => displayName)).not.toContain(names[0]);
  const player = drawn.people.find(({participating}) => participating)!;
  const revealed = await practiceCommand(owner.organizer, {kind: "reveal", as: player.id, expectedVersion: 1});
  expect(revealed).toEqual({
    person: expect.objectContaining({displayName: drawn.pairs.find(({giver}) => giver === player.displayName)?.recipient}),
    version: 1,
  });
  await expect(practiceMemberView(owner.organizer, owner.ids[0])).rejects.toMatchObject({code: "notFound"});
  const newcomer = drawn.people.find(({participating}) => !participating)!;
  await practiceCommand(owner.organizer, {
    kind: "participation", personId: newcomer.id, status: "in", expectedVersion: 1,
  });
  await practiceCommand(owner.organizer, {
    kind: "participation", personId: player.id, status: "out", expectedVersion: 2,
  });
  expect((await practiceSeason(owner.organizer))!.pairs).toHaveLength(6);
  await practiceCommand(owner.organizer, {kind: "close"});
  await startPractice(owner.organizer, "es");
  expect((await practiceSeason(owner.organizer))!.exchange).toMatchObject({
    status: "open", version: 0, name: "Intercambio de práctica",
  });
});

it("lets only one concurrent draw request advance the expected version", async () => {
  const {organizer, coOrganizer, exchangeId} = await fixture();
  const results = await Promise.allSettled([
    runDraw(organizer, exchangeId, {expectedVersion: 0}),
    runDraw(coOrganizer, exchangeId, {expectedVersion: 0}),
  ]);
  expect(results).toEqual(expect.arrayContaining([
    {status: "fulfilled", value: expect.objectContaining({version: 1})},
    {status: "rejected", reason: expect.objectContaining({code: "drawChanged"})},
  ]));
  expect(await checkSealedDraw(organizer, exchangeId)).toMatchObject({status: "checked", valid: true});
});

it("detects ciphertext substitution without exposing either person", async () => {
  const {familyId, organizer, viewers, exchangeId} = await fixture();
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  const scope = and(eq(assignments.familyId, familyId), eq(assignments.exchangeId, exchangeId));
  const rows = await admin.db.select().from(assignments).where(scope);
  const other = rows.find(({giverId}) => giverId !== organizer.personId)!;
  await admin.db.update(assignments).set({recipientSealed: other.recipientSealed})
    .where(and(scope, eq(assignments.giverId, organizer.personId)));
  expect(await checkSealedDraw(organizer, exchangeId)).toEqual({status: "invalidSeal"});
  const auditLog = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    await expect(revealMyPerson(organizer, exchangeId, 1)).rejects.toThrow(
      "A sealed draw record could not be authenticated",
    );
    expect(auditLog.mock.calls).toEqual([["draw.decrypt", "reveal"]]);
  } finally {
    auditLog.mockRestore();
  }
  expect(await ownRevealOpenings(organizer, exchangeId)).toEqual([]);
  expect(await memberDrawStatus(viewers[0], exchangeId)).toMatchObject({status: "ready", seen: false});
});

it("shows an organizer's replacement-key reveal and repairs it after the member disputes the session", async () => {
  const f = await fixture();
  const pepper = secret();
  const memberId = f.ids[1];
  const tx = <T,>(action: Parameters<typeof runForFamily<T>>[2]) => runForFamily(app.db, f.familyId, action);
  const device = (kind: Device["kind"]): Device => ({kind, hash: digest(secret()), network: null});
  const redeem = async (kind: "share" | "reset", chosenPin: string, onDevice: Device) => {
    const key = requireIssuedKey(await tx((t) => issueKey(t, f.organizer, memberId, kind, pepper, new Date())));
    const result = await tx((t) => redeemKey(t, {
      familyId: f.familyId, value: key.token, typed: false, pin: chosenPin, confirmation: chosenPin,
      pepper, device: onDevice, currentViewer: null, now: new Date(),
    }));
    expect(result.session).toBeDefined();
    return {cookie: result.session!.cookie, viewer: (await tx((t) => findViewer(t, parseSession(result.session!.cookie)!)))!};
  };
  await redeem("share", "4268", device("iphone"));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  const impersonator = await redeem("reset", "6285", device("computer"));
  const stolen = await revealMyPerson(impersonator.viewer, f.exchangeId, 1);
  await askYourPerson(impersonator.viewer, f.exchangeId, 1, "Favorite color?");
  const member = await redeem("reset", "4268", device("iphone"));
  await revealMyPerson(member.viewer, f.exchangeId, 1);
  const openings = await ownRevealOpenings(member.viewer);
  expect(openings).toEqual([{
    exchangeId: f.exchangeId, exchangeName: details.name, version: 1,
    sessionId: impersonator.viewer.sessionId, deviceKind: "computer", openedAt: expect.any(Date), disputed: false,
  }]);
  expect(await ownRevealOpenings(f.organizer, f.exchangeId)).toEqual([]);
  const {activity} = await tx((t) => account(t, member.viewer));
  const event = activity.find(({sessionId, kind}) => sessionId === impersonator.viewer.sessionId && kind === "resetUsed")!;
  signedIn.viewer = member.viewer;
  await expect(reportEvent(event.id)).rejects.toThrow("redirect:/en/account?reported=1");
  await Promise.all([repairDisputedReveals(member.viewer), repairDisputedReveals(member.viewer)]);
  const status = await memberDrawStatus(member.viewer, f.exchangeId);
  expect(status).toMatchObject({status: "ready", seen: false, exchange: {version: 2}});
  const repaired = await revealMyPerson(member.viewer, f.exchangeId, 2);
  expect(repaired.person.id).not.toBe(stolen.person.id);
  expect(await listOwnQuestions(member.viewer, f.exchangeId)).toMatchObject({outgoing: []});
  expect(await tx((t) => findViewer(t, parseSession(impersonator.cookie)!))).toBeNull();
  expect(await ownRevealOpenings(member.viewer)).toEqual(openings.map((opening) => ({...opening, disputed: true})));
  await repairDisputedReveals(member.viewer);
  expect(await memberDrawStatus(member.viewer, f.exchangeId)).toMatchObject({exchange: {version: 2}});
  const organizer = await organizerExchange(f.organizer, f.exchangeId);
  expect(organizer.exchange.disputedRevealRepairedAt).toBeInstanceOf(Date);
  verifyNoPairing([organizer, await checkSealedDraw(f.organizer, f.exchangeId)]);
});

it("does not repair an unopened disputed session or an opening invalidated by a redraw", async () => {
  const f = await fixture();
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(cycle(f.ids.slice(0, 6)));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  const owner = {...f.viewers[1], sessionId: randomUUID()};
  const extra = await runForFamily(app.db, f.familyId, (tx) => signInDevice(tx, f.familyId, owner.personId, {
    hash: digest(secret()), kind: "ipad", network: null,
  }, new Date()));
  owner.sessionId = extra.id;
  const original = f.viewers[1];
  const event = (await runForFamily(app.db, f.familyId, (tx) => account(tx, owner))).activity
    .find(({sessionId}) => sessionId === original.sessionId)!;
  await runForFamily(app.db, f.familyId, (tx) => disputeEvent(tx, owner, event.id, new Date()));
  await repairDisputedReveals(owner);
  expect(await memberDrawStatus(owner, f.exchangeId)).toMatchObject({exchange: {version: 1}});
  await revealMyPerson(f.viewers[3], f.exchangeId, 1);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(cycle(f.ids.slice(0, 6).reverse()));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 1, confirmation: "REDRAW"});
  const otherOwner = {...f.viewers[3], sessionId: (await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[3], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ))).id};
  const oldEvent = (await runForFamily(app.db, f.familyId, (tx) => account(tx, otherOwner))).activity
    .find(({sessionId}) => sessionId === f.viewers[3].sessionId)!;
  await runForFamily(app.db, f.familyId, (tx) => disputeEvent(tx, otherOwner, oldEvent.id, new Date()));
  await repairDisputedReveals(otherOwner);
  expect(await memberDrawStatus(otherOwner, f.exchangeId)).toMatchObject({exchange: {version: 2}});
});

it("keeps rules exchange-scoped and preserves inactive roster status in the canonical editor", async () => {
  const f = await fixture();
  await setKeepApart(f.organizer, f.exchangeId, f.ids[1], f.ids[6], "custom");
  expect((await organizerExchange(f.organizer, f.exchangeId)).people.find(({id}) => id === f.ids[6]))
    .toMatchObject({participating: false});
  const rows = await runForFamily(app.db, f.familyId, (tx) => tx.select().from(participants)
    .where(and(eq(participants.exchangeId, f.exchangeId), eq(participants.personId, f.ids[6]))));
  expect(rows).toMatchObject([{status: "out"}]);
  await setKeepApart(f.organizer, f.exchangeId, f.ids[6], f.ids[1], "partner");
  expect((await organizerExchange(f.organizer, f.exchangeId)).rules).toEqual([
    expect.objectContaining({reason: "partner"}),
  ]);
  const foreign = await fixture();
  await expect(setKeepApart(f.organizer, f.exchangeId, f.ids[1], foreign.ids[1], "custom"))
    .rejects.toMatchObject({code: "invalidKeepApart"});
  await expect(setKeepApart(f.viewers[1], f.exchangeId, f.ids[1], f.ids[6], "custom"))
    .rejects.toMatchObject({code: "forbidden"});
  await setKeepApart(f.organizer, f.exchangeId, f.ids[6], f.ids[1], null);
  expect((await organizerExchange(f.organizer, f.exchangeId)).rules).toEqual([]);
  await setKeepApart(f.organizer, f.exchangeId, f.ids[1], f.ids[6], "custom");
  await closeExchange(f.organizer, f.exchangeId);
  const next = await createExchange(f.organizer, {...details, name: "Next Christmas"});
  expect((await organizerExchange(f.organizer, next.id)).rules).toEqual([]);
  const saved = await runForFamily(app.db, f.familyId, (tx) => tx.select().from(keepApart)
    .where(eq(keepApart.exchangeId, f.exchangeId)));
  expect(saved).toHaveLength(1);
});

it("keeps B's repaired recipient ambiguous to organizer E in the A B C D E F draw", async () => {
  const f = await fixture({count: 6, organizerIndex: 4, coOrganizerIndex: null});
  const previous = cycle(f.ids);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  expect((await revealMyPerson(f.organizer, f.exchangeId, 1)).person.id).toBe(f.ids[5]);
  expect((await revealMyPerson(f.viewers[1], f.exchangeId, 1)).person.id).toBe(f.ids[2]);
  const owner = {...f.viewers[1], sessionId: (await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ))).id};
  signedIn.viewer = owner;
  await expect(reportSession(f.viewers[1].sessionId)).rejects.toThrow("redirect:/en/account?reported=1");
  const actual = new Map(await Promise.all(f.viewers.map(async (viewer, i) => [
    viewer.personId, (await revealMyPerson(i === 1 ? owner : viewer, f.exchangeId, 2)).person.id,
  ] as const)));
  const count = (pairs: ReadonlyMap<string, string>) => f.ids.filter((id) => pairs.get(id) !== previous.get(id)).length;
  expect(count(actual)).toBe(3);
  const alternatives = possibleDraws(f.ids).filter((pairs) => count(pairs) === 3
    && pairs.get(f.ids[4]) === actual.get(f.ids[4]) && pairs.get(f.ids[1]) !== f.ids[2]);
  expect(new Set(alternatives.map((pairs) => pairs.get(f.ids[1]))).size).toBeGreaterThan(1);
  verifyNoPairing(await organizerExchange(f.organizer, f.exchangeId));
});

it("retains an unchanged recipient's opening across a full redraw until its session is disputed", async () => {
  const f = await fixture();
  const previous = cycle(f.ids.slice(0, 6));
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  const stolen = await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 1, confirmation: "REDRAW"});
  expect(await organizerExchange(f.organizer, f.exchangeId)).toMatchObject({seenCount: 0});
  const owner = {...f.viewers[1], sessionId: (await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ))).id};
  signedIn.viewer = owner;
  await expect(reportSession(f.viewers[1].sessionId)).rejects.toThrow("redirect:/en/account?reported=1");
  expect((await revealMyPerson(owner, f.exchangeId, 3)).person.id).not.toBe(stolen.person.id);
});

it.each(["key event", "opening"])("repairs a trusted-browser PIN session disputed through its %s", async (method) => {
  const f = await fixture();
  const pepper = secret();
  const memberId = f.ids[1];
  const tx = <T,>(action: Parameters<typeof runForFamily<T>>[2]) => runForFamily(app.db, f.familyId, action);
  const phone = (): Device => ({kind: "computer", hash: digest(secret()), network: null});
  const redeem = async (kind: "share" | "reset", device: Device) => {
    const key = requireIssuedKey(await tx((t) => issueKey(t, f.organizer, memberId, kind, pepper, new Date())));
    const result = await tx((t) => redeemKey(t, {
      familyId: f.familyId, value: key.token, typed: false, pin: "4268", confirmation: "4268",
      pepper, device, currentViewer: null, now: new Date(),
    }));
    expect(result.session).toBeDefined();
    return {cookie: result.session!.cookie, viewer: (await tx((t) => findViewer(t, parseSession(result.session!.cookie)!)))!};
  };
  await redeem("share", phone());
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  const browser = phone();
  const first = await redeem("reset", browser);
  await tx((t) => endSessions(t, first.viewer, new Date(), false));
  const returned = (await tx((t) => signInWithPin(t, f.familyId, memberId, "4268", pepper, browser, new Date()))).session!;
  const intruder = (await tx((t) => findViewer(t, parseSession(returned.cookie)!)))!;
  const stolen = await revealMyPerson(intruder, f.exchangeId, 1);
  const owner = await redeem("reset", phone());
  const {activity} = await tx((t) => account(t, owner.viewer));
  expect(activity.some(({sessionId}) => sessionId === intruder.sessionId)).toBe(false);
  expect(await ownRevealOpenings(owner.viewer)).toEqual([expect.objectContaining({
    sessionId: intruder.sessionId, deviceKind: "computer", disputed: false,
  })]);
  signedIn.viewer = owner.viewer;
  const report = method === "opening" ? reportSession(intruder.sessionId)
    : reportEvent(activity.find(({sessionId, kind}) => sessionId === first.viewer.sessionId && kind === "resetUsed")!.id);
  await expect(report).rejects.toThrow("redirect:/en/account?reported=1");
  const disputes = await tx((t) => listSessionDisputes(t, f.familyId, memberId));
  expect(disputes.map(({sessionId}) => sessionId)).toContain(intruder.sessionId);
  expect((await revealMyPerson(owner.viewer, f.exchangeId, 2)).person.id).not.toBe(stolen.person.id);
  expect(await ownRevealOpenings(owner.viewer)).toEqual([expect.objectContaining({sessionId: intruder.sessionId, disputed: true})]);
  expect(await tx((t) => findViewer(t, parseSession(returned.cookie)!))).toBeNull();
});

it("applies the secrecy constraint to a confirmed redraw with a pending disputed reveal", async () => {
  const f = await fixture({count: 6, organizerIndex: 4, coOrganizerIndex: null});
  const previous = cycle(f.ids);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  const owner = {...f.viewers[1], sessionId: (await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ))).id};
  await expect(runForFamily(app.db, f.familyId, (tx) => disputeSession(tx, owner, f.viewers[1].sessionId, new Date())))
    .resolves.toBe(true);
  await expect(runDraw(f.organizer, f.exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "confirmationRequired"});
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 1, confirmation: "REDRAW"});
  const next = await revealMyPerson(owner, f.exchangeId, 2);
  const own = await revealMyPerson(f.organizer, f.exchangeId, 2);
  expect(next.person.id).not.toBe(f.ids[2]);
  const alternatives = possibleDraws(f.ids).filter((pairs) => pairs.get(f.ids[4]) === own.person.id
    && pairs.get(f.ids[1]) !== f.ids[2]);
  expect(new Set(alternatives.map((pairs) => pairs.get(f.ids[1]))).size).toBeGreaterThan(1);
  expect((await organizerExchange(f.organizer, f.exchangeId)).exchange.disputedRevealRepairedAt).toBeInstanceOf(Date);
});

it("keeps every account usable after an impossible private repair while blocking sealed data", async () => {
  const f = await fixture({count: 5, active: 4});
  await runForFamily(app.db, f.familyId, (tx) => tx.update(people).set({helperId: f.ids[1]})
    .where(and(eq(people.familyId, f.familyId), eq(people.id, f.ids[4]))));
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(cycle(f.ids.slice(0, 4)));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  const question = await askYourPerson(f.viewers[1], f.exchangeId, 1, "Favorite color?");
  await answerQuestion(f.viewers[2], f.exchangeId, question.id, 1, "Moonlight blue");
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const owner = {...f.viewers[1], sessionId: session.id};
  signedIn.viewer = owner;
  vi.spyOn(console, "info").mockImplementation(() => {});
  await expect(reportSession(f.viewers[1].sessionId)).resolves.toEqual({error: "repairRequired"});
  const disputes = await runForFamily(app.db, f.familyId, (tx) => listSessionDisputes(tx, f.familyId, owner.personId));
  expect(disputes.map(({sessionId}) => sessionId)).toContain(f.viewers[1].sessionId);
  expect(await runForFamily(app.db, f.familyId, (tx) => account(tx, owner))).toMatchObject({
    helpers: [{id: f.ids[4], name: names[4]}],
    activity: expect.arrayContaining([expect.objectContaining({sessionId: f.viewers[1].sessionId, disputed: expect.any(String)})]),
  });
  expect(await ownRevealOpenings(owner)).toEqual([expect.objectContaining({sessionId: f.viewers[1].sessionId, disputed: true})]);
  for (const viewer of [f.organizer, owner, f.coOrganizer, f.viewers[3]]) {
    signedIn.viewer = viewer;
    const html = renderToStaticMarkup(await AccountPage({searchParams: Promise.resolve({})}));
    expect(html).toContain("Sign-in activity");
    expect(html).toContain("Switch person or sign out");
    expect(html).toContain('href="/exchanges"');
  }
  await expect(revealMyPerson(owner, f.exchangeId, 1)).rejects.toMatchObject({code: "repairImpossible"});
  await expect(listOwnQuestions(owner, f.exchangeId)).rejects.toMatchObject({code: "repairImpossible"});
  await expect(askYourPerson(owner, f.exchangeId, 1, "Still there?")).rejects.toMatchObject({code: "repairImpossible"});
  await expect(answerQuestion(f.viewers[2], f.exchangeId, question.id, 1, "Another answer"))
    .rejects.toMatchObject({code: "repairImpossible"});
  expect((await organizerExchange(f.organizer, f.exchangeId)).exchange.version).toBe(1);
  await expect(runDraw(f.organizer, f.exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "confirmationRequired"});
  await expect(runDraw(f.organizer, f.exchangeId, {expectedVersion: 1, confirmation: "REDRAW"}))
    .rejects.toMatchObject({code: "repairImpossible"});
  signedIn.viewer = owner;
  await expect(switchProfile(f.ids[4])).rejects.toThrow("redirect:/en/account");
  signedIn.viewer = await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!));
  expect(signedIn.viewer).toMatchObject({actingAs: f.ids[4]});
  const html = renderToStaticMarkup(await AccountPage({searchParams: Promise.resolve({})}));
  expect(html).toContain(`helping ${names[4]}.`);
  await expect(signOut(false)).rejects.toThrow("redirect:/en/sign-in");
  expect(signedIn.clearSession).toHaveBeenCalledOnce();
  expect(await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!))).toBeNull();
  expect(await runForFamily(app.db, f.familyId, (tx) => listSessionDisputes(tx, f.familyId, owner.personId))).toEqual(disputes);
});

it("keeps repaired recipients private at the same opened count and preserves unaffected seen versions", async () => {
  const f = await fixture({count: 7, organizerIndex: 4, coOrganizerIndex: null});
  const ids = f.ids.slice(0, 6);
  const previous = cycle(ids);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 1});
  const seenGivers = [ids[1], ids[3], ids[4]];
  for (const index of [1, 3, 4]) await revealMyPerson(f.viewers[index], f.exchangeId, 2);
  await runForFamily(app.db, f.familyId, async (tx) => {
    await tx.update(participants).set({seenVersion: 1}).where(and(
      eq(participants.familyId, f.familyId), eq(participants.exchangeId, f.exchangeId), eq(participants.personId, ids[0]),
    ));
    await tx.insert(participants).values({
      familyId: f.familyId, exchangeId: f.exchangeId, personId: f.ids[6], status: "out", seenVersion: 2,
    });
  });
  expect((await organizerExchange(f.organizer, f.exchangeId)).seenCount).toBe(3);
  const owner = {...f.viewers[1], sessionId: (await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ))).id};
  signedIn.viewer = owner;
  await expect(reportSession(f.viewers[1].sessionId)).rejects.toThrow("redirect:/en/account?reported=1");
  const state = await organizerExchange(f.organizer, f.exchangeId);
  expect(state.exchange.version).toBe(3);
  const saved = await runForFamily(app.db, f.familyId, (tx) => tx.select({
    id: participants.personId, status: participants.status, seen: participants.seenVersion,
  }).from(participants).where(and(eq(participants.familyId, f.familyId), eq(participants.exchangeId, f.exchangeId))));
  const actual = new Map(await Promise.all(f.viewers.slice(0, 6).map(async (viewer, index) => [
    viewer.personId, (await revealMyPerson(index === 1 ? owner : viewer, f.exchangeId, 3)).person.id,
  ] as const)));
  const count = (pairs: ReadonlyMap<string, string>) => ids.filter((id) => pairs.get(id) !== previous.get(id)).length;
  const opened = (pairs: ReadonlyMap<string, string>) => seenGivers.filter((id) => pairs.get(id) === previous.get(id)).length;
  expect(state.seenCount).toBe(opened(actual));
  const all = possibleDraws(ids).filter((pairs) => pairs.get(ids[1]) !== ids[2]);
  const safe = all.filter((pairs) => all.some((other) => count(other) === count(pairs)
    && other.get(ids[4]) === pairs.get(ids[4]) && opened(other) === opened(pairs)
    && other.get(ids[1]) !== pairs.get(ids[1])));
  expect(count(actual)).toBe(Math.min(...safe.map(count)));
  const alternatives = all.filter((pairs) => count(pairs) === count(actual)
    && pairs.get(ids[4]) === actual.get(ids[4]) && opened(pairs) === state.seenCount);
  expect(new Set(alternatives.map((pairs) => pairs.get(ids[1]))).size).toBeGreaterThan(1);
  for (const row of saved) {
    if (row.status === "out") {
      expect(row.seen).toBe(2);
    } else if (actual.get(row.id) !== previous.get(row.id)) {
      expect(row.seen).toBeNull();
    } else {
      expect(row.seen).toBe(seenGivers.includes(row.id) ? 3 : row.id === ids[0] ? 1 : null);
    }
  }
  verifyNoPairing(state);
});
