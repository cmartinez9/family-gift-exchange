import {randomBytes, randomUUID} from "node:crypto";
import {and, eq, sql} from "drizzle-orm";
import {afterAll, beforeAll, expect, it, vi} from "vitest";
import {connectDatabase, runForFamily} from "../../src/server/db/database";
import {families, people} from "../../src/server/db/schema";
import {
  createExchange, DrawError, repairDisputedReveals, listOwnQuestions, memberDrawStatus, revealMyPerson, runDraw, setParticipants, type DrawViewer,
} from "../../src/server/draw";
import {issueKey, lendSeconds, redeemKey, signInDevice, signInWithPin, type Device} from "../../src/server/auth/access";
import {peopleOnDevice} from "../../src/server/auth/account";
import {hideBorrowedPerson, phoneOwnerName, returnBorrowedPhone} from "../../src/server/auth/borrowed";
import {pinCredentials, sessions} from "../../src/server/auth/schema";
import {disputeSession, endSessions, listSessionDisputes} from "../../src/server/auth/security";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {addListItem, getWishlist} from "../../src/server/lists";
import {claimItem, getGettingList} from "../../src/server/lists/claims";
import {requireIssuedKey} from "../helpers/issued-key";

// The phone's cookies, as getViewer reads them.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({get: (name: string) => (jar.has(name) ? {name, value: jar.get(name)} : undefined)}),
}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));
vi.mock("next/navigation", () => ({redirect: (url: string) => { throw new Error(`redirect:${url}`); }}));

const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("The borrowed-phone integration tests need a disposable Postgres database");
const admin = connectDatabase(databaseUrl);
const suffix = randomBytes(6).toString("hex");
const appRole = `borrow_test_app_${suffix}`;
const drawRole = `borrow_test_sealed_${suffix}`;
const password = randomBytes(24).toString("hex");
const testFamilies = new Set<string>();

function login(name: string) {
  const url = new URL(databaseUrl!);
  url.username = name;
  url.password = password;
  return url.toString();
}

// Real request roles, so the draw role's column grants are exercised too.
const app = connectDatabase(login(appRole));
const pepper = secret();
const pin = "4268";
const phone = (): Device => ({hash: digest(secret()), kind: "iphone", network: null});

beforeAll(async () => {
  for (const [name, role] of [[appRole, "fge_app"], [drawRole, "fge_draw"]]) {
    await admin.db.execute(sql`CREATE ROLE ${sql.identifier(name)} LOGIN NOINHERIT PASSWORD ${sql.raw(`'${password}'`)}`);
    await admin.db.execute(sql`GRANT ${sql.identifier(role)} TO ${sql.identifier(name)}`);
  }
  vi.stubEnv("DATABASE_URL", login(appRole));
  vi.stubEnv("DRAW_DATABASE_URL", login(drawRole));
  vi.stubEnv("ASSIGNMENT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
});

afterAll(async () => {
  for (const familyId of testFamilies) await admin.db.delete(families).where(eq(families.id, familyId));
  await app.close();
  await admin.db.execute(sql`DROP ROLE IF EXISTS ${sql.identifier(appRole)}, ${sql.identifier(drawRole)}`);
  await admin.close();
  vi.unstubAllEnvs();
});

const tx = <T>(familyId: string, action: Parameters<typeof runForFamily<T>>[2]) => runForFamily(app.db, familyId, action);
const resolve = (cookie: string) => {
  const parsed = parseSession(cookie)!;
  return tx(parsed.familyId, (t) => findViewer(t, parsed));
};

/**
 * Christian organizes; Ana's phone is signed in as Ana; Rosa has no phone, only her first key; Beto and
 * Leo have keys too. Everyone is in a drawn exchange.
 */
async function fixture({draw = true} = {}) {
  const familyId = randomUUID();
  testFamilies.add(familyId);
  const names = ["Christian", "Ana", "Rosa", "Beto", "Leo"] as const;
  const ids = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<(typeof names)[number], string>;
  await tx(familyId, async (t) => {
    await t.insert(families).values({id: familyId, name: "Martinez"});
    await t.insert(people).values(names.map((name) => ({
      familyId, id: ids[name], displayName: name, role: name === "Christian" ? "organizer" as const : "member" as const,
    })));
  });
  const anaPhone = phone();
  const [christianSession, anaSession] = await tx(familyId, async (t) => [
    await signInDevice(t, familyId, ids.Christian, phone(), new Date()),
    await signInDevice(t, familyId, ids.Ana, anaPhone, new Date()),
  ]);
  const organizer = (await resolve(christianSession.cookie))!;
  const ana = (await resolve(anaSession.cookie))!;
  const key = async (name: (typeof names)[number], kind: "share" | "reset" = "share") =>
    requireIssuedKey(await tx(familyId, (t) => issueKey(t, organizer, ids[name], kind, pepper, new Date()))).token!;
  const lend = (token: string, owner: DrawViewer | null, device = anaPhone, lending = true) =>
    tx(familyId, (t) => redeemKey(t, {
      familyId, value: token, typed: false, pin, confirmation: pin, pepper, device, currentViewer: owner, now: new Date(),
      lend: lending,
    }));
  let exchangeId = "";
  if (draw) {
    ({id: exchangeId} = await createExchange(organizer, {
      name: "Christmas", giftDay: "2026-12-24", giftTime: "19:00", place: "Ana's", budgetAmount: "50",
      listDeadline: "2026-12-10", drawDay: "2026-12-01",
    }));
    await setParticipants(organizer, exchangeId, Object.values(ids));
    await runDraw(organizer, exchangeId, {expectedVersion: 0});
  }
  return {familyId, ids, organizer, ana, anaSession, anaPhone, key, lend, exchangeId};
}

async function refused(action: Promise<unknown>) {
  const error = await action.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(DrawError);
  return (error as DrawError).code;
}

it("signs a relative in beside the phone's owner, only on that phone and only with a first link key", async () => {
  const f = await fixture({draw: false});
  const rosaKey = await f.key("Rosa");
  // as before: a signed-in phone refuses someone else's key unless the owner hands it over
  await expect(f.lend(rosaKey, f.ana, f.anaPhone, false)).resolves.toEqual({error: "otherPerson"});
  // the owner's session must be on this very phone
  await expect(f.lend(rosaKey, f.ana, phone())).resolves.toEqual({error: "otherPerson"});
  await expect(f.lend(rosaKey, null)).resolves.toEqual({error: "otherPerson"});

  const now = Date.now();
  const lent = await f.lend(rosaKey, f.ana);
  expect(lent.session).toBeDefined();
  const rosa = (await resolve(lent.session!.cookie))!;
  expect(rosa).toMatchObject({personId: f.ids.Rosa, actingAs: f.ids.Rosa, borrowed: {lenderSessionId: f.ana.sessionId, hidden: false}});
  // the owner stays signed in, untouched
  expect(await resolve(f.anaSession.cookie)).toEqual(f.ana);
  expect(f.ana.borrowed).toBeUndefined();

  const [row] = await tx(f.familyId, (t) => t.select().from(sessions).where(and(eq(sessions.familyId, f.familyId), eq(sessions.id, rosa.sessionId))));
  expect(row).toMatchObject({personId: f.ids.Rosa, deviceHash: f.anaPhone.hash, trusted: false, lentBySessionId: f.ana.sessionId, personHiddenAt: null});
  expect(row.expiresAt.getTime() - now).toBeGreaterThan((lendSeconds - 60) * 1000);
  expect(row.expiresAt.getTime() - now).toBeLessThanOrEqual(lendSeconds * 1000 + 5000);
  // Ana's phone does not remember Rosa on its sign-in screen
  expect(await tx(f.familyId, (t) => peopleOnDevice(t, f.familyId, f.anaPhone.hash))).toEqual([f.ids.Ana]);
  expect(await tx(f.familyId, (t) => phoneOwnerName(t, rosa))).toBe("Ana");
  expect(await tx(f.familyId, (t) => phoneOwnerName(t, f.ana))).toBeNull();

  // the key is spent, a borrowed session cannot lend the phone on, and a replacement key is never lent
  await expect(f.lend(rosaKey, f.ana)).resolves.toEqual({error: "usedKey"});
  await expect(f.lend(await f.key("Beto"), rosa)).resolves.toEqual({error: "otherPerson"});
  await expect(f.lend(await f.key("Rosa", "reset"), f.ana)).resolves.toEqual({error: "otherPerson"});
});

it("keeps a borrowed session inside its owner's, and hands the phone back on sign-out", async () => {
  const f = await fixture({draw: false});
  const rosaCookie = (await f.lend(await f.key("Rosa"), f.ana)).session!.cookie;
  const rosa = (await resolve(rosaCookie))!;
  const {getViewer} = await import("../../src/server/auth");

  jar.clear();
  jar.set("__Host-fge-session", f.anaSession.cookie);
  jar.set("__Host-fge-borrowed", rosaCookie);
  expect(await getViewer()).toEqual(rosa);
  // a borrowed session is never the phone's owner, and only rides beside the owner it was lent by
  jar.set("__Host-fge-session", rosaCookie);
  expect(await getViewer()).toBeNull();
  const christian = await tx(f.familyId, (t) => signInDevice(t, f.familyId, f.ids.Christian, phone(), new Date()));
  jar.set("__Host-fge-session", christian.cookie);
  expect((await getViewer())?.personId).toBe(f.ids.Christian);

  // handing back ends only the borrowed session; the phone is Ana's again without signing in
  jar.set("__Host-fge-session", f.anaSession.cookie);
  await tx(f.familyId, (t) => returnBorrowedPhone(t, f.ana, new Date()));
  expect(await resolve(rosaCookie)).toEqual(rosa);
  await tx(f.familyId, (t) => returnBorrowedPhone(t, rosa, new Date()));
  expect(await resolve(rosaCookie)).toBeNull();
  expect(await getViewer()).toEqual(f.ana);

  // a borrowed session also lapses on its own, and whenever the owner's session ends
  const second = await fixture({draw: false});
  const leoCookie = (await second.lend(await second.key("Leo"), second.ana)).session!.cookie;
  const leo = (await resolve(leoCookie))!;
  await tx(second.familyId, (t) => t.update(sessions).set({expiresAt: new Date(Date.now() - 1000)})
    .where(and(eq(sessions.familyId, second.familyId), eq(sessions.id, leo.sessionId))));
  expect(await resolve(leoCookie)).toBeNull();
  await expect(tx(second.familyId, (t) => hideBorrowedPerson(t, leo, new Date()))).resolves.toBe(true);
  const betoCookie = (await second.lend(await second.key("Beto"), second.ana)).session!.cookie;
  expect((await resolve(betoCookie))?.personId).toBe(second.ids.Beto);
  await tx(second.familyId, (t) => endSessions(t, second.ana, new Date(), false));
  expect(await resolve(betoCookie)).toBeNull();
  jar.clear();
});

it("lets the relative open only their own person, and nobody once it is hidden", async () => {
  const f = await fixture();
  const rosaCookie = (await f.lend(await f.key("Rosa"), f.ana)).session!.cookie;
  const rosa = (await resolve(rosaCookie))!;

  // the phone's owner never reaches Rosa's person, borrowed phone or not
  expect(await refused(revealMyPerson({...f.ana, actingAs: f.ids.Rosa}, f.exchangeId, 1))).toBe("forbidden");
  const opened = await revealMyPerson(rosa, f.exchangeId, 1);
  expect(opened.person.id).not.toBe(f.ids.Rosa);
  await expect(memberDrawStatus(rosa, f.exchangeId)).resolves.toMatchObject({status: "ready", seen: true});

  // "Hide Beto": from now on this session cannot see the person, or ask them anything
  await expect(tx(f.familyId, (t) => hideBorrowedPerson(t, f.ana, new Date()))).resolves.toBe(false);
  await expect(tx(f.familyId, (t) => hideBorrowedPerson(t, rosa, new Date()))).resolves.toBe(true);
  expect((await resolve(rosaCookie))?.borrowed).toEqual({lenderSessionId: f.ana.sessionId, lenderPersonId: f.ids.Ana, hidden: true});
  expect(await refused(revealMyPerson(rosa, f.exchangeId, 1))).toBe("forbidden");
  expect(await refused(memberDrawStatus(rosa, f.exchangeId))).toBe("forbidden");
  expect(await refused(listOwnQuestions(rosa, f.exchangeId))).toBe("forbidden");
  await expect(tx(f.familyId, (t) => hideBorrowedPerson(t, rosa, new Date()))).resolves.toBe(true);

  // Ana's own person and Rosa's own phone later are untouched
  await expect(revealMyPerson(f.ana, f.exchangeId, 1)).resolves.toMatchObject({version: 1});
  const own = await tx(f.familyId, (t) => signInDevice(t, f.familyId, f.ids.Rosa, phone(), new Date()));
  const rosaOwnPhone = (await resolve(own.cookie))!;
  await expect(revealMyPerson(rosaOwnPhone, f.exchangeId, 1)).resolves.toMatchObject({person: opened.person});
});


it("keeps a no-draw hand-back sealed when the organizer draws later", async () => {
  const f = await fixture({draw: false});
  const cookie = (await f.lend(await f.key("Rosa"), f.ana)).session!.cookie;
  const rosa = (await resolve(cookie))!;
  await expect(tx(f.familyId, (t) => hideBorrowedPerson(t, rosa, new Date()))).resolves.toBe(true);
  const exchange = await createExchange(f.organizer, {
    name: "Christmas", giftDay: "2026-12-24", giftTime: "19:00", place: "Ana's", budgetAmount: "50",
    listDeadline: "2026-12-10", drawDay: "2026-12-01",
  });
  await setParticipants(f.organizer, exchange.id, Object.values(f.ids));
  await runDraw(f.organizer, exchange.id, {expectedVersion: 0});
  expect(await refused(revealMyPerson(rosa, exchange.id, 1))).toBe("forbidden");
  expect(await refused(memberDrawStatus((await resolve(cookie))!, exchange.id))).toBe("forbidden");
});

it("includes borrowed children when disputing a compromised lender", async () => {
  const f = await fixture();
  const key = await f.key("Rosa");
  const stolenPhone = phone();
  const stolenSession = await tx(f.familyId, (t) => signInDevice(t, f.familyId, f.ids.Ana, stolenPhone, new Date()));
  const stolen = (await resolve(stolenSession.cookie))!;
  const rosaCookie = (await f.lend(key, stolen, stolenPhone)).session!.cookie;
  const rosa = (await resolve(rosaCookie))!;
  const exposed = await revealMyPerson(rosa, f.exchangeId, 1);
  await expect(tx(f.familyId, (t) => disputeSession(t, f.ana, stolen.sessionId, new Date()))).resolves.toBe(true);
  expect(await resolve(rosaCookie)).toBeNull();
  expect(await resolve(f.anaSession.cookie)).toEqual(f.ana);
  expect(await tx(f.familyId, (t) => listSessionDisputes(t, f.familyId, f.ids.Rosa)))
    .toEqual([{sessionId: rosa.sessionId, at: expect.any(Date)}]);
  const [credential] = await tx(f.familyId, (t) => t.select().from(pinCredentials)
    .where(and(eq(pinCredentials.familyId, f.familyId), eq(pinCredentials.personId, f.ids.Rosa))));
  expect(credential.newDevicesLocked).toBe(true);
  await expect(tx(f.familyId, (t) => signInWithPin(t, f.familyId, f.ids.Rosa, pin, pepper, phone(), new Date())))
    .resolves.toEqual({error: "newDevicesLocked"});
  await repairDisputedReveals(f.ana);
  const own = await tx(f.familyId, (t) => signInDevice(t, f.familyId, f.ids.Rosa, phone(), new Date()));
  const rosaOwnPhone = (await resolve(own.cookie))!;
  expect(await memberDrawStatus(rosaOwnPhone, f.exchangeId)).toMatchObject({exchange: {version: 2}, seen: false});
  expect((await revealMyPerson(rosaOwnPhone, f.exchangeId, 2)).person.id).not.toBe(exposed.person.id);
});

it("hides claims on both the borrower's and lender's lists after hand-back", async () => {
  const f = await fixture({draw: false});
  const cookie = (await f.lend(await f.key("Rosa"), f.ana)).session!.cookie;
  const rosa = (await resolve(cookie))!;
  const betoSession = await tx(f.familyId, (t) => signInDevice(t, f.familyId, f.ids.Beto, phone(), new Date()));
  const beto = (await resolve(betoSession.cookie))!;
  const anaItem = await addListItem(f.ana, f.ids.Ana, {kind: "note", title: "Ana's gift"});
  const rosaItem = await addListItem(rosa, f.ids.Rosa, {kind: "note", title: "Rosa's gift"});
  const betoItem = await addListItem(beto, f.ids.Beto, {kind: "note", title: "Beto's gift"});
  await claimItem(f.organizer, anaItem.id);
  await claimItem(f.organizer, rosaItem.id);
  await claimItem(f.organizer, betoItem.id);
  await tx(f.familyId, (t) => hideBorrowedPerson(t, rosa, new Date()));
  const withoutMetadata = {familyId: rosa.familyId, personId: rosa.personId, actingAs: rosa.actingAs, sessionId: rosa.sessionId};
  for (const owner of [f.ids.Ana, f.ids.Rosa]) {
    const list = await getWishlist(withoutMetadata, owner);
    expect(list.canClaim).toBe(false);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).not.toHaveProperty("claim");
  }
  expect((await getWishlist(withoutMetadata, f.ids.Beto)).items[0].claim).toBe("someone");
  await expect(claimItem(withoutMetadata, anaItem.id)).rejects.toMatchObject({code: "forbidden"});
  await expect(getGettingList(withoutMetadata)).resolves.toEqual([]);
});


it("refuses replacing a hidden borrowed session with the same person's reset key", async () => {
  const f = await fixture();
  const cookie = (await f.lend(await f.key("Rosa"), f.ana)).session!.cookie;
  const rosa = (await resolve(cookie))!;
  await revealMyPerson(rosa, f.exchangeId, 1);
  await tx(f.familyId, (t) => hideBorrowedPerson(t, rosa, new Date()));
  const reset = await f.key("Rosa", "reset");
  await expect(f.lend(reset, (await resolve(cookie))!, f.anaPhone, false)).resolves.toEqual({error: "otherPerson"});
  expect((await resolve(cookie))?.borrowed?.hidden).toBe(true);
  expect(await resolve(f.anaSession.cookie)).toEqual(f.ana);
  expect(await refused(revealMyPerson(rosa, f.exchangeId, 1))).toBe("forbidden");
  const rows = await tx(f.familyId, (t) => t.select().from(sessions)
    .where(and(eq(sessions.familyId, f.familyId), eq(sessions.personId, f.ids.Rosa))));
  expect(rows).toHaveLength(1);
  expect(rows[0].trusted).toBe(false);
  expect((await f.lend(reset, null, phone(), false)).session).toBeDefined();
});

it("returns expired borrowed onboarding to the owner's Home without losing the owner", async () => {
  const f = await fixture({draw: false});
  const cookie = (await f.lend(await f.key("Rosa"), f.ana)).session!.cookie;
  const rosa = (await resolve(cookie))!;
  await tx(f.familyId, (t) => hideBorrowedPerson(t, rosa, new Date()));
  await tx(f.familyId, (t) => t.update(sessions).set({expiresAt: new Date(Date.now() - 1000)})
    .where(and(eq(sessions.familyId, f.familyId), eq(sessions.id, rosa.sessionId))));
  jar.clear();
  jar.set("__Host-fge-session", f.anaSession.cookie);
  jar.set("__Host-fge-borrowed", cookie);
  try {
    const {getViewer} = await import("../../src/server/auth");
    const {requireWelcomeViewer} = await import("../../src/app/[locale]/welcome/viewer");
    expect(await getViewer()).toEqual(f.ana);
    await expect(requireWelcomeViewer()).rejects.toThrow(/^redirect:\/en\/welcome\/borrowed\/expired$/);
    expect(await resolve(f.anaSession.cookie)).toEqual(f.ana);
  } finally {
    jar.clear();
  }
});
