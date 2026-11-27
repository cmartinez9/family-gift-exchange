import {beforeEach, expect, it, vi} from "vitest";
import {previewItemLink, saveProfileField} from "../../src/app/[locale]/lists/actions";

const server = vi.hoisted(() => ({
  jar: new Map<string, string>(), saved: new Map<string, string>(),
  findViewer: vi.fn(), requireListEditor: vi.fn(), resolveLinkPreview: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({cookies: async () => ({
  get: (name: string) => server.jar.has(name) ? {value: server.jar.get(name)} : undefined,
  set: (name: string, value: string, options: {maxAge?: number}) => {
    if (options.maxAge === 0) server.jar.delete(name);
    else server.jar.set(name, value);
  },
})}));
vi.mock("next/navigation", () => ({redirect: (url: string) => { throw new Error(`redirect:${url}`); }}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));
vi.mock("next/cache", () => ({revalidatePath: vi.fn()}));
vi.mock("@/server/db/client", () => ({withFamily: (_family: string, action: (tx: unknown) => unknown) => action({})}));
vi.mock("@/server/auth/session", () => ({
  findViewer: server.findViewer, touchSession: vi.fn(),
  parseSession: (value: string | undefined) => value ? {familyId: "family", id: value} : null,
  sessionCookie: "owner", borrowedCookie: "borrowed",
}));
vi.mock("@/server/lists", () => ({
  ListError: class extends Error {},
  saveListSize: async (viewer: {actingAs: string}, ownerId: string, field: string, value: string) => {
    if (viewer.actingAs !== ownerId) throw new Error("Wrong owner");
    server.saved.set(`${ownerId}.${field}`, value);
  },
}));
vi.mock("@/server/lists/access", () => ({requireListEditor: server.requireListEditor}));
vi.mock("@/server/lists/link-preview", () => ({LinkError: class extends Error {}, resolveLinkPreview: server.resolveLinkPreview}));
vi.mock("@/server/lists/link-preview/draft", () => ({signLinkDraft: () => "preview-proof"}));

const owner = {familyId: "family", personId: "ana", actingAs: "ana", sessionId: "ana-session", isOrganizer: false};

beforeEach(() => {
  vi.resetAllMocks();
  server.jar.clear();
  server.saved.clear();
  server.jar.set("owner", "ana-session");
  server.jar.set("borrowed", "expired-rosa");
  server.findViewer.mockImplementation(async (_tx, session: {id: string}) => session.id === "ana-session" ? owner : null);
});

it("saves the owner's sizes after borrowing expires and clears only the stale cookie", async () => {
  await expect(saveProfileField("ana", "tops", "L", "size")).resolves.toEqual({status: "saved"});
  expect(server.saved.get("ana.tops")).toBe("L");
  expect(server.jar.get("owner")).toBe("ana-session");
  expect(server.jar.has("borrowed")).toBe(false);
});

it("previews the owner's gift link after borrowing expires and clears the stale cookie", async () => {
  server.resolveLinkPreview.mockResolvedValue({url: "https://shop.example/gift", title: "Gift", store: "Shop"});
  const result = await previewItemLink("ana", "https://shop.example/gift");
  expect(result.card).toMatchObject({title: "Gift", ticket: "preview-proof"});
  expect(server.requireListEditor).toHaveBeenCalledWith({}, owner, "ana");
  expect(server.jar.get("owner")).toBe("ana-session");
  expect(server.jar.has("borrowed")).toBe(false);
});
