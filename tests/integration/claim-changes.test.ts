import {randomUUID} from "node:crypto";
import {and, eq} from "drizzle-orm";
import sharp from "sharp";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {signInDevice} from "../../src/server/auth/access";
import {actFor} from "../../src/server/auth/security";
import {digest, secret} from "../../src/server/auth/session";
import {withFamily} from "../../src/server/db/client";
import {claims, families, people} from "../../src/server/db/schema";
import {addListItem, editListItem, getWishlist, removeListItem, type ListEvents} from "../../src/server/lists";
import {acknowledgeItemChange, claimItem, getGettingList, setClaimTick, undoClaim} from "../../src/server/lists/claims";
import type {ListViewer} from "../../src/server/lists/access";
import type {ListPhotoStorage} from "../../src/server/lists/photo-storage";

vi.mock("server-only", () => ({}));

const familyId = randomUUID();
const ownerId = randomUUID();
const buyerId = randomUUID();
const otherId = randomUUID();
const helperId = randomUUID();
const lookedAfterId = randomUUID();

function viewer(personId: string, actingAs = personId) {
  return {familyId, personId, actingAs, sessionId: randomUUID(), isOrganizer: false};
}

const owner = viewer(ownerId);
const buyer = viewer(buyerId);
const other = viewer(otherId);
const helper = viewer(helperId, lookedAfterId);
const quiet: ListEvents = {claimedItemChanged: async () => undefined, budgetChanged: async () => undefined};

const note = (title: string, extra: {note?: string; price?: string} = {}) =>
  addListItem(owner, ownerId, {kind: "note", title, ...extra});
const gettingEntry = async (actor: ListViewer, itemId: string) =>
  (await getGettingList(actor)).find((entry) => entry.itemId === itemId);
const claimRow = (itemId: string) => withFamily(familyId, (tx) => tx.select().from(claims)
  .where(and(eq(claims.familyId, familyId), eq(claims.itemId, itemId))));

beforeAll(async () => {
  await withFamily(familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "Changed item fixture"});
    await tx.insert(people).values([
      {id: ownerId, familyId, displayName: "Ana"},
      {id: buyerId, familyId, displayName: "Beto"},
      {id: otherId, familyId, displayName: "Caro"},
      {id: helperId, familyId, displayName: "Dani"},
    ]);
    await tx.insert(people).values({id: lookedAfterId, familyId, displayName: "Eli", helperId});
    for (const actor of [owner, buyer, other, helper]) {
      const session = await signInDevice(tx, familyId, actor.personId, {hash: digest(secret()), kind: "iphone", network: null}, new Date());
      actor.sessionId = session.id;
      if (actor.actingAs !== actor.personId) await actFor(tx, {...actor, actingAs: actor.personId}, actor.actingAs);
    }
  });
});

afterAll(async () => {
  await withFamily(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
});

describe("what changed on a gift you are getting", () => {
  it("shows each field the owner changed since the claim, old to new, and nothing before that", async () => {
    const item = await note("Cozy slipper socks", {note: "Size 7 to 8", price: "18"});
    await claimItem(buyer, item.id);
    expect(await gettingEntry(buyer, item.id)).toMatchObject({ownerName: "Ana", changes: []});

    await editListItem(owner, ownerId, item.id, {
      title: "Cozy slipper socks, purple", note: "Size 8 to 9, not 7 to 8", price: "22.50",
    }, {events: quiet});
    expect((await gettingEntry(buyer, item.id))?.changes).toEqual([
      {field: "title", before: "Cozy slipper socks", after: "Cozy slipper socks, purple"},
      {field: "note", before: "Size 7 to 8", after: "Size 8 to 9, not 7 to 8"},
      {field: "price", before: "18.00", after: "22.50"},
    ]);
  });

  it("diffs on render, so an edit put back the way it was shows nothing", async () => {
    const item = await note("Wool hat", {note: "Green"});
    await claimItem(buyer, item.id);
    await editListItem(owner, ownerId, item.id, {note: "Red"}, {events: quiet});
    expect((await gettingEntry(buyer, item.id))?.changes).toHaveLength(1);
    await editListItem(owner, ownerId, item.id, {note: "Green"}, {events: quiet});
    expect((await gettingEntry(buyer, item.id))?.changes).toEqual([]);
  });

  it("shows a photo-only edit, rejects an unseen picture, and deletes the replaced image data", async () => {
    const photos = new Map<string, Buffer>();
    const storage: ListPhotoStorage = {
      put: async (key, bytes) => { photos.set(key, bytes); },
      get: async (key) => photos.has(key) ? Uint8Array.from(photos.get(key)!) : null,
      remove: async (key) => { photos.delete(key); },
    };
    const upload = (background: string) => sharp({create: {width: 20, height: 20, channels: 3, background}}).png().toBuffer();
    const item = await addListItem(owner, ownerId, {kind: "photo", title: "Slippers", upload: await upload("red")}, {storage});
    await claimItem(buyer, item.id);
    const initial = (await gettingEntry(buyer, item.id))!;
    const seen = (await claimRow(item.id))[0].seen!;
    expect(seen.imageKey).toBe([...photos.keys()][0]);

    await editListItem(owner, ownerId, item.id, {upload: await upload("blue")}, {storage, events: quiet});
    const changed = (await gettingEntry(buyer, item.id))!;
    expect(changed).toMatchObject({hasPhoto: true, changes: [{field: "photo", hasPhoto: true}]});
    expect(changed.changes).toHaveLength(1);
    expect(changed.version).not.toBe(initial.version);
    expect(photos.has(seen.imageKey!)).toBe(false);
    expect(photos.size).toBe(1);
    expect((await claimRow(item.id))[0].seen).toEqual(seen);
    await expect(acknowledgeItemChange(buyer, item.id, initial.version)).rejects.toMatchObject({code: "item-changed"});
    await acknowledgeItemChange(buyer, item.id, changed.version);
    expect((await gettingEntry(buyer, item.id))?.changes).toEqual([]);
    expect((await claimRow(item.id))[0].seen?.imageKey).toBe([...photos.keys()][0]);
  });

  it("shows a changed link by its store, and a note that was added or cleared", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce({url: "https://target.example.com/socks", title: "Socks", price: "12.00", store: "target.example.com", icon: "store"})
      .mockResolvedValueOnce({url: "https://shop.example.org/socks", title: "Socks", price: "12.00", store: "shop.example.org", icon: "store"});
    const item = await addListItem(owner, ownerId, {kind: "link", link: "target.example.com/socks"}, {resolve});
    await claimItem(buyer, item.id);
    await editListItem(owner, ownerId, item.id, {link: "shop.example.org/socks", note: "Any color"}, {resolve, events: quiet});
    expect((await gettingEntry(buyer, item.id))?.changes).toEqual([
      {field: "note", before: null, after: "Any color"},
      {field: "link", before: "target.example.com", after: "shop.example.org", url: "https://shop.example.org/socks"},
    ]);
  });

  it("acknowledges only the version that was shown, then shows only newer changes", async () => {
    const item = await note("Board game", {price: "30"});
    await claimItem(buyer, item.id);
    const before = await gettingEntry(buyer, item.id);
    await editListItem(owner, ownerId, item.id, {price: "35"}, {events: quiet});
    await expect(acknowledgeItemChange(buyer, item.id, before!.version)).rejects.toMatchObject({code: "item-changed"});

    const shown = await gettingEntry(buyer, item.id);
    expect(shown?.changes).toEqual([{field: "price", before: "30.00", after: "35.00"}]);
    await acknowledgeItemChange(buyer, item.id, shown!.version);
    expect((await gettingEntry(buyer, item.id))?.changes).toEqual([]);

    await editListItem(owner, ownerId, item.id, {note: "The travel edition"}, {events: quiet});
    expect((await gettingEntry(buyer, item.id))?.changes).toEqual([
      {field: "note", before: null, after: "The travel edition"},
    ]);
  });

  it("lets only the getter acknowledge, never the owner or someone else", async () => {
    const item = await note("Puzzle");
    await claimItem(buyer, item.id);
    await editListItem(owner, ownerId, item.id, {note: "1000 pieces"}, {events: quiet});
    const {version} = (await gettingEntry(buyer, item.id))!;
    await expect(acknowledgeItemChange(owner, item.id, version)).rejects.toMatchObject({code: "forbidden"});
    await expect(acknowledgeItemChange(other, item.id, version)).rejects.toMatchObject({code: "not-found"});
    expect((await gettingEntry(buyer, item.id))?.changes).toHaveLength(1);
  });

  it("works for a helper getting a gift on behalf of the person they look after", async () => {
    const item = await note("Kite", {note: "Red"});
    await claimItem(helper, item.id);
    await editListItem(owner, ownerId, item.id, {note: "Blue"}, {events: quiet});
    const shown = await gettingEntry(helper, item.id);
    expect(shown?.changes).toEqual([{field: "note", before: "Red", after: "Blue"}]);
    await acknowledgeItemChange(helper, item.id, shown!.version);
    expect((await gettingEntry(helper, item.id))?.changes).toEqual([]);
  });

  it("deletes the snapshot with the claim: letting go and claiming again starts fresh", async () => {
    const item = await note("Scarf", {note: "Long"});
    await claimItem(buyer, item.id);
    await editListItem(owner, ownerId, item.id, {note: "Short"}, {events: quiet});
    await undoClaim(buyer, item.id);
    expect(await claimRow(item.id)).toEqual([]);
    await claimItem(other, item.id);
    expect((await claimRow(item.id))[0]?.seen).toEqual({title: "Scarf", note: "Short", url: null, store: null, price: null, imageKey: null});
    expect((await gettingEntry(other, item.id))?.changes).toEqual([]);

    await removeListItem(owner, ownerId, item.id, {events: quiet});
    expect(await claimRow(item.id)).toEqual([]);
  });

  it.each([
    {bought: false, wrapped: false}, {bought: true, wrapped: false},
    {bought: false, wrapped: true}, {bought: true, wrapped: true},
  ])("restores released progress %j with a fresh snapshot when Undo reclaims the gift", async (progress) => {
    const item = await note("Gloves", {note: "Medium"});
    await claimItem(buyer, item.id);
    await setClaimTick(buyer, item.id, "bought", progress.bought);
    await setClaimTick(buyer, item.id, "wrapped", progress.wrapped);
    await editListItem(owner, ownerId, item.id, {note: "Large"}, {events: quiet});
    expect((await gettingEntry(buyer, item.id))?.changes).toHaveLength(1);

    const released = await undoClaim(buyer, item.id);
    expect(released).toEqual(progress);
    expect(await claimRow(item.id)).toEqual([]);
    await editListItem(owner, ownerId, item.id, {note: "Extra large"}, {events: quiet});
    await claimItem(buyer, item.id, released);
    expect(await gettingEntry(buyer, item.id)).toMatchObject({...progress, changes: []});
    expect((await claimRow(item.id))[0].seen?.note).toBe("Extra large");
  });

  it("does not restore progress onto a gift someone else claimed after it was released", async () => {
    const item = await note("Teapot");
    await claimItem(buyer, item.id);
    await setClaimTick(buyer, item.id, "bought", true);
    await setClaimTick(buyer, item.id, "wrapped", true);
    const released = await undoClaim(buyer, item.id);
    await claimItem(other, item.id);
    await expect(claimItem(buyer, item.id, released)).rejects.toMatchObject({code: "already-claimed"});
    expect(await gettingEntry(other, item.id)).toMatchObject({bought: false, wrapped: false});
    expect(await gettingEntry(buyer, item.id)).toBeUndefined();
  });

  it("gives the owner the same edit result and list whether or not anyone is getting the item", async () => {
    const claimed = await note("Same mug", {note: "Blue"});
    const unclaimed = await note("Same mug", {note: "Blue"});
    await claimItem(buyer, claimed.id);
    const seenBefore = (await claimRow(claimed.id))[0]?.seen;

    // Each item's own id and edit time aside, the two are indistinguishable.
    const strip = <T extends {id: string; updatedAt?: unknown}>(item: T) => {
      const {id, updatedAt, ...rest} = item;
      void id; void updatedAt;
      return rest;
    };
    const editedClaimed = await editListItem(owner, ownerId, claimed.id, {note: "Green"}, {events: quiet});
    const editedUnclaimed = await editListItem(owner, ownerId, unclaimed.id, {note: "Green"}, {events: quiet});
    expect(strip(editedClaimed)).toEqual(strip(editedUnclaimed));
    // The owner's edit leaves the getter's snapshot alone: the difference is only worked out for the getter.
    expect((await claimRow(claimed.id))[0]?.seen).toEqual(seenBefore);

    const list = await getWishlist(owner, ownerId);
    const shown = list.items.filter(({id}) => id === claimed.id || id === unclaimed.id).map(strip);
    expect(shown[0]).toEqual(shown[1]);
    expect(JSON.stringify(list)).not.toMatch(/seen|changes|version/);
  });
});
