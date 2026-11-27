import {createECDH, randomBytes, randomUUID} from "node:crypto";
import {and, eq, sql} from "drizzle-orm";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {signInDevice} from "../../src/server/auth/access";
import {actFor} from "../../src/server/auth/security";
import {pinCredentials} from "../../src/server/auth/schema";
import {digest, secret} from "../../src/server/auth/session";
import {withFamily} from "../../src/server/db/client";
import {exchanges, families, items, outbox, participants, people} from "../../src/server/db/schema";
import {deliverPendingPushForFamily} from "../../src/server/messages/delivery";
import {listNotifications} from "../../src/server/messages/inbox";
import {noteEmptyListViewed, nudgedToday, nudgeKey, nudgeList, queueViewedNudges} from "../../src/server/messages/nudges";
import type {PushSender} from "../../src/server/messages/push";
import {listNudges} from "../../src/server/messages/schema";
import {subscribePush} from "../../src/server/messages/subscriptions";

vi.mock("server-only", () => ({}));

// 10:00 in Chicago on Dec 10; the next exchange day starts at 06:00 UTC on Dec 11.
const now = new Date("2032-12-10T16:00:00Z");
const later = new Date("2032-12-11T02:00:00Z");
const nextDay = new Date("2032-12-11T16:00:00Z");
const familyId = randomUUID();
const otherFamilyId = randomUUID();
const exchangeId = randomUUID();
const otherExchangeId = randomUUID();

const ids = {
  organizer: randomUUID(), giver: randomUUID(), empty: randomUUID(), started: randomUUID(),
  helper: randomUUID(), lookedAfter: randomUUID(), notJoined: randomUUID(), out: randomUUID(), outsider: randomUUID(),
};
const names = {
  organizer: "Hollyhock", giver: "Tinselby", empty: "Brambly", started: "Quillfern",
  helper: "Mossling", lookedAfter: "Pipwick", notJoined: "Larkspur", out: "Driftmere", outsider: "Fennbury",
};

type TestViewer = {familyId: string; personId: string; actingAs: string; sessionId: string; isOrganizer: boolean};
const viewers: Record<string, TestViewer> = {};

function browserSubscription() {
  const ecdh = createECDH("prime256v1");
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${randomUUID()}`,
    keys: {p256dh: ecdh.generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url")},
  };
}

async function signIn(personId: string, actingAs = personId, tenant = familyId) {
  return withFamily(tenant, async (tx) => {
    const session = await signInDevice(tx, tenant, personId, {hash: digest(secret()), kind: "iphone", network: null}, new Date());
    const viewer = {familyId: tenant, personId, actingAs: personId, sessionId: session.id, isOrganizer: personId === ids.organizer};
    if (actingAs !== personId) await actFor(tx, viewer, actingAs);
    return {...viewer, actingAs};
  });
}

const nudges = () => withFamily(familyId, (tx) => tx.select().from(listNudges));
const notices = () => withFamily(familyId, (tx) => tx.select().from(outbox).where(eq(outbox.template, "list-nudge")));

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", undefined);
  await withFamily(familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "Nudge test"});
    await tx.insert(people).values([
      {id: ids.organizer, displayName: names.organizer, role: "organizer" as const},
      {id: ids.giver, displayName: names.giver},
      {id: ids.empty, displayName: names.empty, language: "es" as const},
      {id: ids.started, displayName: names.started},
      {id: ids.helper, displayName: names.helper},
      {id: ids.notJoined, displayName: names.notJoined},
      {id: ids.out, displayName: names.out},
    ].map((person) => ({...person, familyId})));
    await tx.insert(people).values({familyId, id: ids.lookedAfter, displayName: names.lookedAfter, helperId: ids.helper});
    await tx.insert(pinCredentials).values([ids.organizer, ids.giver, ids.empty, ids.started, ids.helper, ids.out]
      .map((personId) => ({familyId, personId})));
    await tx.insert(exchanges).values({familyId, id: exchangeId, name: "Winter", status: "locked", drawVersion: 1});
    await tx.insert(participants).values(Object.entries(ids).filter(([key]) => key !== "outsider").map(([key, personId]) => ({
      familyId, exchangeId, personId, status: key === "out" ? "out" as const : "in" as const,
    })));
    await tx.insert(items).values({familyId, ownerId: ids.started, kind: "note", title: "Wool socks"});
  });
  await withFamily(otherFamilyId, async (tx) => {
    await tx.insert(families).values({id: otherFamilyId, name: "Other nudge test"});
    await tx.insert(people).values({familyId: otherFamilyId, id: ids.outsider, displayName: names.outsider});
    await tx.insert(exchanges).values({familyId: otherFamilyId, id: otherExchangeId, name: "Other"});
  });
  for (const key of ["organizer", "giver", "empty", "helper"] as const) viewers[key] = await signIn(ids[key]);
  viewers.helping = await signIn(ids.helper, ids.lookedAfter);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of [familyId, otherFamilyId]) {
    await withFamily(id, (tx) => tx.delete(families).where(eq(families.id, id)));
  }
});

it("lets an organizer nudge someone with an empty list once a day, in their language", async () => {
  expect(await nudgeList(viewers.organizer, exchangeId, ids.empty, now)).toBe("sent");
  expect(await nudgeList(viewers.organizer, exchangeId, ids.empty, later)).toBe("already");
  expect(await nudgedToday(viewers.organizer, exchangeId, later)).toEqual([ids.empty]);

  expect(await notices()).toMatchObject([{
    personId: ids.empty, language: "es", status: "captured", requesterName: null, dedupeKey: nudgeKey(exchangeId, "2032-12-10"),
  }]);
  const [inbox] = await listNotifications(viewers.empty);
  expect(inbox).toMatchObject({title: "Tu lista de deseos te espera", isRead: false});
  for (const name of Object.values(names)) expect(`${inbox.title} ${inbox.body}`).not.toContain(name);

  expect(await nudgedToday(viewers.organizer, exchangeId, nextDay)).toEqual([]);
  expect(await nudgeList(viewers.organizer, exchangeId, ids.empty, nextDay)).toBe("sent");
  expect(await notices()).toHaveLength(2);
  // yesterday's button state is cleared once a new day's nudge is pressed
  expect((await nudges()).map(({day}) => day)).toEqual(["2032-12-11"]);
});

it("nudges only people who can get it and only for organizers acting as themselves", async () => {
  expect(await nudgeList(viewers.giver, exchangeId, ids.empty, now)).toBe("forbidden");
  const organizerHelping = await signIn(ids.organizer);
  await withFamily(familyId, (tx) => tx.update(people).set({helperId: ids.organizer}).where(eq(people.id, ids.notJoined)));
  const asOther = await withFamily(familyId, async (tx) => {
    await actFor(tx, organizerHelping, ids.notJoined);
    return {...organizerHelping, actingAs: ids.notJoined};
  });
  expect(await nudgeList(asOther, exchangeId, ids.empty, now)).toBe("forbidden");
  await withFamily(familyId, (tx) => tx.update(people).set({helperId: null}).where(eq(people.id, ids.notJoined)));

  for (const personId of [ids.organizer, ids.started, ids.notJoined, ids.out, ids.outsider, "not-a-person"]) {
    expect(await nudgeList(viewers.organizer, exchangeId, personId, now)).toBe("unavailable");
  }
  expect(await nudgeList(viewers.organizer, otherExchangeId, ids.empty, now)).toBe("unavailable");
  expect(await nudgeList({...viewers.organizer, familyId: otherFamilyId}, otherExchangeId, ids.outsider, now)).toBe("forbidden");

  await withFamily(familyId, (tx) => tx.update(exchanges).set({status: "closed"}).where(eq(exchanges.id, exchangeId)));
  expect(await nudgeList(viewers.organizer, exchangeId, ids.empty, now)).toBe("unavailable");
  expect(await notices()).toEqual([]);
  expect(await nudgedToday(viewers.giver, exchangeId, now)).toEqual([]);
});

it("reaches a looked-after person through their helper's phone without the details", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  await subscribePush(viewers.helper, browserSubscription());
  expect(await nudgeList(viewers.organizer, exchangeId, ids.lookedAfter, now)).toBe("sent");
  const sender = vi.fn<PushSender>().mockResolvedValue("sent");
  await deliverPendingPushForFamily(familyId, sender);

  expect(sender).toHaveBeenCalledTimes(1);
  expect(sender.mock.calls[0][1]).toMatchObject({title: "Family Gift Exchange", body: "You have a new notification."});
  const [inbox] = await listNotifications(viewers.helping);
  expect(inbox).toMatchObject({title: "Your wishlist is waiting"});
  expect(await notices()).toMatchObject([{personId: ids.lookedAfter, status: "sent"}]);
});

it("turns a giver's visit to an empty list into the same nudge, sent later by the daily job", async () => {
  expect(await noteEmptyListViewed(viewers.giver, exchangeId, ids.empty, now)).toBe(true);
  expect(await noteEmptyListViewed(viewers.giver, exchangeId, ids.empty, later)).toBe(true);
  expect(await noteEmptyListViewed(viewers.giver, exchangeId, ids.started, now)).toBe(false);
  expect(await noteEmptyListViewed(viewers.giver, exchangeId, ids.notJoined, now)).toBe(false);
  // a helper is not nudged on their own phone for someone they look after
  expect(await noteEmptyListViewed(viewers.helper, exchangeId, ids.lookedAfter, now)).toBe(false);
  expect(await noteEmptyListViewed(viewers.giver, exchangeId, "not-a-person", now)).toBe(false);

  const waiting = await nudges();
  expect(waiting).toEqual([{familyId, exchangeId, personId: ids.empty, kind: "viewed", day: "2032-12-10"}]);
  expect(await notices()).toEqual([]);
  // the organizer's board never shows a nudge that came from a giver
  expect(await nudgedToday(viewers.organizer, exchangeId, now)).toEqual([]);

  const scoped = await withFamily(familyId, (tx) => tx.execute(sql`SELECT * FROM public.fge_nudge_work()`));
  expect(scoped.rows).toEqual([]);

  await queueViewedNudges(later);
  const sent = await notices();
  expect(sent).toMatchObject([{personId: ids.empty, language: "es", dedupeKey: nudgeKey(exchangeId, "2032-12-10")}]);
  expect(await nudges()).toEqual([]);

  // the organizer's nudge the same day is accepted, but the person still gets one notice
  expect(await nudgeList(viewers.organizer, exchangeId, ids.empty, later)).toBe("sent");
  expect(await notices()).toHaveLength(1);

  // the next day's nudge, from the organizer, reads exactly like the one from the visit
  expect(await nudgeList(viewers.organizer, exchangeId, ids.empty, nextDay)).toBe("sent");
  const inbox = await listNotifications(viewers.empty);
  expect(inbox).toHaveLength(2);
  expect(new Set(inbox.map(({title, body}) => `${title}|${body}`)).size).toBe(1);
});

it("drops a waiting nudge when the list is started, the person leaves, or the exchange closes", async () => {
  await noteEmptyListViewed(viewers.giver, exchangeId, ids.empty, now);
  await noteEmptyListViewed(viewers.giver, exchangeId, ids.lookedAfter, now);
  await noteEmptyListViewed(viewers.giver, exchangeId, ids.helper, now);
  expect(await nudges()).toHaveLength(3);

  await withFamily(familyId, async (tx) => {
    await tx.insert(items).values({familyId, ownerId: ids.empty, kind: "note", title: "A scarf"});
    await tx.update(participants).set({status: "out"}).where(and(
      eq(participants.exchangeId, exchangeId), eq(participants.personId, ids.lookedAfter),
    ));
    await tx.update(people).set({removedAt: new Date()}).where(eq(people.id, ids.helper));
  });
  await queueViewedNudges(later);
  expect(await notices()).toEqual([]);
  expect(await nudges()).toEqual([]);
});
