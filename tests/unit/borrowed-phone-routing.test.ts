import {beforeEach, expect, it, vi} from "vitest";
import {requireViewer} from "../../src/server/auth";

const server = vi.hoisted(() => ({findViewer: vi.fn(), touchSession: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({cookies: async () => ({get: () => ({value: "owner"})})}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));
vi.mock("next/navigation", () => ({redirect: (url: string) => { throw new Error(`redirect:${url}`); }}));
vi.mock("@/server/db/client", () => ({withFamily: (_family: string, action: (tx: unknown) => unknown) => action({})}));
vi.mock("@/server/auth/session", () => ({
  findViewer: server.findViewer, touchSession: server.touchSession,
  parseSession: () => ({familyId: "family"}), sessionCookie: "owner", borrowedCookie: "borrowed",
}));

const owner = {familyId: "family", sessionId: "ana", personId: "ana", actingAs: "ana", isOrganizer: false};
const guest = {...owner, sessionId: "rosa", personId: "rosa", actingAs: "rosa",
  borrowed: {lenderSessionId: "ana", lenderPersonId: "ana", hidden: false}};

beforeEach(() => vi.resetAllMocks());

it.each([false, true])("routes a borrowed viewer away from ordinary pages (hidden=%s)", async (hidden) => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce({...guest, borrowed: {...guest.borrowed, hidden}});
  await expect(requireViewer()).rejects.toThrow(`redirect:/en/welcome/${hidden ? "done" : "borrowed"}`);
});

it("keeps sizes and list help behind hand-back sealing", async () => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(guest);
  await expect(requireViewer({borrowed: "help"})).rejects.toThrow("redirect:/en/welcome/borrowed");
});

it("allows onboarding help once the person is sealed", async () => {
  const hidden = {...guest, borrowed: {...guest.borrowed, hidden: true}};
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(hidden);
  await expect(requireViewer({borrowed: "help"})).resolves.toEqual(hidden);
});

it("allows the borrowed reveal before sealing", async () => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(guest);
  await expect(requireViewer({borrowed: "reveal"})).resolves.toEqual(guest);
});
