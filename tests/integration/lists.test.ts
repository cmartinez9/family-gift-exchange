import {randomUUID} from "node:crypto";
import {and, eq, sql} from "drizzle-orm";
import sharp from "sharp";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {withFamily} from "../../src/server/db/client";
import {signInDevice} from "../../src/server/auth/access";
import {actFor, disputeSession} from "../../src/server/auth/security";
import {digest, findViewer, parseSession, secret} from "../../src/server/auth/session";
import {sessions} from "../../src/server/auth/schema";
import {exchanges, families, items, people} from "../../src/server/db/schema";
import {
  addListItem, editListItem, getListExchangeCard, getListPhoto, getWishlist, listFamilyWishlists, moveListItem,
  refreshListItem, removeListItem, saveAboutField, saveListSize, saveNoClothes, setExchangeBudget, type ListEvents,
} from "../../src/server/lists";
import {claimItem, getGettingList, setClaimTick, undoClaim} from "../../src/server/lists/claims";
import type {ListPhotoStorage} from "../../src/server/lists/photo-storage";
import type {ListViewer} from "../../src/server/lists/access";

vi.mock("server-only", () => ({}));

const familyId = randomUUID();
const otherFamilyId = randomUUID();
const organizerId = randomUUID();
const helperId = randomUUID();
const lookedAfterId = randomUUID();
const ownerId = randomUUID();
const buyerId = randomUUID();
const largeListPersonId = randomUUID();
const outsiderId = randomUUID();
const exchangeId = randomUUID();

function viewer(personId: string, actingAs = personId, family = familyId) {
  return {familyId: family, personId, actingAs, sessionId: randomUUID(), isOrganizer: personId === organizerId};
}

const organizer = viewer(organizerId);
const helper = viewer(helperId, lookedAfterId);
const owner = viewer(ownerId);
const buyer = viewer(buyerId);
const outsider = viewer(outsiderId, outsiderId, otherFamilyId);
const largeListActor = viewer(largeListPersonId);
const addWritten = (actor: ListViewer, id: string, title: string) =>
  addListItem(actor, id, {kind: "note", title});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return {promise, resolve};
}

beforeAll(async () => {
  await withFamily(familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "Gift fixture"});
    await tx.insert(people).values([
      {id: organizerId, familyId, displayName: "Winterberry", role: "organizer"},
      {id: helperId, familyId, displayName: "Willowbit"},
      {id: ownerId, familyId, displayName: "Frostpaw"},
      {id: buyerId, familyId, displayName: "Cinnabar"},
      {id: largeListPersonId, familyId, displayName: "Snowdrop"},
    ]);
    await tx.insert(people).values({id: lookedAfterId, familyId, displayName: "Acornkin", helperId});
    for (const actor of [organizer, helper, owner, buyer, largeListActor]) {
      const session = await signInDevice(tx, familyId, actor.personId, {hash: digest(secret()), kind: "iphone", network: null}, new Date());
      actor.sessionId = session.id;
      if (actor.actingAs !== actor.personId) {
        await actFor(tx, {...actor, actingAs: actor.personId}, actor.actingAs);
      }
    }
  });
  await withFamily(otherFamilyId, async (tx) => {
    await tx.insert(families).values({id: otherFamilyId, name: "Other gift fixture"});
    await tx.insert(people).values({id: outsiderId, familyId: otherFamilyId, displayName: "Snowmote"});
    const session = await signInDevice(tx, otherFamilyId, outsiderId, {hash: digest(secret()), kind: "iphone", network: null}, new Date());
    outsider.sessionId = session.id;
  });
});

afterAll(async () => {
  for (const family of [familyId, otherFamilyId]) {
    await withFamily(family, (tx) => tx.delete(families).where(eq(families.id, family)).execute());
  }
});

describe("wishlist access and claims", () => {
  it("lists people in the family, grants edit only to an owner or their acting helper, and hides other families", async () => {
    expect((await listFamilyWishlists(buyer)).map((person) => person.id)).toContain(lookedAfterId);
    expect((await listFamilyWishlists(outsider)).map((person) => person.id)).toEqual([outsiderId]);
    await expect(getWishlist(outsider, lookedAfterId)).rejects.toMatchObject({code: "not-found"});
    await expect(getWishlist(buyer, "not-an-id")).rejects.toMatchObject({code: "not-found"});
    await expect(addWritten(organizer, ownerId, "Not an organizer permission")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(addWritten({...buyer, actingAs: lookedAfterId}, lookedAfterId, "Invalid helper")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(addWritten({...helper, actingAs: helperId}, lookedAfterId, "Switch to helping first")).rejects.toMatchObject({
      code: "forbidden",
    });
    const item = await addWritten(helper, lookedAfterId, "Model train");
    expect(await getWishlist(buyer, lookedAfterId)).toMatchObject({canEdit: false, items: [item]});
    await expect(claimItem(outsider, item.id)).rejects.toMatchObject({code: "not-found"});
  });

  it("returns exactly the same owner and helper views before and after anonymous claims", async () => {
    const first = await addWritten(owner, ownerId, "Knit hat");
    const second = await addWritten(owner, ownerId, "Leather journal");
    const helped = await addWritten(helper, lookedAfterId, "Poster");
    const ownerBefore = await getWishlist(owner, ownerId);
    const helperBefore = await getWishlist(helper, lookedAfterId);
    const directoryBefore = await listFamilyWishlists(owner);
    const ownerChecklist = await getGettingList(owner);

    await claimItem(buyer, second.id);
    await claimItem(buyer, helped.id);

    expect(await getWishlist(owner, ownerId)).toEqual(ownerBefore);
    expect(await getWishlist(helper, lookedAfterId)).toEqual(helperBefore);
    expect(await getWishlist(owner, ownerId.toUpperCase())).toEqual(ownerBefore);
    expect(await getWishlist(helper, lookedAfterId.toUpperCase())).toEqual(helperBefore);
    expect(await listFamilyWishlists(owner)).toEqual(directoryBefore);
    expect(await getGettingList(owner)).toEqual(ownerChecklist);
    expect(ownerBefore.items.map((item) => item.id).slice(-2)).toEqual([first.id, second.id]);
    expect(ownerBefore.items.every((item) => !Object.hasOwn(item, "claim"))).toBe(true);
    expect((await getWishlist(organizer, ownerId)).items.find((item) => item.id === second.id))
      .toEqual({...second, claim: "someone"});
    expect((await getWishlist(buyer, ownerId)).items.find((item) => item.id === second.id))
      .toEqual({...second, claim: "mine"});
    await expect(claimItem(owner, second.id)).rejects.toMatchObject({code: "forbidden"});
    await expect(claimItem(helper, helped.id)).rejects.toMatchObject({code: "forbidden"});

    await undoClaim(buyer, second.id);
    await undoClaim(buyer, helped.id);
  });

  it("serializes competing claims before any season exists and keeps checklist ticks private", async () => {
    const item = await addWritten(owner, ownerId, "Boot care kit");
    const results = await Promise.allSettled([claimItem(buyer, item.id), claimItem(organizer, item.id)]);
    expect(results.filter(({status}) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({status}) => status === "rejected")).toMatchObject({reason: {code: "already-claimed"}});
    const winner = results[0].status === "fulfilled" ? buyer : organizer;
    const other = winner === buyer ? organizer : buyer;
    await expect(claimItem(winner, item.id)).resolves.toBeUndefined();
    await undoClaim(other, item.id);
    await expect(setClaimTick(other, item.id, "bought", true)).rejects.toMatchObject({code: "not-found"});
    await Promise.all([setClaimTick(winner, item.id, "bought", true), setClaimTick(winner, item.id, "wrapped", true)]);
    expect(await getGettingList(winner)).toContainEqual({
      itemId: item.id, title: item.title, ownerId, ownerName: "Frostpaw", bought: true, wrapped: true,
    });
    expect((await getGettingList(other)).some((entry) => entry.itemId === item.id)).toBe(false);
    await undoClaim(winner, item.id);
    expect((await getGettingList(winner)).some((entry) => entry.itemId === item.id)).toBe(false);
  });

  it("enqueues edits and removals only for the claimer and keeps queue failures private", async () => {
    const item = await addWritten(owner, ownerId, "Tea tin");
    await claimItem(buyer, item.id);
    const events: ListEvents = {claimedItemChanged: vi.fn(), budgetChanged: vi.fn()};
    const failingEvents: ListEvents = {...events, async claimedItemChanged(tx) {
      await tx.execute(sql`select 1 / 0`);
    }};
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(editListItem(owner, ownerId, item.id, {note: "Any shade"}, {events: failingEvents}))
        .resolves.toEqual({...item, note: "Any shade"});
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === item.id))
      .toEqual({...item, note: "Any shade"});

    const edited = await editListItem(owner, ownerId, item.id, {note: "Any color"}, {events});
    expect(edited).toEqual({...item, note: "Any color"});
    await moveListItem(owner, ownerId, item.id, "up");
    await removeListItem(owner, ownerId, item.id, {events});
    expect(events.claimedItemChanged).toHaveBeenCalledTimes(2);
    expect(events.claimedItemChanged).toHaveBeenNthCalledWith(1, expect.anything(), {
      familyId, personId: buyerId, itemId: item.id, title: "Tea tin", change: "edited",
    });
    expect(events.claimedItemChanged).toHaveBeenNthCalledWith(2, expect.anything(), {
      familyId, personId: buyerId, itemId: item.id, title: "Tea tin", change: "deleted",
    });
    expect((await getGettingList(buyer)).some((entry) => entry.itemId === item.id)).toBe(false);
    expect((await getWishlist(owner, ownerId)).items.some(({id}) => id === item.id)).toBe(false);
  });
});

describe("live list authorization", () => {
  it.each(["disputed session", "changed profile", "expired session"])("rejects a save after a %s during photo storage and cleans up the upload", async (change) => {
    const personId = change === "changed profile" ? helperId : ownerId;
    const targetId = change === "changed profile" ? lookedAfterId : ownerId;
    const session = await withFamily(familyId, (tx) => signInDevice(
      tx, familyId, personId, {hash: digest(secret()), kind: "computer", network: null}, new Date(),
    ));
    let actor = (await withFamily(familyId, (tx) => findViewer(tx, parseSession(session.cookie)!)))!;
    if (change === "changed profile") {
      await withFamily(familyId, (tx) => actFor(tx, actor, targetId));
      actor = (await withFamily(familyId, (tx) => findViewer(tx, parseSession(session.cookie)!)))!;
    }
    const stored = signal();
    const resume = signal();
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const storage: ListPhotoStorage = {
      async put(key, bytes) { files.set(key, Uint8Array.from(bytes)); stored.resolve(); await resume.promise; },
      async get(key) { return files.get(key) ?? null; },
      async remove(key) { files.delete(key); },
    };
    const title = `Interrupted save: ${change}`;
    const image = await sharp({create: {width: 2, height: 2, channels: 3, background: "#aabbcc"}}).webp().toBuffer();
    const outcome = addListItem(actor, targetId, {kind: "link", link: "https://gift.example.com/book"}, {
      storage, resolve: async () => ({url: "https://gift.example.com/book", title, price: null, store: "gift.example.com", icon: "store", image}),
    }).then((value) => ({value}), (error: unknown) => ({error}));
    await stored.promise;
    try {
      expect(files.size).toBe(1);
      if (change === "disputed session") {
        await expect(withFamily(familyId, (tx) => disputeSession(tx, owner, actor.sessionId, new Date()))).resolves.toBe(true);
      } else if (change === "changed profile") {
        await expect(withFamily(familyId, (tx) => actFor(tx, actor, personId))).resolves.toBe(true);
      } else {
        await withFamily(familyId, (tx) => tx.update(sessions).set({expiresAt: new Date(Date.now() - 1000)})
          .where(and(eq(sessions.familyId, familyId), eq(sessions.id, actor.sessionId))));
      }
    } finally {
      resume.resolve();
    }
    expect(await outcome).toMatchObject({error: {code: "forbidden"}});
    expect(files.size).toBe(0);
    expect(await withFamily(familyId, (tx) => tx.select().from(items).where(and(
      eq(items.familyId, familyId), eq(items.ownerId, targetId), eq(items.title, title),
    )))).toEqual([]);
    await expect(getWishlist(actor, targetId)).rejects.toMatchObject({code: "forbidden"});
    await expect(saveAboutField(actor, targetId, "likes", "Changed after authorization"))
      .rejects.toMatchObject({code: "forbidden"});
    await expect(addWritten(change === "changed profile" ? helper : owner, targetId, `Allowed save: ${change}`))
      .resolves.toMatchObject({title: `Allowed save: ${change}`});
  });

  it("rechecks a queued list request after a session dispute commits under the family lock", async () => {
    const session = await withFamily(familyId, (tx) => signInDevice(
      tx, familyId, ownerId, {hash: digest(secret()), kind: "computer", network: null}, new Date(),
    ));
    const actor = (await withFamily(familyId, (tx) => findViewer(tx, parseSession(session.cookie)!)))!;
    let outcome!: Promise<unknown>;
    await withFamily(familyId, async (tx) => {
      const blocker = (await tx.execute<{pid: number}>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      expect(await disputeSession(tx, owner, actor.sessionId, new Date())).toBe(true);
      outcome = addWritten(actor, ownerId, "Queued unauthorized save").then((value) => ({value}), (error: unknown) => ({error}));
      let waiting = false;
      const until = Date.now() + 3000;
      while (!waiting && Date.now() < until) {
        waiting = await withFamily(familyId, async (check) => (await check.execute<{waiting: boolean}>(sql`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))) AS waiting
        `)).rows[0].waiting);
        if (!waiting) await new Promise((done) => setTimeout(done, 10));
      }
      expect(waiting).toBe(true);
    });
    expect(await outcome).toMatchObject({error: {code: "forbidden"}});
    expect((await getWishlist(owner, ownerId)).items.some(({title}) => title === "Queued unauthorized save")).toBe(false);
  });
});

describe("list editing", () => {
  it("normalizes item fields and reorders using the saved list order", async () => {
    const lower = await addListItem(helper, lookedAfterId, {kind: "note", title: "  Blue mittens  ", price: "10,25"});
    const upper = await addWritten(helper, lookedAfterId, "Knitting book");
    expect(lower).toMatchObject({title: "Blue mittens", price: "10.25"});
    await moveListItem(helper, lookedAfterId, upper.id, "up");
    const ordered = (await getWishlist(buyer, lookedAfterId)).items.map(({id}) => id);
    expect(ordered.indexOf(upper.id)).toBeLessThan(ordered.indexOf(lower.id));
    await expect(editListItem(helper, lookedAfterId, lower.id, {note: "x".repeat(501)}))
      .rejects.toMatchObject({code: "invalid-item"});
    await expect(editListItem(helper, lookedAfterId, lower.id, {starred: true, price: ""}))
      .resolves.toMatchObject({starred: true, price: null});
  });

  it("saves concurrent additions beyond 300 items", async () => {
    await withFamily(familyId, (tx) => tx.insert(items).values(
      Array.from({length: 300}, (_, position) => ({
        familyId, ownerId: largeListPersonId, kind: "note" as const, title: `Fixture item ${position}`, position,
      })),
    ).execute());
    const actor = largeListActor;
    const added = await Promise.all([
      addWritten(actor, largeListPersonId, "Additional item A"), addWritten(actor, largeListPersonId, "Additional item B"),
    ]);
    const list = await getWishlist(actor, largeListPersonId);
    expect(list.items).toHaveLength(302);
    expect(list.items.slice(-2)).toEqual(expect.arrayContaining(added));
  });

  it("stores photos privately and refreshes a preview while preserving a custom photo and price", async () => {
    const input = await sharp({create: {width: 10, height: 10, channels: 3, background: "#ddaabb"}})
      .png().toBuffer();
    const previewImage = await sharp(input).webp().toBuffer();
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const storage: ListPhotoStorage = {
      async put(key, bytes) { files.set(key, Uint8Array.from(bytes)); },
      async get(key) { return files.get(key) ?? null; },
      async remove(key) { files.delete(key); },
    };
    const photoItem = await addListItem(owner, ownerId, {kind: "photo", title: "Photo item", upload: input}, {storage});
    expect(photoItem.hasPhoto).toBe(true);
    expect(await getListPhoto(buyer, photoItem.id, "photo", storage)).toBeInstanceOf(Uint8Array);
    await expect(getListPhoto(outsider, photoItem.id, "photo", storage)).rejects.toMatchObject({code: "not-found"});
    await removeListItem(owner, ownerId, photoItem.id, {storage});
    expect(files.size).toBe(0);

    const resolve = vi.fn()
      .mockResolvedValueOnce({url: "https://gift.example.com/candle", title: "Candle", price: "20.00",
        store: "gift.example.com", icon: "store", image: previewImage})
      .mockResolvedValueOnce({url: "https://gift.example.com/candle", title: "Candle in a jar", price: "16.00",
        store: "gift.example.com", icon: "store", image: previewImage});
    const linked = await addListItem(owner, ownerId, {kind: "link", link: "gift.example.com/candle"}, {resolve, storage});
    expect(linked).toMatchObject({title: "Candle", price: "20.00", hasPhoto: true});
    await editListItem(owner, ownerId, linked.id, {upload: input, price: "25"}, {storage});
    const customImage = await getListPhoto(buyer, linked.id, "photo", storage);
    const refreshed = await refreshListItem(owner, ownerId, linked.id, {storage, resolve});
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({title: "Candle in a jar", price: "25.00", hasPhoto: true});
    expect(await getListPhoto(buyer, linked.id, "photo", storage)).toEqual(customImage);
    expect(files.size).toBe(1);
    await removeListItem(owner, ownerId, linked.id, {storage});
    expect(files.size).toBe(0);
  });

  it("saves sizes and About me for a looked-after member with a shared readiness rule", async () => {
    expect((await getWishlist(helper, lookedAfterId)).ready).toBe(false);
    await expect(saveListSize(buyer, lookedAfterId, "tops", "M")).rejects.toMatchObject({code: "forbidden"});
    for (const [kind, value] of Object.entries({tops: "4T", waist: "26", length: "28", shoeSystem: "eu", shoes: "33"})) {
      await saveListSize(helper, lookedAfterId, kind, value);
    }
    await Promise.all([
      saveAboutField(helper, lookedAfterId, "likes", "Puzzles"), saveAboutField(helper, lookedAfterId, "colors", "Green"),
    ]);
    const list = await getWishlist(buyer, lookedAfterId);
    expect(list.ready).toBe(true);
    expect(list.about).toMatchObject({likes: "Puzzles", colors: "Green"});
    expect(list.sizes).toContainEqual({kind: "shoes", value: "33", updatedAt: expect.any(Date)});
    expect((await listFamilyWishlists(buyer)).find(({id}) => id === lookedAfterId)?.ready).toBe(true);
    await saveListSize(helper, lookedAfterId, "shoes", "");
    expect((await getWishlist(buyer, lookedAfterId)).ready).toBe(false);
    await saveNoClothes(helper, lookedAfterId, true);
    expect((await getWishlist(buyer, lookedAfterId)).ready).toBe(true);
  });

  it("lets an organizer set or clear the one budget and signals changes after a draw", async () => {
    await withFamily(familyId, (tx) => tx.insert(exchanges)
      .values({familyId, id: exchangeId, name: "Fixture exchange", status: "drawn"}).execute());
    const events: ListEvents = {claimedItemChanged: vi.fn(), budgetChanged: vi.fn()};
    await expect(setExchangeBudget(buyer, exchangeId, "1", events)).rejects.toMatchObject({code: "forbidden"});
    await setExchangeBudget(organizer, exchangeId, "50", events);
    expect(await getListExchangeCard(buyer)).toMatchObject({budgetAmount: "50.00"});
    await setExchangeBudget(organizer, exchangeId, "50,00", events);
    expect(events.budgetChanged).toHaveBeenCalledTimes(1);
    await setExchangeBudget(organizer, exchangeId, "", events);
    expect(await getListExchangeCard(buyer)).toMatchObject({budgetAmount: null});
    expect(events.budgetChanged).toHaveBeenCalledTimes(2);
  });
});
