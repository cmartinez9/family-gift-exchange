import {beforeEach, expect, it, vi} from "vitest";
import type {Viewer} from "../../src/server/auth";

const server = vi.hoisted(() => ({
  requireViewer: vi.fn(), addListItem: vi.fn(), editListItem: vi.fn(), readLinkDraft: vi.fn(), after: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({requireViewer: server.requireViewer}));
vi.mock("@/server/db/client", () => ({withFamily: vi.fn()}));
vi.mock("@/server/lists", async () => {
  const {ListError} = await import("../../src/server/lists/access");
  return {ListError, addListItem: server.addListItem, editListItem: server.editListItem};
});
vi.mock("@/server/lists/claims", () => ({}));
vi.mock("@/server/lists/link-preview", () => ({LinkError: class extends Error {code = "invalid-link";}}));
vi.mock("@/server/lists/link-preview/draft", () => ({readLinkDraft: server.readLinkDraft, signLinkDraft: vi.fn()}));
vi.mock("@/server/lists/photo-storage", () => ({MAX_PHOTO_INPUT: 4_000_000}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
vi.mock("next/navigation", () => ({redirect: vi.fn()}));
vi.mock("next/server", () => ({after: server.after}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));

const {saveItem} = await import("../../src/app/[locale]/lists/actions");
const ana: Viewer = {familyId: "family", personId: "ana", actingAs: "ana", sessionId: "session", isOrganizer: false};

function linkForm(draft?: string) {
  const form = new FormData();
  form.set("link", "https://www.target.com/p/fleece-robe/-/A-12345");
  form.set("title", "");
  if (draft) form.set("draft", draft);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  server.requireViewer.mockResolvedValue(ana);
});

it("saves a new link at once and reads its page after the response when no preview came first", async () => {
  server.readLinkDraft.mockReturnValue(undefined);
  await saveItem("ana", null, "link", {}, linkForm());
  expect(server.addListItem).toHaveBeenCalledWith(ana, "ana", expect.objectContaining({kind: "link"}), {later: server.after});
});

it("uses a preview read ahead of time instead of reading the page again", async () => {
  const preview = {url: "https://www.target.com/p/fleece-robe/-/A-12345", title: "Robe", price: null, store: "Target", icon: "target"};
  server.readLinkDraft.mockReturnValue(preview);
  await saveItem("ana", null, "link", {}, linkForm("signed"));
  const services = server.addListItem.mock.calls[0][3];
  expect(services.later).toBeUndefined();
  await expect(services.resolve()).resolves.toBe(preview);
});
