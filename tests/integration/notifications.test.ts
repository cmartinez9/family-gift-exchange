import {createECDH, randomBytes, randomUUID} from "node:crypto";
import {eq, sql} from "drizzle-orm";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {sessions} from "../../src/server/auth/schema";
import {withFamily} from "../../src/server/db/client";
import {claims, exchanges, families, items, outbox, participants, people} from "../../src/server/db/schema";
import {notify, sendMessage} from "../../src/server/messages";
import {deliverPendingPushForFamily} from "../../src/server/messages/delivery";
import {listCapturedMessages} from "../../src/server/messages/dev-outbox";
import {getUnreadCount, listNotifications, markNotificationRead} from "../../src/server/messages/inbox";
import type {PushSender} from "../../src/server/messages/push";
import {runDailyReminders} from "../../src/server/messages/reminders";
import {pushSubscriptions} from "../../src/server/messages/schema";
import {hasPushSubscription, subscribePush, unsubscribePush} from "../../src/server/messages/subscriptions";

vi.mock("server-only", () => ({}));

const now = new Date("2032-12-23T17:00:00Z");
const tomorrow = "2032-12-24";
const familyId = randomUUID();
const otherFamilyId = randomUUID();
const exchangeId = randomUUID();
const organizers = [
  {id: randomUUID(), displayName: "Mistle", language: "en", role: "organizer"},
  {id: randomUUID(), displayName: "Farol", language: "es", role: "co_organizer"},
] as const;
const members = [
  {id: randomUUID(), displayName: "Crispen", language: "en"},
  {id: randomUUID(), displayName: "Brisita", language: "es"},
] as const;
const dependent = {id: randomUUID(), displayName: "Sparkle", helperId: members[0].id};
const outOfExchange = {id: randomUUID(), displayName: "Pinebell"};
const outsider = {id: randomUUID(), displayName: "Firbud"};
const itemIds = [randomUUID(), randomUUID()];
const event = {familyId, exchangeId};

function device(personId: string, tenant = familyId) {
  return {familyId: tenant, personId, actingAs: personId, sessionId: randomUUID(), isOrganizer: false};
}

async function signedInDevice(personId: string, tenant = familyId) {
  const viewer = device(personId, tenant);
  await withFamily(tenant, (tx) => tx.insert(sessions).values({
    familyId: tenant, id: viewer.sessionId, personId, actingAs: personId,
    deviceHash: randomUUID(), tokenHash: randomUUID(), deviceKind: "test", expiresAt: new Date(Date.now() + 60_000),
  }));
  return viewer;
}

function browserSubscription() {
  const ecdh = createECDH("prime256v1");
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${randomUUID()}`,
    keys: {p256dh: ecdh.generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url")},
  };
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("VAPID_SUBJECT", undefined);
  await withFamily(familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "Notification test"});
    await tx.insert(people).values([...organizers, ...members, dependent, outOfExchange].map((person) => ({...person, familyId})));
    await tx.insert(exchanges).values({familyId, id: exchangeId, name: "Winter", status: "drawn", giftDay: tomorrow, listDeadline: tomorrow});
    await tx.insert(participants).values([...organizers, ...members, dependent, outOfExchange].map(({id}) => ({
      familyId, exchangeId, personId: id, status: id === outOfExchange.id ? "out" as const : "in" as const,
    })));
    await tx.insert(items).values(itemIds.map((id, index) => ({
      familyId, id, kind: "note" as const, ownerId: members[1 - index].id, title: "Do not expose this item’s title",
    })));
    await tx.insert(claims).values(itemIds.map((itemId, index) => ({
      familyId, itemId, exchangeId, claimerId: members[index].id,
    })));
  });
  await withFamily(otherFamilyId, async (tx) => {
    await tx.insert(families).values({id: otherFamilyId, name: "Separate test"});
    await tx.insert(people).values({...outsider, familyId: otherFamilyId});
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of [familyId, otherFamilyId]) {
    await withFamily(id, (tx) => tx.delete(families).where(eq(families.id, id)));
  }
});

it("captures every event in both recipient languages and confines sensitive events to their intended recipients", async () => {
  await notify.drawEvents.namesDrawn(event);
  await notify.drawEvents.plansChanged({...event, personIds: members.map(({id}) => id).concat(outOfExchange.id, outsider.id)});
  await notify.listEvents.budgetChanged(event);
  for (const itemId of itemIds) await notify.listEvents.itemChanged({...event, itemId});
  await notify.requestPinReset({familyId, personId: outOfExchange.id});
  await withFamily(familyId, (tx) => tx.update(exchanges).set({status: "setup"}).where(eq(exchanges.id, exchangeId)));
  await runDailyReminders(now);
  await runDailyReminders(now);

  const messages = (await listCapturedMessages()).filter((message) => organizers.some((p) => p.id === message.personId)
    || members.some((p) => p.id === message.personId) || message.personId === dependent.id);
  const recipients = [...organizers, ...members, dependent];
  const scenarios = {
    "names-drawn": recipients,
    "plans-changed": members,
    "budget-changed": recipients,
    "claimed-item-changed": members,
    "pin-reset-request": organizers,
    "list-reminder": recipients,
    "gift-day-reminder": recipients,
  };
  for (const [template, expected] of Object.entries(scenarios)) {
    const matches = messages.filter((message) => message.template === template);
    expect(matches.map((message) => message.personId).toSorted()).toEqual(expected.map(({id}) => id).toSorted());
    expect(matches.map((message) => message.language)).toEqual(expect.arrayContaining(["es", "en"]));
    expect(new Set(matches.map((message) => message.body)).size).toBe(2);
    for (const message of matches) {
      const content = `${message.title} ${message.body}`;
      expect(content).not.toContain("Do not expose");
      for (const person of [...recipients, outsider]) expect(content).not.toContain(person.displayName);
      if (template === "pin-reset-request") expect(content).toContain(outOfExchange.displayName);
    }
  }

  const rows = await withFamily(familyId, (tx) => tx.select().from(outbox));
  for (const itemId of itemIds) expect(JSON.stringify(rows)).not.toContain(itemId);
  expect(rows).toHaveLength(messages.length);
});

it("rolls back event notifications with the corresponding family mutation", async () => {
  await expect(withFamily(familyId, async (tx) => {
    await notify.drawEvents.namesDrawn(event, tx);
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  expect(await listNotifications(device(members[0].id))).toEqual([]);
});

it("keeps read state per recipient and permits a helper's looked-after inbox", async () => {
  await notify.drawEvents.namesDrawn(event);
  const owner = device(members[0].id);
  const organizer = {...device(organizers[0].id), isOrganizer: true};
  const stranger = device(outsider.id, otherFamilyId);
  const partner = device(members[1].id);
  const [notice] = await listNotifications(owner);
  expect(notice).toMatchObject({title: "Names are drawn!", isRead: false});
  expect(await getUnreadCount(owner)).toBe(1);

  for (const viewer of [organizer, stranger, partner]) {
    await markNotificationRead(viewer, notice.id);
    expect(await listNotifications({...viewer, actingAs: owner.personId})).toEqual([]);
  }
  expect(await getUnreadCount(owner)).toBe(1);
  await markNotificationRead(owner, notice.id);
  expect(await getUnreadCount(owner)).toBe(0);
  expect(await getUnreadCount(organizer)).toBe(1);

  const helper = {...owner, actingAs: dependent.id};
  const [helpedNotice] = await listNotifications(helper);
  expect(helpedNotice).toMatchObject({title: "Names are drawn!", isRead: false});
  expect(await listNotifications({...organizer, actingAs: dependent.id})).toEqual([]);
  await markNotificationRead(helper, helpedNotice.id);
  expect(await getUnreadCount(helper)).toBe(0);
});

it("prunes a gone endpoint, scopes subscriptions to sessions, and delivers only safe payloads", async () => {
  const owner = await signedInDevice(organizers[0].id);
  const gone = await signedInDevice(organizers[0].id);
  const switchedOff = await signedInDevice(organizers[0].id);
  const revoked = await signedInDevice(organizers[0].id);
  const unrelated = await signedInDevice(outsider.id, otherFamilyId);
  const liveSubscription = browserSubscription();
  const goneSubscription = browserSubscription();
  const unsubscribed = browserSubscription();

  expect(await subscribePush(owner, liveSubscription)).toBe(true);
  expect(await subscribePush(gone, goneSubscription)).toBe(true);
  expect(await subscribePush(switchedOff, unsubscribed)).toBe(true);
  expect(await subscribePush(revoked, browserSubscription())).toBe(true);
  expect(await subscribePush(unrelated, browserSubscription())).toBe(true);
  expect(await subscribePush(owner, {endpoint: "https://example.com/private"})).toBe(false);
  expect(await subscribePush({...owner, personId: members[0].id}, browserSubscription())).toBe(false);
  await unsubscribePush({...owner, personId: members[0].id});
  expect(await hasPushSubscription(owner)).toBe(true);
  await unsubscribePush(switchedOff);
  expect(await hasPushSubscription(switchedOff)).toBe(false);
  await withFamily(familyId, (tx) => tx.update(sessions).set({revokedAt: new Date()}).where(eq(sessions.id, revoked.sessionId)));
  expect(await subscribePush(revoked, browserSubscription())).toBe(false);
  expect(await withFamily(otherFamilyId, (tx) => tx.select().from(pushSubscriptions))).toHaveLength(1);

  vi.stubEnv("VERCEL_ENV", "production");
  const sender = vi.fn<PushSender>().mockImplementation(async ({endpoint}) => endpoint === goneSubscription.endpoint ? "gone" : "sent");
  await notify.requestPinReset({familyId, personId: members[1].id});
  await sendMessage({familyId, personId: owner.personId, language: "en", template: "plans-changed"});
  await deliverPendingPushForFamily(familyId, sender);
  await deliverPendingPushForFamily(familyId, sender);

  expect(sender.mock.calls.map(([subscription]) => subscription.endpoint).toSorted()).toEqual([
    goneSubscription.endpoint, liveSubscription.endpoint, liveSubscription.endpoint,
  ].toSorted());
  expect(await hasPushSubscription(gone)).toBe(false);
  expect(await hasPushSubscription(owner)).toBe(true);
  const payloads = sender.mock.calls.map(([, payload]) => payload);
  expect(payloads).toEqual(expect.arrayContaining([
    expect.objectContaining({title: "Change of plans", url: "/en/notifications"}),
    expect.objectContaining({title: "Family Gift Exchange", url: "/en/notifications"}),
  ]));
  for (const payload of payloads) {
    expect(Object.keys(payload).toSorted()).toEqual(["body", "tag", "title", "url"]);
    for (const person of [...members, ...organizers]) {
      expect(JSON.stringify(payload)).not.toContain(person.displayName);
      expect(JSON.stringify(payload)).not.toContain(person.id);
    }
  }
  const rows = await withFamily(familyId, (tx) => tx.select().from(outbox));
  expect(rows.filter((row) => row.personId === owner.personId)).toMatchObject([{status: "sent"}, {status: "sent"}]);
});

it("does not send captured messages and limits cron's cross-family lookup to its unscoped context", async () => {
  await sendMessage({familyId, personId: members[0].id, language: "en", template: "names-drawn"});
  const sender = vi.fn<PushSender>();
  await deliverPendingPushForFamily(familyId, sender);
  expect(sender).not.toHaveBeenCalled();

  const discovery = await withFamily(otherFamilyId, (tx) =>
    tx.execute(sql`SELECT * FROM public.fge_notification_work(${tomorrow}::date, true)`),
  );
  expect(discovery.rows).toEqual([]);
});

it("processes every pending push across batches and retries each transient failure on a later flush", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  const owner = await signedInDevice(members[0].id);
  await subscribePush(owner, browserSubscription());
  const sender = vi.fn<PushSender>().mockResolvedValue("retry");
  const notice = {familyId, personId: owner.personId, language: "en", template: "budget-changed"} as const;
  for (let count = 0; count < 12; count++) await sendMessage(notice);

  await deliverPendingPushForFamily(familyId, sender);
  expect(sender).toHaveBeenCalledTimes(12);
  expect(new Set(sender.mock.calls.map(([, payload]) => payload.tag)).size).toBe(12);

  sender.mockClear().mockResolvedValue("sent");
  await deliverPendingPushForFamily(familyId, sender);
  expect(sender).toHaveBeenCalledTimes(12);
  const rows = await withFamily(familyId, (tx) => tx.select().from(outbox));
  expect(rows).toHaveLength(12);
  expect(rows.every((row) => row.status === "sent" && row.pushAttempts === 2)).toBe(true);
});

it("keeps a missed reminder in the inbox and sends the current reminder with a same-day push expiry", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  const owner = await signedInDevice(members[0].id);
  await subscribePush(owner, browserSubscription());
  const sender = vi.fn<PushSender>().mockResolvedValue("sent");

  await withFamily(familyId, (tx) => tx.insert(outbox).values({
    familyId, personId: owner.personId, channel: "push", language: "en", template: "gift-day-reminder",
    status: "pending", createdAt: new Date(Date.now() - 48 * 60 * 60_000),
  }));
  await sendMessage({familyId, personId: owner.personId, language: "en", template: "list-reminder"});
  await deliverPendingPushForFamily(familyId, sender);

  const rows = await withFamily(familyId, (tx) => tx.select().from(outbox));
  expect(rows.find(({template}) => template === "gift-day-reminder")?.status).toBe("skipped");
  expect(await listNotifications(owner)).toHaveLength(2);
  expect(sender).toHaveBeenCalledOnce();
  const [, payload, ttl] = sender.mock.calls[0];
  expect(payload.title).toBe("Wishlists are due tomorrow");
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(25 * 60 * 60);
});
