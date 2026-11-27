import {randomBytes, randomUUID} from "node:crypto";
import {createElement} from "react";
import {renderToReadableStream, renderToStaticMarkup} from "react-dom/server";
import {NextIntlClientProvider} from "next-intl";
import {and, eq, sql} from "drizzle-orm";
import {afterAll, afterEach, beforeAll, expect, it, vi} from "vitest";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {audit, claims, exchanges, families, households, items, keepApart, outbox, participants, people} from "../../src/server/db/schema";
import {
  answerQuestion, askYourPerson, changeParticipation, checkSealedDraw, closeExchange, createExchange,
  DrawError, drawFeasibility, dryRunDraw, editExchange, listExchanges, listOwnQuestions, memberDrawStatus, myPerson,
  organizerExchange, ownRevealOpenings, practiceCommand, practiceMemberView, practiceSeason,
  previewAsMember, repairDisputedReveals, reportPair, revealMyPerson, runDraw, setKeepApart, setParticipants, startPractice,
  type DrawEvents, type DrawViewer, type ExchangeDetails,
} from "../../src/server/draw";
import {issueKey, issueOrganizerKey, redeemKey, signInDevice, signInWithPin, type Device} from "../../src/server/auth/access";
import {hashPin} from "../../src/server/auth/pin";
import {pinCredentials} from "../../src/server/auth/schema";
import {account, actFor, disputeEvent, disputeSession, endSessions, listSessionDisputes} from "../../src/server/auth/security";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {requireIssuedKey} from "../helpers/issued-key";
import {readiness, removeMember} from "../../src/server/auth/families";
import {addListItem, getListExchangeCard, getWishlist, setExchangeBudget} from "../../src/server/lists";
import {claimItem, getGettingList, setClaimTick} from "../../src/server/lists/claims";
import {listEvents} from "../../src/server/lists/list-events";
import type {Template} from "../../src/server/messages/templates";
import {renderServerTree} from "../helpers/render-server";
import {modelOneLoop, possibleDraws} from "../helpers/possible-draws";
import * as member from "../../src/server/draw/member";
import * as repair from "../../src/server/draw/repair";
import * as solver from "../../src/server/draw/solver";
import MemberExchangePage from "../../src/app/[locale]/exchanges/[exchangeId]/page";
import ManagePage from "../../src/app/[locale]/exchanges/[exchangeId]/manage/page";
import PracticePage from "../../src/app/[locale]/exchanges/practice/page";
import {drawPage} from "../../src/app/[locale]/exchanges/components";
import {HelpingBanner} from "../../src/app/[locale]/helping/banner";
import AccountPage from "../../src/app/[locale]/account/page";
import {reportEvent, reportSession, signOut, switchProfile} from "../../src/app/[locale]/account/actions";
import {reveal as revealAction} from "../../src/app/[locale]/exchanges/actions";
import {itemCommand, saveBudget, saveItem} from "../../src/app/[locale]/lists/actions";
import {withDrawFamily} from "../../src/server/draw/access";
import {assignments, practiceFamilies, questions} from "../../src/server/draw/schema";

const signedIn = vi.hoisted(() => ({viewer: null as DrawViewer | null, clearSession: vi.fn(), locale: "en" as "en" | "es"}));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", async () => {
  const {createTranslator} = await import("next-intl");
  const {default: en} = await import("../../messages/en.json");
  const {default: es} = await import("../../messages/es.json");
  return {
    getLocale: async () => signedIn.locale,
    getTranslations: async (namespace: "auth" | "draw") => createTranslator({
      locale: signedIn.locale, messages: signedIn.locale === "es" ? es : en, namespace,
    }),
    getFormatter: async () => ({dateTime: (date: Date) => date.toISOString()}),
  };
});
vi.mock("@/i18n/navigation", async () => {
  const {createElement} = await import("react");
  return {
    Link: ({href, children}: {href: string; children: import("react").ReactNode}) => createElement("a", {href}, children),
    useRouter: () => ({push: vi.fn()}),
  };
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
vi.mock("../../src/app/[locale]/exchanges/form", async () => {
  const {createElement} = await import("react");
  return {DrawForm: ({label, children}: {label: string; children?: import("react").ReactNode}) => createElement(
    "form", null, children, createElement("button", {type: "submit"}, label),
  )};
});
vi.mock("../../src/app/[locale]/exchanges/close-season-sheet", async () => {
  const {createElement} = await import("react");
  return {CloseSeasonSheet: ({labels}: {labels: {open: string}}) => createElement("button", {type: "button"}, labels.open)};
});
vi.mock("@/server/auth/request", async (original) => ({
  ...await original<typeof import("../../src/server/auth/request")>(), clearSession: signedIn.clearSession,
  currentDeviceKind: async () => "iphone",
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
vi.mock("@/server/auth", async (original) => ({
  ...await original<typeof import("../../src/server/auth")>(),
  requireViewer: async () => signedIn.viewer!,
  getViewer: async () => signedIn.viewer,
}));

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("The draw integration tests need a disposable Postgres database");
const admin = connectDatabase(databaseUrl);
const suffix = randomBytes(6).toString("hex");
const appRole = `draw_test_app_${suffix}`;
const drawRole = `draw_test_sealed_${suffix}`;
const testFamilies = new Set<string>();

async function drawNoticeIds(familyId: string, template: Template) {
  const rows = await admin.db.select({personId: outbox.personId, requesterName: outbox.requesterName})
    .from(outbox).where(and(eq(outbox.familyId, familyId), eq(outbox.template, template)));
  expect(rows.every(({requesterName}) => requesterName === null)).toBe(true);
  return rows.map(({personId}) => personId).sort();
}

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
  signedIn.locale = "en";
});

function cycle(ids: readonly string[]) {
  return new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
}

async function renderAccountPage() {
  const messages = signedIn.locale === "es" ? (await import("../../messages/es.json")).default
    : (await import("../../messages/en.json")).default;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, {
    locale: signedIn.locale, messages,
  } as Parameters<typeof NextIntlClientProvider>[0], await AccountPage({searchParams: Promise.resolve({})})));
  return new Response(stream).text();
}

const details: ExchangeDetails = {
  name: "Snowbell Gifts", giftDay: "2023-01-06", giftTime: "18:30", place: "Lantern Hall",
  budgetAmount: "25", listDeadline: "2022-12-30", drawDay: "2023-01-01",
};
const names = ["Mintflake", "Frostsprig", "Candleplum", "Jinglemoss", "Starfern", "Bellswirl", "Driftpetal", "Pinegleam", "Hollybrook"];

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
  const foreignGiver = await withDrawFamily(a.organizer, (tx) => tx.execute(sql`
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
  expect(await withDrawFamily(b.organizer, (tx) => tx.select().from(assignments).where(
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
  const helperSession = await runForFamily(app.db, familyId, (tx) => signInDevice(
    tx, familyId, organizer.personId, {hash: digest(secret()), kind: "computer", network: null}, new Date(),
  ));
  const helperOwner = {...organizer, sessionId: helperSession.id};
  await runForFamily(app.db, familyId, (tx) => actFor(tx, helperOwner, ids[1]));
  const helper = {...helperOwner, actingAs: ids[1]};
  expect(await myPerson(helper, exchangeId)).toEqual({recipientId: null, version: 2});
  expect(await organizerExchange(organizer, exchangeId)).toMatchObject({seenCount: 0, exchange: {status: "drawn"}});
  await expect(revealMyPerson(viewers[1], exchangeId, 2)).rejects.toMatchObject({code: "forbidden"});
  await expect(revealMyPerson({...viewers[3], actingAs: ids[1]}, exchangeId, 2))
    .rejects.toMatchObject({code: "forbidden"});
  await expect(revealMyPerson({...organizer, actingAs: ids[3]}, exchangeId, 2))
    .rejects.toMatchObject({code: "forbidden"});
  const opened = await revealMyPerson(helper, exchangeId, 2);
  expect(await myPerson(helper, exchangeId)).toEqual({recipientId: opened.person.id, version: 2});
  expect(await myPerson(organizer, exchangeId)).toEqual({recipientId: null, version: 2});
  expect(Object.keys(opened).sort()).toEqual(["person", "version"]);
  expect(opened.person.id).not.toBe(ids[0]);
  expect(opened.person.id).not.toBe(ids[1]);
  const secondSession = await runForFamily(app.db, familyId, (tx) => signInDevice(
    tx, familyId, organizer.personId, {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const secondOwner = {...organizer, sessionId: secondSession.id};
  await runForFamily(app.db, familyId, (tx) => actFor(tx, secondOwner, ids[1]));
  const deviceTwo = {...secondOwner, actingAs: ids[1]};
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
  expect(await drawNoticeIds(familyId, "names-drawn")).toEqual(ids.slice(0, 6).sort());
  const known = new Map(await Promise.all(viewers.slice(0, 6).map(async (viewer) =>
    [viewer.personId, (await revealMyPerson(viewer, exchangeId, 1)).person.id] as const)));
  const dropout = await changeParticipation(organizer, exchangeId, ids[1], "out", 1);
  expect(dropout).toMatchObject({version: 2, changedGivers: 1, participantCount: 5});
  const changed = [...known].find(([, recipient]) => recipient === ids[1])![0];
  expect(await drawNoticeIds(familyId, "plans-changed")).toEqual([changed]);
  expect(await drawNoticeIds(familyId, "participation-cancelled")).toEqual([ids[1]]);
  expect(await organizerExchange(organizer, exchangeId)).toMatchObject({seenCount: 4});
  const entry = await changeParticipation(organizer, exchangeId, ids[6], "in", 2);
  expect(entry).toMatchObject({version: 3, changedGivers: 1, participantCount: 6});
  await expect(revealMyPerson(viewers[1], exchangeId, 3)).rejects.toMatchObject({code: "notFound"});
  const rows = await runForFamily(app.db, familyId, (tx) => tx.select({
    id: participants.personId, seen: participants.seenVersion,
  }).from(participants).where(and(eq(participants.familyId, familyId), eq(participants.exchangeId, exchangeId))));
  const current = new Map(await Promise.all(viewers.filter(({personId}) => personId !== ids[1]).map(async (viewer) =>
    [viewer.personId, (await revealMyPerson(viewer, exchangeId, 3)).person.id] as const)));
  const predecessor = [...current].find(([, recipient]) => recipient === ids[6])![0];
  expect(await drawNoticeIds(familyId, "plans-changed")).toEqual([changed, predecessor, ids[6]].sort());
  for (const row of rows) {
    expect(row.seen).toBe([ids[1], changed, predecessor, ids[6]].includes(row.id) ? null : 3);
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
  expect(await drawNoticeIds(familyId, "question-answered")).toEqual([]);
  await answerQuestion(recipient, exchangeId, id, 1, "Moonlight blue");
  await expect(answerQuestion(recipient, exchangeId, id, 1, "Second answer")).rejects.toMatchObject({code: "alreadyAnswered"});
  expect(await drawNoticeIds(familyId, "question-answered")).toEqual([asker.personId]);
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
  const {seal} = (await organizerExchange(organizer, exchangeId)).exchange;
  expect(seal).toBeTruthy();
  await closeExchange(organizer, exchangeId);
  expect(await checkSealedDraw(organizer, exchangeId)).toEqual({status: "closed"});
  expect((await organizerExchange(organizer, exchangeId)).exchange).toMatchObject({status: "closed", seal});
  expect(await admin.db.select().from(assignments).where(eq(assignments.familyId, familyId))).toEqual([]);
  expect(await admin.db.select().from(questions).where(eq(questions.familyId, familyId))).toEqual([]);
  await expect(runDraw(organizer, exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "closed"});
  expect(await memberDrawStatus(viewers[1], exchangeId)).toMatchObject({status: "closed"});
});

it.each(["open", "setup"] as const)("clears all family marks and checklist entries after claims during %s", async (status) => {
  const {organizer, viewers, exchangeId, familyId} = await fixture();
  const foreign = await fixture({count: 3, active: 3});
  const buyer = viewers[1];
  const owner = viewers[2];
  const otherExchangeId = randomUUID();
  const createItem = (title: string) => addListItem(owner, owner.actingAs, {kind: "note", title});
  const season = await createItem("Season gift");
  const other = await createItem("Other season gift");
  const standalone = await createItem("Birthday gift");
  const scoped = <T,>(action: Parameters<typeof runForFamily<T>>[2]) => runForFamily(app.db, familyId, action);
  const claimRows = () => scoped((tx) => tx.select().from(claims).orderBy(claims.id));
  const itemRows = () => scoped((tx) => tx.select().from(items).orderBy(items.id));
  await scoped(async (tx) => {
    await tx.update(exchanges).set({status}).where(eq(exchanges.id, exchangeId));
    await tx.insert(exchanges).values({familyId, id: otherExchangeId, name: "Other season", status: "closed"});
    await tx.insert(claims).values([
      {familyId, itemId: other.id, exchangeId: otherExchangeId, claimerId: buyer.actingAs},
      {familyId, itemId: standalone.id, claimerId: buyer.actingAs},
    ]);
  });
  const foreignOwner = foreign.viewers[2];
  const foreignBuyer = foreign.viewers[1];
  const foreignItem = await addListItem(foreignOwner, foreignOwner.actingAs, {kind: "note", title: "Another family's gift"});
  await claimItem(foreignBuyer, foreignItem.id);
  await setClaimTick(foreignBuyer, foreignItem.id, "bought", true);
  await setClaimTick(foreignBuyer, foreignItem.id, "wrapped", true);
  const foreignClaims = () => runForFamily(app.db, foreign.familyId, (tx) => tx.select().from(claims));
  const savedForeignClaims = await foreignClaims();
  const foreignChecklist = await getGettingList(foreignBuyer);
  const wishlist = await getWishlist(owner, owner.actingAs);
  const savedItems = await itemRows();

  await claimItem(buyer, season.id);
  for (const item of [season, other, standalone]) {
    await setClaimTick(buyer, item.id, "bought", true);
    await setClaimTick(buyer, item.id, "wrapped", true);
  }
  expect(await claimRows()).toContainEqual(expect.objectContaining({
    itemId: season.id, exchangeId: null,
  }));
  expect(await getGettingList(buyer)).toEqual(expect.arrayContaining(
    [season, other, standalone].map(({id}) => expect.objectContaining({itemId: id, bought: true, wrapped: true})),
  ));

  await editExchange(organizer, exchangeId, details);
  await runDraw(organizer, exchangeId, {expectedVersion: 0});
  await closeExchange(organizer, exchangeId);

  expect(await claimRows()).toEqual([]);
  expect(await itemRows()).toEqual(savedItems);
  expect(await getWishlist(owner, owner.actingAs)).toEqual(wishlist);
  expect((await getWishlist(buyer, owner.actingAs)).items.every((item) => item.claim === undefined)).toBe(true);
  expect(await getGettingList(buyer)).toEqual([]);
  expect(await foreignClaims()).toEqual(savedForeignClaims);
  expect(await getGettingList(foreignBuyer)).toEqual(foreignChecklist);
});

it.each(["between seasons", "during the next season"])("preserves later marks after a repeated close %s", async (phase) => {
  const {organizer, coOrganizer, viewers, exchangeId, familyId} = await fixture();
  const buyer = viewers[1];
  const owner = viewers[2];
  const item = await addListItem(owner, owner.actingAs, {kind: "note", title: "Gift for later"});
  await claimItem(buyer, item.id);
  await closeExchange(organizer, exchangeId);
  expect(await getGettingList(buyer)).toEqual([]);
  if (phase === "during the next season") await createExchange(organizer, {...details, name: "Next season"});
  await claimItem(buyer, item.id);
  await setClaimTick(buyer, item.id, "bought", true);
  await setClaimTick(buyer, item.id, "wrapped", true);
  const claimRows = () => runForFamily(app.db, familyId, (tx) => tx.select().from(claims));
  const savedClaims = await claimRows();
  const checklist = await getGettingList(buyer);
  expect(checklist).toEqual([expect.objectContaining({itemId: item.id, bought: true, wrapped: true})]);

  await closeExchange(coOrganizer, exchangeId);

  expect(await claimRows()).toEqual(savedClaims);
  expect(await getGettingList(buyer)).toEqual(checklist);
  expect((await getWishlist(buyer, owner.actingAs)).items).toEqual([expect.objectContaining({id: item.id, claim: "mine"})]);
});

it.each(["open", "setup"] as const)("waits for a concurrent %s claim before clearing family marks", async (status) => {
  const {organizer, viewers, exchangeId, familyId} = await fixture();
  const buyer = viewers[1];
  const owner = viewers[2];
  const item = await addListItem(owner, owner.actingAs, {kind: "note", title: "Concurrent gift"});
  await runForFamily(app.db, familyId, (tx) => tx.update(exchanges).set({status}).where(eq(exchanges.id, exchangeId)));
  const locked = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const holding = admin.db.transaction(async (tx) => {
    await tx.select({id: items.id}).from(items).where(and(eq(items.familyId, familyId), eq(items.id, item.id))).for("update");
    const {rows: [row]} = await tx.execute<{pid: number}>(sql`SELECT pg_backend_pid() AS pid`);
    locked.resolve(row.pid);
    await release.promise;
  });
  void holding.catch(locked.reject);
  let claiming: Promise<{value?: unknown; error?: unknown}> | undefined;
  let closing: Promise<{value?: unknown; error?: unknown}> | undefined;
  try {
    const blocker = await locked.promise;
    claiming = claimItem(buyer, item.id).then((value) => ({value}), (error: unknown) => ({error}));
    let claimPid = 0;
    await vi.waitFor(async () => {
      const {rows} = await admin.db.execute<{pid: number}>(sql`
        SELECT pid FROM pg_stat_activity
        WHERE ${blocker} = ANY(pg_blocking_pids(pid)) AND usename = ${appRole}
      `);
      expect(rows).toHaveLength(1);
      claimPid = rows[0].pid;
    }, {timeout: 3000, interval: 10});
    closing = closeExchange(organizer, exchangeId).then((value) => ({value}), (error: unknown) => ({error}));
    await vi.waitFor(async () => {
      const {rows: [row]} = await admin.db.execute<{blocked: boolean}>(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${claimPid} = ANY(pg_blocking_pids(pid)) AND usename = ${drawRole}
        ) AS blocked
      `);
      expect(row.blocked).toBe(true);
    }, {timeout: 3000, interval: 10});
  } finally {
    release.resolve();
    await holding;
    await Promise.all([claiming, closing]);
  }
  expect(await claiming).toEqual({value: undefined});
  expect(await closing).toEqual({value: undefined});
  expect((await organizerExchange(organizer, exchangeId)).exchange.status).toBe("closed");
  expect(await runForFamily(app.db, familyId, (tx) => tx.select().from(claims))).toEqual([]);
  expect(await getGettingList(buyer)).toEqual([]);
  expect((await getWishlist(buyer, owner.actingAs)).items).toEqual([expect.objectContaining({id: item.id})]);
});

it("rejects a stale Family lists budget form after the exchange closes", async () => {
  const {organizer, exchangeId} = await fixture();
  signedIn.viewer = organizer;
  const card = await getListExchangeCard(organizer);
  expect(card).toMatchObject({id: exchangeId, budgetAmount: "25.00"});
  const form = new FormData();
  form.set("budget", "50");

  await closeExchange(organizer, exchangeId);

  const result = await saveBudget(card!.id, {}, form);
  expect(await listExchanges(organizer)).toEqual([expect.objectContaining({
    id: exchangeId, status: "closed", budgetAmount: "25.00",
  })]);
  expect(result).toEqual({error: "closed"});
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

it("loads and starts isolated practice while the real family has an unresolved repair", async () => {
  const f = await fixture({count: 4, active: 4});
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(cycle(f.ids));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const reporter = {...f.viewers[1], sessionId: session.id};
  await expect(runForFamily(app.db, f.familyId, (tx) => disputeSession(tx, reporter, f.viewers[1].sessionId, new Date())))
    .resolves.toBe(true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(repair, "repairDraw").mockImplementation(() => { throw new DrawError("checkTimedOut"); });
  await expect(repairDisputedReveals(f.organizer)).rejects.toMatchObject({code: "checkTimedOut"});
  expect(await myPerson(reporter, f.exchangeId)).toBeNull();
  signedIn.viewer = f.organizer;
  const page = () => PracticePage({searchParams: Promise.resolve({})}).then(renderServerTree).then(renderToStaticMarkup);
  expect(await practiceSeason(f.organizer)).toBeNull();
  expect(await page()).toContain("Start practice");
  await startPractice(f.organizer, "en");
  const [mapping] = await admin.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, f.familyId));
  testFamilies.add(mapping.practiceFamilyId);
  expect((await practiceSeason(f.organizer))!.exchange).toMatchObject({status: "open", version: 0});
  expect(await page()).toContain("Draw names");
  await practiceCommand(f.organizer, {kind: "draw", expectedVersion: 0});
  const drawn = (await practiceSeason(f.organizer))!;
  expect(drawn.exchange.version).toBe(1);
  expect(drawn.pairs).toHaveLength(6);
  expect(await page()).toContain(drawn.pairs[0].giver);
  const log = await runForFamily(app.db, f.familyId, (tx) => tx.select().from(audit)
    .where(and(eq(audit.familyId, f.familyId), eq(audit.action, "draw.decrypt.practice"))));
  expect(log.length).toBeGreaterThan(0);
  await expect(practiceSeason(reporter)).rejects.toMatchObject({code: "forbidden"});
  expect(await practiceSeason(f.coOrganizer)).toBeNull();
  await expect(repairDisputedReveals(f.organizer)).rejects.toMatchObject({code: "checkTimedOut"});
  expect((await organizerExchange(f.organizer, f.exchangeId)).exchange.version).toBe(1);
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

it("carries the exact wishlist identity through a reveal when two relatives are named Alex", async () => {
  const f = await fixture({count: 6, coOrganizerIndex: null});
  await runForFamily(app.db, f.familyId, async (tx) => {
    for (const id of f.ids.slice(1, 3)) {
      await tx.update(people).set({displayName: "Alex"}).where(and(eq(people.familyId, f.familyId), eq(people.id, id)));
    }
  });
  await addListItem(f.viewers[1], f.ids[1], {kind: "note", title: "Alex's telescope"});
  await addListItem(f.viewers[2], f.ids[2], {kind: "note", title: "Alex's knitting book"});
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(cycle(f.ids));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  for (const [index, title] of [[0, "Alex's telescope"], [1, "Alex's knitting book"]] as const) {
    const viewer = f.viewers[index];
    signedIn.viewer = viewer;
    const result = await revealAction({id: f.exchangeId, subject: viewer.actingAs, version: 1});
    expect(result).toEqual({personName: "Alex", personId: f.ids[index + 1]});
    const list = await getWishlist(viewer, result.personId!);
    expect(list.owner).toMatchObject({id: result.personId, name: "Alex"});
    expect(list.items.map((item) => item.title)).toEqual([title]);
  }
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
  await expect(reportEvent(event.id)).rejects.toThrow(`redirect:/en/account/notices/${event.id}?reported=1`);
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
  expect(await drawNoticeIds(f.familyId, "draw-redrawn")).toEqual(f.ids.slice(0, 6).sort());
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
    && pairs.get(f.ids[4]) === actual.get(f.ids[4]) && modelOneLoop(pairs) === modelOneLoop(actual)
    && pairs.get(f.ids[1]) !== f.ids[2]);
  expect(new Set(alternatives.map((pairs) => pairs.get(f.ids[1]))).size).toBeGreaterThan(1);
  verifyNoPairing(await organizerExchange(f.organizer, f.exchangeId));
});

it.each(["local repair", "confirmed redraw"])("restores a six-person draw after an organizer disputes their own reveal and recovers with a %s", async (recovery) => {
  const f = await fixture({count: 6, coOrganizerIndex: null});
  const pepper = secret();
  const pin = "4268";
  const pinHash = await hashPin(pepper, pin);
  const joinedAt = new Date(Date.now() - 3_600_000);
  await runForFamily(app.db, f.familyId, (tx) => tx.insert(pinCredentials).values(f.ids.map((personId) => ({
    familyId: f.familyId, personId, pinHash, joinedAt, changedAt: joinedAt,
  }))));
  const previous = cycle(f.ids);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  expect((await revealMyPerson(f.organizer, f.exchangeId, 1)).person.id).toBe(f.ids[1]);
  const device = (): Device => ({hash: digest(secret()), kind: "ipad", network: null});
  const reporter = await runForFamily(app.db, f.familyId, (tx) => signInWithPin(
    tx, f.familyId, f.ids[0], pin, pepper, device(), new Date(),
  ));
  signedIn.viewer = await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(reporter.session!.cookie)!));
  await expect(reportSession(f.organizer.sessionId)).rejects.toThrow(`redirect:/en/sign-in?family=${f.familyId}&safety=1`);
  const disputes = await runForFamily(app.db, f.familyId, (tx) => listSessionDisputes(tx, f.familyId, f.ids[0]));
  expect(disputes.map(({sessionId}) => sessionId)).toContain(f.organizer.sessionId);
  const key = requireIssuedKey(await runForFamily(app.db, f.familyId, (tx) => issueOrganizerKey(tx, f.familyId, pepper, new Date())));
  const session = await runForFamily(app.db, f.familyId, (tx) => redeemKey(tx, {
    familyId: f.familyId, value: key.token, typed: false, pin: "8642", confirmation: "8642", pepper,
    device: device(), currentViewer: null, now: new Date(),
  }));
  const organizer = (await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.session!.cookie)!)))!;
  expect(organizer).toMatchObject({personId: f.ids[0], isOrganizer: true});
  if (recovery === "confirmed redraw") {
    await expect(runDraw(organizer, f.exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "confirmationRequired"});
    await runDraw(organizer, f.exchangeId, {expectedVersion: 1, confirmation: "REDRAW"});
  }
  expect(await memberDrawStatus(organizer, f.exchangeId)).toMatchObject({status: "ready", exchange: {version: 2}});
  const actual = new Map([[f.ids[0], (await revealMyPerson(organizer, f.exchangeId, 2)).person.id]]);
  expect(actual.get(f.ids[0])).not.toBe(previous.get(f.ids[0]));
  for (const personId of f.ids.slice(1)) {
    const login = await runForFamily(app.db, f.familyId, (tx) => signInWithPin(tx, f.familyId, personId, pin, pepper, device(), new Date()));
    const viewer = (await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(login.session!.cookie)!)))!;
    expect(await memberDrawStatus(viewer, f.exchangeId)).toMatchObject({status: "ready", exchange: {version: 2}});
    actual.set(personId, (await revealMyPerson(viewer, f.exchangeId, 2)).person.id);
    await expect(listOwnQuestions(viewer, f.exchangeId)).resolves.toMatchObject({version: 2});
  }
  expect(new Set(actual.values()).size).toBe(6);
  if (recovery === "local repair") expect(f.ids.filter((id) => actual.get(id) !== previous.get(id))).toHaveLength(2);
  expect((await organizerExchange(organizer, f.exchangeId)).exchange.disputedRevealRepairedAt).toBeInstanceOf(Date);
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
  const event = activity.find(({sessionId, kind}) => sessionId === first.viewer.sessionId && kind === "resetUsed")!;
  const report = method === "opening" ? reportSession(intruder.sessionId)
    : reportEvent(event.id);
  const destination = method === "opening" ? "/en/account" : `/en/account/notices/${event.id}`;
  await expect(report).rejects.toThrow(`redirect:${destination}?reported=1`);
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

it.each(["local repair", "confirmed redraw"])("restores the four-person A B C D draw with organizers A and C through a %s", async (recovery) => {
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
  if (recovery === "local repair") {
    await expect(reportSession(f.viewers[1].sessionId)).rejects.toThrow("redirect:/en/account?reported=1");
  } else {
    await expect(runForFamily(app.db, f.familyId, (tx) => disputeSession(tx, owner, f.viewers[1].sessionId, new Date())))
      .resolves.toBe(true);
    await expect(runDraw(f.organizer, f.exchangeId, {expectedVersion: 1})).rejects.toMatchObject({code: "confirmationRequired"});
    await runDraw(f.organizer, f.exchangeId, {expectedVersion: 1, confirmation: "REDRAW"});
  }
  const disputes = await runForFamily(app.db, f.familyId, (tx) => listSessionDisputes(tx, f.familyId, owner.personId));
  expect(disputes.map(({sessionId}) => sessionId)).toContain(f.viewers[1].sessionId);
  expect(await runForFamily(app.db, f.familyId, (tx) => account(tx, owner))).toMatchObject({
    helpers: [{id: f.ids[4], name: names[4]}],
    activity: expect.arrayContaining([expect.objectContaining({sessionId: f.viewers[1].sessionId, disputed: expect.any(String)})]),
  });
  expect(await ownRevealOpenings(owner)).toEqual([expect.objectContaining({sessionId: f.viewers[1].sessionId, disputed: true})]);
  for (const viewer of [f.organizer, owner, f.coOrganizer, f.viewers[3]]) {
    signedIn.viewer = viewer;
    const html = await renderAccountPage();
    expect(html).toContain('href="/account/notices"');
    expect(html).toContain("Sign out");
    expect(html).toContain('href="/exchanges"');
  }
  const actual = new Map<string, string>();
  for (const viewer of [f.organizer, owner, f.coOrganizer, f.viewers[3]]) {
    expect(await memberDrawStatus(viewer, f.exchangeId)).toMatchObject({status: "ready", exchange: {version: 2}});
    actual.set(viewer.personId, (await revealMyPerson(viewer, f.exchangeId, 2)).person.id);
  }
  expect(actual.get(owner.personId)).not.toBe(f.ids[2]);
  expect(new Set(actual.values()).size).toBe(4);
  expect(await checkSealedDraw(f.organizer, f.exchangeId)).toMatchObject({valid: true, count: 4});
  expect((await organizerExchange(f.organizer, f.exchangeId)).exchange.disputedRevealRepairedAt).toBeInstanceOf(Date);
  expect((await listOwnQuestions(owner, f.exchangeId)).outgoing).toEqual([]);
  expect((await listOwnQuestions(f.viewers[2], f.exchangeId)).incoming.map(({id}) => id)).not.toContain(question.id);
  const replacementQuestion = await askYourPerson(owner, f.exchangeId, 2, "Still there?");
  const recipient = f.viewers.find(({personId}) => personId === actual.get(owner.personId))!;
  await answerQuestion(recipient, f.exchangeId, replacementQuestion.id, 2, "Yes");
  expect((await listOwnQuestions(owner, f.exchangeId)).outgoing).toContainEqual(expect.objectContaining({answer: "Yes"}));
  signedIn.viewer = owner;
  await expect(switchProfile(f.ids[4])).rejects.toThrow("redirect:/en/helping");
  signedIn.viewer = await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!));
  expect(signedIn.viewer).toMatchObject({actingAs: f.ids[4]});
  const html = renderToStaticMarkup(await renderServerTree(await HelpingBanner()));
  expect(html).toContain(`helping ${names[4]}`);
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
  const seenGivers: string[] = [ids[1], ids[3], ids[4]];
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
    && other.get(ids[4]) === pairs.get(ids[4]) && modelOneLoop(other) === modelOneLoop(pairs)
    && opened(other) === opened(pairs)
    && other.get(ids[1]) !== pairs.get(ids[1])));
  expect(count(actual)).toBe(Math.min(...safe.map(count)));
  const alternatives = all.filter((pairs) => count(pairs) === count(actual)
    && pairs.get(ids[4]) === actual.get(ids[4]) && modelOneLoop(pairs) === modelOneLoop(actual)
    && opened(pairs) === state.seenCount);
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

it.each(["member reveal", "organizer edit", "practice read", "practice draw"])(
  "rejects a queued %s after the authenticated session is revoked", async (operation) => {
    const f = await fixture();
    await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
    const personId = operation === "member reveal" ? f.ids[3] : f.organizer.personId;
    const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
      tx, f.familyId, personId, {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
    ));
    const actor = (await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!)))!;
    let practiceVersion: number | undefined;
    if (operation.startsWith("practice")) {
      await startPractice(actor, "en");
      const [mapping] = await admin.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, f.familyId));
      testFamilies.add(mapping.practiceFamilyId);
      if (operation === "practice read") await practiceCommand(actor, {kind: "draw", expectedVersion: 0});
      practiceVersion = operation === "practice read" ? 1 : 0;
    }
    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const revocation = runForFamily(app.db, f.familyId, async (tx) => {
      expect(await endSessions(tx, actor, new Date(), false)).toBe(true);
      const {rows: [row]} = await tx.execute<{pid: number}>(sql`SELECT pg_backend_pid() AS pid`);
      locked.resolve(row.pid);
      await release.promise;
    });
    void revocation.catch(locked.reject);
    let outcome: Promise<{value?: unknown; error?: unknown}> | undefined;
    try {
      const blocker = await locked.promise;
      const authenticated = await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!));
      expect(authenticated).not.toBeNull();
      const request: Promise<unknown> = operation === "member reveal" ? revealMyPerson(authenticated!, f.exchangeId, 1)
        : operation === "organizer edit" ? editExchange(authenticated!, f.exchangeId, {...details, budgetAmount: "99"})
        : operation === "practice read" ? practiceSeason(authenticated!)
        : practiceCommand(authenticated!, {kind: "draw", expectedVersion: 0});
      outcome = request.then((value) => ({value}), (error: unknown) => ({error}));
      await vi.waitFor(async () => {
        const {rows: [row]} = await admin.db.execute<{blocked: boolean}>(sql`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity AS activity WHERE ${blocker} = ANY(pg_blocking_pids(activity.pid))
          ) AS blocked
        `);
        expect(row.blocked).toBe(true);
      }, {timeout: 3000, interval: 10});
    } finally {
      release.resolve();
      await revocation;
    }
    expect(await outcome).toMatchObject({error: {code: "forbidden"}});
    expect(await organizerExchange(f.organizer, f.exchangeId)).toMatchObject({seenCount: 0, exchange: {version: 1, budgetAmount: "25.00"}});
    if (practiceVersion !== undefined) {
      expect((await practiceSeason(f.organizer))!.exchange.version).toBe(practiceVersion);
    }
  },
);

it("rejects a delegated practice reveal after owner revocation and rejects copied synthetic identities", async () => {
  const f = await fixture();
  await startPractice(f.organizer, "en");
  const [mapping] = await admin.db.select().from(practiceFamilies).where(eq(practiceFamilies.familyId, f.familyId));
  testFamilies.add(mapping.practiceFamilyId);
  await practiceCommand(f.organizer, {kind: "draw", expectedVersion: 0});
  const season = (await practiceSeason(f.organizer))!;
  const subject = season.people.find(({participating}) => participating)!;
  const entered = Promise.withResolvers<{viewer: DrawViewer; id: string; version: number}>();
  const resume = Promise.withResolvers<void>();
  const reveal = member.revealMyPerson;
  vi.spyOn(member, "revealMyPerson").mockImplementation(async (viewer, id, version) => {
    entered.resolve({viewer, id, version});
    await resume.promise;
    return reveal(viewer, id, version);
  });
  const outcome = practiceCommand(f.organizer, {kind: "reveal", as: subject.id, expectedVersion: 1})
    .then((value) => ({value}), (error: unknown) => ({error}));
  try {
    const delegated = await entered.promise;
    await expect(reveal({...delegated.viewer}, delegated.id, delegated.version)).rejects.toMatchObject({code: "forbidden"});
    await runForFamily(app.db, f.familyId, (tx) => endSessions(tx, f.organizer, new Date(), false));
  } finally {
    resume.resolve();
  }
  expect(await outcome).toMatchObject({error: {code: "forbidden"}});
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.organizer.personId, {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  expect((await practiceSeason({...f.organizer, sessionId: session.id}))!.exchange.version).toBe(1);
});

it("rejects stale acting profiles and expired sessions at the draw boundary", async () => {
  const f = await fixture({helpers: true});
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.organizer.personId, {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const owner = {...f.organizer, sessionId: session.id};
  expect(await runForFamily(app.db, f.familyId, (tx) => actFor(tx, owner, f.ids[1]))).toBe(true);
  await expect(revealMyPerson(owner, f.exchangeId, 1)).rejects.toMatchObject({code: "forbidden"});
  await expect(editExchange(owner, f.exchangeId, {...details, budgetAmount: "99"})).rejects.toMatchObject({code: "forbidden"});
  await expect(startPractice(owner, "en")).rejects.toMatchObject({code: "forbidden"});
  const helper = (await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!)))!;
  await revealMyPerson(helper, f.exchangeId, 1);
  expect(await runForFamily(app.db, f.familyId, (tx) => actFor(tx, helper, f.organizer.personId))).toBe(true);
  await expect(revealMyPerson(helper, f.exchangeId, 1)).rejects.toMatchObject({code: "forbidden"});
  await runForFamily(app.db, f.familyId, (tx) => tx.execute(sql`
    UPDATE public.sessions SET expires_at = now() - interval '1 second' WHERE family_id = ${f.familyId} AND id = ${session.id}
  `));
  await expect(listExchanges(owner)).rejects.toMatchObject({code: "forbidden"});
});

it("restores the sign-in handoff after a disputed organizer session locks down the family", async () => {
  const f = await fixture();
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.organizer.personId, {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  signedIn.viewer = {...f.organizer, sessionId: session.id};
  await expect(reportSession(f.organizer.sessionId)).rejects.toThrow(`redirect:/en/sign-in?family=${f.familyId}&safety=1`);
  expect(signedIn.clearSession).toHaveBeenCalledOnce();
  expect(await runForFamily(app.db, f.familyId, (tx) => findViewer(tx, parseSession(session.cookie)!))).toBeNull();
});

it("keeps repaired B ambiguous after the organizer observes question retention, reveals and opened count", async () => {
  const f = await fixture({count: 6, organizerIndex: 4, coOrganizerIndex: null});
  const previous = cycle(f.ids);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  for (const viewer of f.viewers) await revealMyPerson(viewer, f.exchangeId, 1);
  const recognized = await askYourPerson(f.viewers[3], f.exchangeId, 1, "The blue lantern is my secret code.");
  const outgoing = await askYourPerson(f.organizer, f.exchangeId, 1, "Organizer's outgoing question.");
  await askYourPerson(f.viewers[0], f.exchangeId, 1, "This question is private to A and B.");
  expect((await listOwnQuestions(f.organizer, f.exchangeId)).incoming).toContainEqual({
    id: recognized.id, text: "The blue lantern is my secret code.", answered: false,
  });
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const owner = {...f.viewers[1], sessionId: session.id};
  signedIn.viewer = owner;
  await expect(reportSession(f.viewers[1].sessionId)).rejects.toThrow("redirect:/en/account?reported=1");
  const state = await organizerExchange(f.organizer, f.exchangeId);
  const visible = await listOwnQuestions(f.organizer, f.exchangeId);
  const retained = visible.incoming.some(({id}) => id === recognized.id);
  const actual = new Map(await Promise.all(f.viewers.map(async (viewer, index) => [
    viewer.personId, (await revealMyPerson(index === 1 ? owner : viewer, f.exchangeId, 2)).person.id,
  ] as const)));
  const count = (pairs: ReadonlyMap<string, string>) => f.ids.filter((id) => pairs.get(id) !== previous.get(id)).length;
  const questionRetained = (pairs: ReadonlyMap<string, string>) => pairs.get(f.ids[3]) === f.ids[4];
  expect(retained).toBe(questionRetained(actual));
  expect(visible.outgoing.some(({id}) => id === outgoing.id)).toBe(actual.get(f.ids[4]) === previous.get(f.ids[4]));
  expect(state.seenCount).toBe(f.ids.length - count(actual));
  const all = possibleDraws(f.ids).filter((pairs) => pairs.get(f.ids[1]) !== f.ids[2]);
  const safe = all.filter((pairs) => all.some((other) => count(other) === count(pairs)
    && other.get(f.ids[4]) === pairs.get(f.ids[4]) && modelOneLoop(other) === modelOneLoop(pairs)
    && questionRetained(other) === questionRetained(pairs)
    && other.get(f.ids[1]) !== pairs.get(f.ids[1])));
  expect(count(actual)).toBe(Math.min(...safe.map(count)));
  const alternatives = all.filter((pairs) => count(pairs) === count(actual)
    && pairs.get(f.ids[4]) === actual.get(f.ids[4]) && modelOneLoop(pairs) === modelOneLoop(actual)
    && questionRetained(pairs) === retained
    && f.ids.length - count(pairs) === state.seenCount);
  expect(new Set(alternatives.map((pairs) => pairs.get(f.ids[1]))).size).toBeGreaterThan(1);
  verifyNoPairing(state);
});

it("keeps the disputed recipient ambiguous at the same public sealed-loop result", async () => {
  const f = await fixture({count: 9, active: 9, organizerIndex: 4, coOrganizerIndex: null});
  const previous = cycle(f.ids);
  const exclusions = [[1, 6], [1, 7], [2, 7]] as const;
  for (const [a, b] of exclusions) await setKeepApart(f.organizer, f.exchangeId, f.ids[a], f.ids[b], "custom");
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  for (const viewer of f.viewers) await revealMyPerson(viewer, f.exchangeId, 1);
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const owner = {...f.viewers[1], sessionId: session.id};
  signedIn.viewer = owner;
  await expect(reportSession(f.viewers[1].sessionId)).rejects.toThrow("redirect:/en/account?reported=1");
  const state = await organizerExchange(f.organizer, f.exchangeId);
  const proof = await checkSealedDraw(f.organizer, f.exchangeId);
  expect(proof).toMatchObject({status: "checked", valid: true});
  if (proof.status !== "checked") throw new Error("Missing sealed check");
  const actual = new Map(await Promise.all(f.viewers.map(async (viewer, index) => [
    viewer.personId, (await revealMyPerson(index === 1 ? owner : viewer, f.exchangeId, 2)).person.id,
  ] as const)));
  const changed = (pairs: ReadonlyMap<string, string>) => f.ids.filter((id) => pairs.get(id) !== previous.get(id)).length;
  expect(await drawNoticeIds(f.familyId, "plans-changed"))
    .toEqual(f.ids.filter((id) => actual.get(id) !== previous.get(id)).sort());
  expect(proof.oneLoop).toBe(modelOneLoop(actual));
  expect(state.seenCount).toBe(f.ids.length - changed(actual));
  const alternatives = possibleDraws(f.ids).filter((pairs) => pairs.get(f.ids[1]) !== f.ids[2]
    && exclusions.every(([a, b]) => pairs.get(f.ids[a]) !== f.ids[b] && pairs.get(f.ids[b]) !== f.ids[a])
    && changed(pairs) === changed(actual) && pairs.get(f.ids[4]) === actual.get(f.ids[4])
    && modelOneLoop(pairs) === proof.oneLoop && f.ids.length - changed(pairs) === state.seenCount);
  expect(new Set(alternatives.map((pairs) => pairs.get(f.ids[1]))).size).toBeGreaterThan(1);
  verifyNoPairing([state, proof]);
}, 10_000);

it("selects the active dated exchange ahead of closed undated history in family management", async () => {
  const f = await fixture();
  await editExchange(f.organizer, f.exchangeId, {...details, giftDay: null, giftTime: null});
  await closeExchange(f.organizer, f.exchangeId);
  const next = await createExchange(f.organizer, {...details, name: "Current Christmas"});
  await setParticipants(f.organizer, next.id, f.ids.slice(0, 6));
  await setKeepApart(f.organizer, next.id, f.ids[0], f.ids[1], "partner");
  const ready = () => runForFamily(app.db, f.familyId, (tx) => readiness(tx, f.organizer, new Date()));
  expect(await ready()).toMatchObject({exchangeId: next.id, constraintsOpen: true, pairs: [expect.any(Object)]});
  await runDraw(f.organizer, next.id, {expectedVersion: 0});
  expect(await ready()).toMatchObject({exchangeId: next.id, constraintsOpen: false, pairs: [expect.any(Object)]});
  await expect(runForFamily(app.db, f.familyId, (tx) => removeMember(tx, f.organizer, f.ids[1], new Date())))
    .resolves.toBe("drawStarted");
  const [person] = await admin.db.select({removedAt: people.removedAt}).from(people).where(and(
    eq(people.familyId, f.familyId), eq(people.id, f.ids[1]),
  ));
  expect(person.removedAt).toBeNull();
  expect(await memberDrawStatus(f.viewers[1], next.id)).toMatchObject({status: "ready", exchange: {version: 1}});
  expect(await checkSealedDraw(f.organizer, next.id)).toMatchObject({valid: true, rosterMatches: true, count: 6});
});

it.each(["en", "es"] as const)("renders localized recovery on member and sealed-check pages in %s", async (locale) => {
  const f = await fixture({count: 4, active: 4});
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(cycle(f.ids));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, f.ids[1], {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const owner = {...f.viewers[1], sessionId: session.id};
  signedIn.viewer = owner;
  signedIn.locale = locale;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(repair, "repairDraw").mockImplementation(() => { throw new DrawError("checkTimedOut"); });
  await expect(reportSession(f.viewers[1].sessionId)).resolves.toEqual({error: "repairRequired"});
  const messages = locale === "es" ? (await import("../../messages/es.json")).default
    : (await import("../../messages/en.json")).default;
  const params = Promise.resolve({exchangeId: f.exchangeId});
  const memberHtml = renderToStaticMarkup(await renderServerTree(await MemberExchangePage({params})));
  expect(memberHtml).toContain(messages.draw.errors.checkTimedOut);
  expect(memberHtml).toContain('role="alert"');
  expect(memberHtml).toContain('href="/account"');
  signedIn.viewer = f.organizer;
  const manageHtml = renderToStaticMarkup(await renderServerTree(await ManagePage({params, searchParams: Promise.resolve({check: "1"})})));
  expect(manageHtml).toContain(messages.draw.errors.checkTimedOut);
  expect(manageHtml).toContain('href="/account"');
  expect(manageHtml).toContain(`href="/exchanges/${f.exchangeId}/manage"`);
  expect(manageHtml).toContain('name="confirmation"');
  await expect(revealMyPerson(owner, f.exchangeId, 1)).rejects.toMatchObject({code: "checkTimedOut"});
  await expect(listOwnQuestions(owner, f.exchangeId)).rejects.toMatchObject({code: "checkTimedOut"});
});

it.each([false, true])("records match reads on another session and repairs their disclosure (helper: %s)", async (helpers) => {
  const f = await fixture({helpers});
  if (helpers) await admin.db.update(people).set({helperId: f.ids[3]}).where(and(
    eq(people.familyId, f.familyId), eq(people.id, f.ids[1]),
  ));
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  const owner = helpers ? {...f.viewers[3], actingAs: f.ids[1]} : f.viewers[1];
  if (helpers) await runForFamily(app.db, f.familyId, (tx) => actFor(tx, f.viewers[3], f.ids[1]));
  const session = await runForFamily(app.db, f.familyId, (tx) => signInDevice(
    tx, f.familyId, owner.personId, {hash: digest(secret()), kind: "ipad", network: null}, new Date(),
  ));
  const otherOwner = {...owner, sessionId: session.id, actingAs: owner.personId};
  if (helpers) await runForFamily(app.db, f.familyId, (tx) => actFor(tx, otherOwner, f.ids[1]));
  const other = {...otherOwner, actingAs: owner.actingAs};
  expect(await myPerson(other, f.exchangeId)).toEqual({recipientId: null, version: 1});
  expect(await ownRevealOpenings(owner, f.exchangeId)).toEqual([]);
  const opened = await revealMyPerson(owner, f.exchangeId, 1);
  expect(await myPerson(other, f.exchangeId)).toEqual({recipientId: opened.person.id, version: 1});
  const evidence = await ownRevealOpenings(owner, f.exchangeId);
  expect(evidence).toEqual([expect.objectContaining({sessionId: other.sessionId, openedAt: expect.any(Date)})]);
  await myPerson(other, f.exchangeId);
  await revealMyPerson(other, f.exchangeId, 1);
  expect(await ownRevealOpenings(owner, f.exchangeId)).toEqual(evidence);
  expect(await runForFamily(app.db, f.familyId, (tx) => disputeSession(tx, owner, other.sessionId, new Date())))
    .toBe(true);
  await repairDisputedReveals(owner);
  expect(await memberDrawStatus(owner, f.exchangeId)).toMatchObject({seen: false, exchange: {version: 2}});
  expect((await revealMyPerson(owner, f.exchangeId, 2)).person.id).not.toBe(opened.person.id);
});

it.each(["setup", "open", "drawn", "locked"] as const)("notifies plan and budget edits in %s exchanges", async (status) => {
  const f = await fixture();
  if (status === "setup") await admin.db.update(exchanges).set({status}).where(eq(exchanges.id, f.exchangeId));
  if (status === "drawn" || status === "locked") await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  if (status === "locked") await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  const recipients = f.ids.slice(0, 6).sort();
  let edited = {...details};
  await editExchange(f.organizer, f.exchangeId, {...edited, giftTime: "18:30:00"});
  expect(await drawNoticeIds(f.familyId, "exchange-details-changed")).toEqual([]);
  for (const patch of [
    {giftDay: "2023-01-07"}, {giftTime: "19:00"}, {place: "Winter Hall"}, {listDeadline: "2022-12-29"},
  ]) {
    edited = {...edited, ...patch};
    await editExchange(f.organizer, f.exchangeId, edited);
    expect(await drawNoticeIds(f.familyId, "exchange-details-changed")).toEqual(recipients);
    await admin.db.delete(outbox).where(and(eq(outbox.familyId, f.familyId), eq(outbox.template, "exchange-details-changed")));
  }
  expect(await drawNoticeIds(f.familyId, "plans-changed")).toEqual([]);
  if (status === "setup") await admin.db.update(exchanges).set({status}).where(eq(exchanges.id, f.exchangeId));
  await editExchange(f.organizer, f.exchangeId, {...edited, budgetAmount: "30"});
  expect(await drawNoticeIds(f.familyId, "budget-changed")).toEqual(recipients);
  await admin.db.delete(outbox).where(and(eq(outbox.familyId, f.familyId), eq(outbox.template, "budget-changed")));
  if (status === "setup") await admin.db.update(exchanges).set({status}).where(eq(exchanges.id, f.exchangeId));
  await setExchangeBudget(f.organizer, f.exchangeId, "40");
  expect(await drawNoticeIds(f.familyId, "budget-changed")).toEqual(recipients);
  await setExchangeBudget(f.organizer, f.exchangeId, "40.00");
  expect(await drawNoticeIds(f.familyId, "budget-changed")).toEqual(recipients);
});

it("rolls back plan edits when their notice cannot be queued", async () => {
  const f = await fixture();
  const failing: DrawEvents = {async publish() { throw new Error("Queue unavailable"); }};
  await expect(editExchange(f.organizer, f.exchangeId, {...details, place: "Another hall"}, failing))
    .rejects.toThrow("Queue unavailable");
  expect((await organizerExchange(f.organizer, f.exchangeId)).exchange.place).toBe(details.place);
  expect(await drawNoticeIds(f.familyId, "exchange-details-changed")).toEqual([]);
});

it("keeps failed claimer notices generic in list actions", async () => {
  const f = await fixture();
  const owner = f.viewers[1];
  const item = await addListItem(owner, owner.personId, {kind: "note", title: "Winter puzzle"});
  await claimItem(f.viewers[2], item.id);
  signedIn.viewer = owner;
  vi.spyOn(listEvents, "claimedItemChanged").mockRejectedValue(new Error("Private queue failure details"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const form = new FormData();
  form.set("title", "Changed puzzle");
  expect(await saveItem(owner.personId, item.id, "note", false, {}, form)).toEqual({error: "could-not-save"});
  expect(await itemCommand(owner.personId, item.id, "delete")).toEqual({error: "could-not-save"});
  expect((await getWishlist(owner, owner.personId)).items).toEqual([item]);
  expect(await drawNoticeIds(f.familyId, "claimed-item-changed")).toEqual([]);
});

it("notifies retained and departing participants accurately after a full redraw", async () => {
  const f = await fixture();
  const previous = cycle(f.ids.slice(0, 6));
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(previous);
  await runDraw(f.organizer, f.exchangeId, {expectedVersion: 0});
  await revealMyPerson(f.viewers[1], f.exchangeId, 1);
  const next = new Map(previous).set(f.ids[0], f.ids[2]);
  next.delete(f.ids[1]);
  vi.spyOn(solver, "solveDraw").mockReturnValueOnce(next);
  await runDraw(f.organizer, f.exchangeId, {
    expectedVersion: 1, confirmation: "REDRAW", selection: f.ids.slice(0, 6).filter((id) => id !== f.ids[1]),
  });
  expect(await drawNoticeIds(f.familyId, "draw-redrawn")).toEqual([...next.keys()].sort());
  expect(await drawNoticeIds(f.familyId, "participation-cancelled")).toEqual([f.ids[1]]);
  expect(await drawNoticeIds(f.familyId, "plans-changed")).toEqual([]);
  expect(await checkSealedDraw(f.organizer, f.exchangeId)).toMatchObject({valid: true, count: 5});
  expect((await revealMyPerson(f.viewers[2], f.exchangeId, 2)).person.id).toBe(previous.get(f.ids[2]));
});

it("keeps access denials and unexpected failures out of recoverable draw states", async () => {
  await expect(drawPage(Promise.reject(new DrawError("forbidden")))).rejects.toThrow("notFound");
  await expect(drawPage(Promise.reject(new DrawError("notFound")))).rejects.toThrow("notFound");
  const error = new Error("Unexpected failure");
  await expect(drawPage(Promise.reject(error))).rejects.toBe(error);
});
