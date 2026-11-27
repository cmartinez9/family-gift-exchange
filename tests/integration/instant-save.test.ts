import {randomUUID} from "node:crypto";
import {and, eq} from "drizzle-orm";
import sharp from "sharp";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {signInDevice} from "../../src/server/auth/access";
import {digest, secret} from "../../src/server/auth/session";
import {withFamily} from "../../src/server/db/client";
import {families, items, people} from "../../src/server/db/schema";
import {
  addListItem, editListItem, fillLinkPreview, getListPhoto, getWishlist, refreshListItem, removeListItem, type ListEvents,
} from "../../src/server/lists";
import {claimItem} from "../../src/server/lists/claims";
import {LinkError, linkPreviewFromUrl, type LinkPreview} from "../../src/server/lists/link-preview";
import type {ListPhotoStorage} from "../../src/server/lists/photo-storage";
import {PICTURE_WAIT_MS} from "../../src/server/lists/validation";

vi.mock("server-only", () => ({}));

const familyId = randomUUID();
const ownerId = randomUUID();
const buyerId = randomUUID();
const viewer = (personId: string) => ({familyId, personId, actingAs: personId, sessionId: "", isOrganizer: false});
const owner = viewer(ownerId);
const buyer = viewer(buyerId);

beforeAll(async () => {
  await withFamily(familyId, async (tx) => {
    await tx.insert(families).values({id: familyId, name: "Instant save fixture"});
    await tx.insert(people).values([
      {id: ownerId, familyId, displayName: "Frostpaw"},
      {id: buyerId, familyId, displayName: "Cinnabar"},
    ]);
    for (const actor of [owner, buyer]) {
      const session = await signInDevice(tx, familyId, actor.personId, {hash: digest(secret()), kind: "iphone", network: null}, new Date());
      actor.sessionId = session.id;
    }
  });
});

afterAll(async () => {
  await withFamily(familyId, (tx) => tx.delete(families).where(eq(families.id, familyId)).execute());
});

function memoryStorage() {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const storage: ListPhotoStorage = {
    async put(key, bytes) { files.set(key, Uint8Array.from(bytes)); },
    async get(key) { return files.get(key) ?? null; },
    async remove(key) { files.delete(key); },
  };
  return {files, storage};
}

/** Saves a link the way the list's form does without a preview read ahead, holding the page read. */
function instantSave() {
  const tasks: (() => Promise<void>)[] = [];
  const {files, storage} = memoryStorage();
  const resolve = vi.fn<(input: string) => Promise<LinkPreview>>();
  const readLink = (input: string) => linkPreviewFromUrl(input, {
    lookup: async () => [{address: "93.184.216.34", family: 4}],
    request: async () => { throw new Error("the page is not read while saving"); },
  });
  const services = {storage, resolve, readLink, later: (task: () => Promise<void>) => { tasks.push(task); }};
  return {services, files, resolve, runLater: () => Promise.all(tasks.splice(0).map((task) => task()))};
}

const picture = () => sharp({create: {width: 8, height: 8, channels: 3, background: "#c8202f"}}).webp().toBuffer();
const robe = async (input: Partial<LinkPreview> = {}): Promise<LinkPreview> => ({
  url: "https://www.target.com/p/fleece-robe/-/A-12345", title: "Cozy Fleece Robe", price: "39.99",
  store: "Target", icon: "target", productId: "12345", image: await picture(), ...input,
});
const stored = async (itemId: string) => (await withFamily(familyId, (tx) => tx.select().from(items)
  .where(and(eq(items.familyId, familyId), eq(items.id, itemId)))))[0];

describe("saving a pasted link at once", () => {
  it("adds the item before the store page is read, then fills in its picture, title and price", async () => {
    const save = instantSave();
    save.resolve.mockImplementation(async () => robe());
    const added = await addListItem(owner, ownerId, {
      kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345?utm_source=share",
    }, save.services);
    expect(save.resolve).not.toHaveBeenCalled();
    expect(added).toMatchObject({
      title: "fleece robe", store: "Target", url: "https://www.target.com/p/fleece-robe/-/A-12345",
      price: null, hasPhoto: false, pictureComing: true,
    });
    expect((await getWishlist(owner, ownerId)).items).toContainEqual(added);
    // The picture's wait is not a secret, but the buyer only ever sees a plain item until it lands.
    expect((await getWishlist(buyer, ownerId)).items.find(({id}) => id === added.id)).toMatchObject({hasPhoto: false});

    await save.runLater();
    expect(save.resolve).toHaveBeenCalledWith("https://www.target.com/p/fleece-robe/-/A-12345?utm_source=share");
    const filled = (await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id);
    expect(filled).toMatchObject({title: "Cozy Fleece Robe", price: "39.99", hasPhoto: true, pictureComing: false});
    const row = await stored(added.id);
    // The photo route's cache key moves with it.
    expect(row.updatedAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
    expect(await getListPhoto(buyer, added.id, "photo", save.services.storage)).toBeInstanceOf(Uint8Array);
    expect((await stored(added.id)).preview).not.toHaveProperty("pending");
    await removeListItem(owner, ownerId, added.id, {storage: save.services.storage});
    expect(save.files.size).toBe(0);
  });

  it("keeps what the owner typed and anything they changed while the page loaded", async () => {
    const save = instantSave();
    save.resolve.mockImplementation(async () => robe());
    const added = await addListItem(owner, ownerId, {
      kind: "link", link: "target.com/p/fleece-robe/-/A-12345", title: "Robe for Grandpa", price: "35", note: "Size M",
    }, save.services);
    expect(added).toMatchObject({title: "Robe for Grandpa", price: "35.00", note: "Size M", pictureComing: true});
    const upload = await sharp({create: {width: 6, height: 6, channels: 3, background: "#12573a"}}).png().toBuffer();
    await editListItem(owner, ownerId, added.id, {upload, starred: true}, {storage: save.services.storage});
    const ownPhoto = await getListPhoto(owner, added.id, "photo", save.services.storage);

    await save.runLater();
    const filled = (await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id);
    expect(filled).toMatchObject({title: "Robe for Grandpa", price: "35.00", note: "Size M", starred: true, hasPhoto: true, pictureComing: false});
    expect(await getListPhoto(owner, added.id, "photo", save.services.storage)).toEqual(ownPhoto);
    expect(save.files.size).toBe(1);
  });

  it.each([
    {title: "Target"},
    {title: "fleece robe"},
    {price: ""},
    {title: "Target", price: " "},
  ])("preserves explicitly supplied fields matching generated defaults: %j", async (input) => {
    const save = instantSave();
    save.resolve.mockImplementation(async () => robe());
    const added = await addListItem(owner, ownerId, {
      kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345", ...input,
    }, save.services);

    await save.runLater();
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id)).toMatchObject({
      title: input.title ?? "Cozy Fleece Robe",
      price: input.price === undefined ? "39.99" : null,
      hasPhoto: true, pictureComing: false,
    });
  });

  it("preserves matching titles and cleared prices edited during the deferred read", async () => {
    const save = instantSave();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<LinkPreview>();
    save.resolve.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const added = await addListItem(owner, ownerId, {
      kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345",
    }, save.services);
    const filling = save.runLater();
    await started.promise;
    await editListItem(owner, ownerId, added.id, {title: "Target", price: ""}, save.services);
    response.resolve(await robe());
    await filling;

    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id)).toMatchObject({
      title: "Target", price: null, hasPhoto: true, pictureComing: false,
    });
  });

  it("retains owner fields through blocked previews, refreshes and link replacements", async () => {
    const save = instantSave();
    const blocked = await robe({title: "Target", price: null, image: undefined});
    save.resolve.mockResolvedValue(blocked);
    const added = await addListItem(owner, ownerId, {
      kind: "link", link: blocked.url, title: "Target", price: "",
    }, save.services);
    await save.runLater();
    await refreshListItem(owner, ownerId, added.id, save.services);

    save.resolve.mockResolvedValue(await robe());
    await expect(refreshListItem(owner, ownerId, added.id, save.services)).resolves.toMatchObject({
      title: "Target", price: null, hasPhoto: true, pictureComing: false,
    });

    const replacement = await robe({url: "https://www.target.com/p/mittens/-/A-6789", title: "Target", price: null});
    save.resolve.mockResolvedValue(replacement);
    await editListItem(owner, ownerId, added.id, {link: replacement.url}, save.services);
    save.resolve.mockResolvedValue({...replacement, title: "Winter mittens", price: "25.00"});
    await expect(refreshListItem(owner, ownerId, added.id, save.services)).resolves.toMatchObject({
      title: "Target", price: null, url: replacement.url, hasPhoto: true, pictureComing: false,
    });
  });

  it("does not tell a giver about the first picture arriving", async () => {
    const save = instantSave();
    save.resolve.mockImplementation(async () => robe());
    const events: ListEvents = {claimedItemChanged: vi.fn(), budgetChanged: vi.fn()};
    const added = await addListItem(owner, ownerId, {kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345"}, {
      ...save.services, events,
    });
    await claimItem(buyer, added.id);
    await save.runLater();
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id)).toMatchObject({title: "Cozy Fleece Robe"});
    expect(events.claimedItemChanged).not.toHaveBeenCalled();
  });

  it("leaves a clean item without a picture when the page read fails, for a refresh later", async () => {
    for (const failure of [new Error("socket hang up"), new LinkError("unsafe-link")]) {
      const save = instantSave();
      save.resolve.mockRejectedValueOnce(failure);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const added = await addListItem(owner, ownerId, {kind: "link", link: "https://shop.example.com/winter/wool-socks"}, save.services);
      await save.runLater();
      warn.mockRestore();
      const settled = (await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id);
      expect(settled).toMatchObject({
        title: "wool socks", store: "shop.example.com", url: "https://shop.example.com/winter/wool-socks",
        hasPhoto: false, pictureComing: false,
      });
      expect(save.files.size).toBe(0);

      save.resolve.mockResolvedValueOnce(await robe({url: "https://shop.example.com/winter/wool-socks", title: "Wool socks", store: "shop.example.com", icon: "store"}));
      await expect(refreshListItem(owner, ownerId, added.id, save.services))
        .resolves.toMatchObject({title: "Wool socks", hasPhoto: true, pictureComing: false});
    }
  });

  it("stops showing the picture as coming once the wait runs out", async () => {
    const save = instantSave();
    const added = await addListItem(owner, ownerId, {kind: "link", link: "https://shop.example.com/sled"}, save.services);
    expect(added.pictureComing).toBe(true);
    await withFamily(familyId, async (tx) => {
      const item = (await tx.select().from(items).where(and(eq(items.familyId, familyId), eq(items.id, added.id))))[0];
      await tx.update(items).set({preview: {...item.preview, pending: Date.now() - PICTURE_WAIT_MS - 1}})
        .where(and(eq(items.familyId, familyId), eq(items.id, added.id)));
    });
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id)).toMatchObject({pictureComing: false});
  });

  it("drops a late picture for an item taken off the list or whose link changed", async () => {
    const save = instantSave();
    save.resolve.mockImplementation(async () => robe());
    const removed = await addListItem(owner, ownerId, {kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345"}, save.services);
    const relinked = await addListItem(owner, ownerId, {kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345"}, save.services);
    await removeListItem(owner, ownerId, removed.id, {storage: save.services.storage});
    await editListItem(owner, ownerId, relinked.id, {link: "https://shop.example.com/mittens"}, {
      storage: save.services.storage,
      resolve: async () => ({url: "https://shop.example.com/mittens", title: "Mittens", price: null, store: "shop.example.com", icon: "store"}),
    });

    await save.runLater();
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === removed.id)).toBeUndefined();
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === relinked.id)).toMatchObject({
      title: "Mittens", url: "https://shop.example.com/mittens", hasPhoto: false, pictureComing: false,
    });
    expect(save.files.size).toBe(0);
  });

  it("only fills an item still waiting on its page, for its own editors", async () => {
    const save = instantSave();
    save.resolve.mockImplementation(async () => robe());
    const added = await addListItem(owner, ownerId, {kind: "link", link: "https://www.target.com/p/fleece-robe/-/A-12345"}, save.services);
    await fillLinkPreview(buyer, ownerId, added.id, "https://www.target.com/p/fleece-robe/-/A-12345", save.services);
    expect((await getWishlist(owner, ownerId)).items.find(({id}) => id === added.id)).toMatchObject({title: "fleece robe", hasPhoto: false});
    expect(save.resolve).not.toHaveBeenCalled();

    await save.runLater();
    await save.runLater();
    await fillLinkPreview(owner, ownerId, added.id, "https://www.target.com/p/fleece-robe/-/A-12345", save.services);
    expect(save.resolve).toHaveBeenCalledTimes(1);
    expect(save.files.size).toBe(1);
  });

  it("still saves a link read ahead of time in one step", async () => {
    const preview = await robe();
    const {storage} = memoryStorage();
    const added = await addListItem(owner, ownerId, {kind: "link", link: preview.url}, {storage, resolve: async () => preview});
    expect(added).toMatchObject({title: "Cozy Fleece Robe", hasPhoto: true, pictureComing: false});
  });

  it("refuses an unsafe link at once", async () => {
    const save = instantSave();
    for (const link of ["http://localhost/gift", "http://10.0.0.1/gift", "javascript:alert(1)"]) {
      await expect(addListItem(owner, ownerId, {kind: "link", link}, save.services)).rejects.toMatchObject({code: "unsafe-link"});
    }
    await expect(addListItem(owner, ownerId, {kind: "link", link: "https://inside.example.com/gift"}, {
      ...save.services,
      readLink: (input) => linkPreviewFromUrl(input, {
        lookup: async () => [{address: "192.168.1.4", family: 4}], request: async () => { throw new Error("unreachable"); },
      }),
    })).rejects.toMatchObject({code: "unsafe-link"});
  });
});
