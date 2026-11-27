import {beforeEach, expect, it, vi} from "vitest";
import {addFirstThing} from "../../src/app/[locale]/welcome/actions";
import {ListError} from "../../src/server/lists/access";
import type {Viewer} from "../../src/server/auth";

const server = vi.hoisted(() => ({requireViewer: vi.fn(), addListItem: vi.fn(), readLinkDraft: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({requireViewer: server.requireViewer}));
vi.mock("@/server/lists", async () => {
  const {ListError} = await import("../../src/server/lists/access");
  return {ListError, addListItem: server.addListItem};
});
vi.mock("@/server/lists/link-preview", () => ({LinkError: class extends Error {code = "invalid-link";}}));
vi.mock("@/server/lists/link-preview/draft", () => ({readLinkDraft: server.readLinkDraft}));
vi.mock("@/server/lists/photo-storage", () => ({MAX_PHOTO_INPUT: 4_000_000}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
const later = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({after: later}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));

const ana: Viewer = {familyId: "family", personId: "ana", actingAs: "ana", sessionId: "session", isOrganizer: false};
let savedOwners: string[];

beforeEach(() => {
  vi.clearAllMocks();
  savedOwners = [];
  server.requireViewer.mockResolvedValue(ana);
  server.addListItem.mockImplementation(async (viewer: Viewer, ownerId: string, _input, services) => {
    if (ownerId !== viewer.actingAs) throw new ListError("forbidden");
    savedOwners.push(ownerId);
    return {pictureComing: Boolean(services?.later)};
  });
});

function draft(kind: string) {
  const form = new FormData();
  form.set("kind", kind);
  form.set("title", "A sweater");
  form.set("link", "https://shop.example/gift");
  form.set("photo", new File([new Uint8Array([1, 2, 3])], "photo.jpg", {type: "image/jpeg"}));
  return form;
}

it.each(["note", "link", "photo"])("keeps a %s draft addressed to its rendered owner after a profile switch", async (kind) => {
  const action = addFirstThing.bind(null, ana.actingAs);
  server.requireViewer.mockResolvedValue({...ana, actingAs: "leo"});
  await expect(action({}, draft(kind))).resolves.toEqual({error: "forbidden"});
  expect(savedOwners).toEqual([]);
  expect(server.addListItem).toHaveBeenCalledWith({...ana, actingAs: "leo"}, "ana", expect.objectContaining({kind}), ...(kind === "link" ? [{later}] : []));
});

it.each(["note", "link", "photo"])("saves a %s draft when its rendered owner is still active", async (kind) => {
  await expect(addFirstThing("ana", {}, draft(kind))).resolves.toEqual({added: true, ...(kind === "link" && {pictureComing: true})});
  expect(savedOwners).toEqual(["ana"]);
});

it("uses an available preview immediately without scheduling a second page read", async () => {
  const preview = {url: "https://shop.example/gift", title: "A sweater", price: null, store: "Shop", icon: "store"};
  server.readLinkDraft.mockReturnValueOnce(preview);
  await expect(addFirstThing("ana", {}, draft("link"))).resolves.toEqual({added: true});
  const services = server.addListItem.mock.calls[0][3];
  expect(services.later).toBeUndefined();
  await expect(services.resolve()).resolves.toBe(preview);
});
