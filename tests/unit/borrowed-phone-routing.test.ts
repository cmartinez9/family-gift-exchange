import {beforeEach, expect, it, vi} from "vitest";
import WelcomeListPage from "../../src/app/[locale]/welcome/list/page";
import WelcomeSizesPage from "../../src/app/[locale]/welcome/sizes/page";
import WelcomeMoreSizesPage from "../../src/app/[locale]/welcome/sizes/more/page";
import WelcomeDonePage from "../../src/app/[locale]/welcome/done/page";
import {requireViewer} from "../../src/server/auth";

const server = vi.hoisted(() => ({findViewer: vi.fn(), touchSession: vi.fn(), borrowedCookie: "borrowed" as string | undefined}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({cookies: async () => ({get: (name: string) =>
  name === "owner" ? {value: "owner"} : server.borrowedCookie ? {value: server.borrowedCookie} : undefined})}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));
vi.mock("next/navigation", () => ({redirect: (url: string) => { throw new Error(`redirect:${url}`); }}));
vi.mock("@/server/db/client", () => ({withFamily: (_family: string, action: (tx: unknown) => unknown) => action({})}));
vi.mock("@/server/auth/session", () => ({
  findViewer: server.findViewer, touchSession: server.touchSession,
  parseSession: () => ({familyId: "family"}), sessionCookie: "owner", borrowedCookie: "borrowed",
}));

vi.mock("../../src/app/[locale]/welcome/steps", () => ({AddStep: () => null, SizesStep: () => null}));
vi.mock("@/i18n/navigation", () => ({Link: () => null, useRouter: vi.fn()}));

const owner = {familyId: "family", sessionId: "ana", personId: "ana", actingAs: "ana", isOrganizer: false};
const guest = {...owner, sessionId: "rosa", personId: "rosa", actingAs: "rosa",
  borrowed: {lenderSessionId: "ana", lenderPersonId: "ana", hidden: false}};

beforeEach(() => {
  vi.resetAllMocks();
  server.borrowedCookie = "borrowed";
});

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

it.each(["reveal", "help"] as const)("returns an expired borrowed %s flow to the owner's Home", async (borrowed) => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
  await expect(requireViewer({borrowed})).rejects.toThrow("redirect:/en");
});

it("keeps ordinary onboarding available without a borrowed session", async () => {
  server.borrowedCookie = undefined;
  server.findViewer.mockResolvedValue(owner);
  await expect(requireViewer({borrowed: "help"})).resolves.toEqual(owner);
});

it.each([
  ["sizes", WelcomeSizesPage], ["more sizes", WelcomeMoreSizesPage], ["list", WelcomeListPage], ["done", WelcomeDonePage],
] as const)("leaves expired borrowed %s onboarding before selecting an editing target", async (_name, page) => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow(/^redirect:\/en$/);
});
