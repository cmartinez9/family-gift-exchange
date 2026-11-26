import {randomBytes, randomUUID} from "node:crypto";
import {and, eq, sql} from "drizzle-orm";
import {afterAll, beforeAll, expect, it, vi} from "vitest";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {audit, families, households, participants, people} from "../../src/server/db/schema";
import {
  answerQuestion, askYourPerson, changeParticipation, checkSealedDraw, closeExchange, createExchange,
  drawFeasibility, dryRunDraw, editExchange, listExchanges, listOwnQuestions, memberDrawStatus,
  organizerExchange, ownRevealOpenings, practiceCommand, practiceMemberView, practiceSeason,
  previewAsMember, reportPair, revealMyPerson, runDraw, setKeepApart, setParticipants, startPractice,
  type DrawEvents, type DrawViewer, type ExchangeDetails,
} from "../../src/server/draw";
import {withDrawFamily} from "../../src/server/draw/access";
import {assignments, practiceFamilies, questions} from "../../src/server/draw/schema";

vi.mock("server-only", () => ({}));

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

const details: ExchangeDetails = {
  name: "Snowbell Gifts", giftDay: "2023-01-06", giftTime: "18:30", place: "Lantern Hall",
  budgetAmount: "25", listDeadline: "2022-12-30", drawDay: "2023-01-01",
};
const names = ["Mintflake", "Frostsprig", "Candleplum", "Jinglemoss", "Starfern", "Bellswirl", "Driftpetal", "Pinegleam"];

async function fixture({helpers = false, count = 7, active = 6} = {}) {
  const familyId = randomUUID();
  testFamilies.add(familyId);
  const ids = names.slice(0, count).map(() => randomUUID());
  await runForFamily(app.db, familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "The Pinegleam Family"});
    await tx.insert(people).values(ids.map((id, index) => ({
      familyId, id, displayName: names[index],
      role: index === 0 ? "organizer" as const : index === 2 ? "co_organizer" as const : "member" as const,
      helperId: index === 1 && helpers ? ids[0] : null,
    })));
  });
  const viewers = ids.map((personId, index): DrawViewer => ({
    familyId, personId, actingAs: personId, sessionId: randomUUID(), isOrganizer: index === 0 || index === 2,
  }));
  const organizer = viewers[0];
  const {id: exchangeId} = await createExchange(organizer, details);
  await setParticipants(organizer, exchangeId, ids.slice(0, active));
  return {familyId, exchangeId, ids, viewers, organizer, coOrganizer: viewers[2]};
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
    .toEqual([helper.sessionId, deviceTwo.sessionId].sort());
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
