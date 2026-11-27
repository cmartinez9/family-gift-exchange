import {beforeEach, expect, it, vi} from "vitest";
import WelcomeListPage from "../../src/app/[locale]/welcome/list/page";
import WelcomeSizesPage from "../../src/app/[locale]/welcome/sizes/page";
import WelcomeMoreSizesPage from "../../src/app/[locale]/welcome/sizes/more/page";
import WelcomeDonePage from "../../src/app/[locale]/welcome/done/page";
import {requireWelcomeViewer} from "../../src/app/[locale]/welcome/viewer";
import {GET as finishExpiredBorrowing} from "../../src/app/[locale]/welcome/borrowed/expired/route";
import {requireViewer} from "../../src/server/auth";

const server = vi.hoisted(() => ({findViewer: vi.fn(), touchSession: vi.fn(), mySizes: vi.fn(), welcomeAssignment: vi.fn(),
  borrowedCookie: "borrowed" as string | undefined}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({cookies: async () => ({get: (name: string) =>
  name === "owner" ? {value: "owner"} : server.borrowedCookie ? {value: server.borrowedCookie} : undefined,
  set: (name: string) => { if (name === "borrowed") server.borrowedCookie = undefined; },
})}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));
vi.mock("next/navigation", () => ({redirect: (url: string) => { throw new Error(`redirect:${url}`); }}));
vi.mock("@/server/db/client", () => ({withFamily: (_family: string, action: (tx: unknown) => unknown) => action({})}));
vi.mock("@/server/auth/account", () => ({mySizes: server.mySizes}));
vi.mock("../../src/app/[locale]/welcome/assignment", () => ({welcomeAssignment: server.welcomeAssignment}));
vi.mock("@/server/auth/session", () => ({
  findViewer: server.findViewer, touchSession: server.touchSession,
  parseSession: (value: string | undefined) => value ? {familyId: "family"} : null, sessionCookie: "owner", borrowedCookie: "borrowed",
}));

vi.mock("../../src/app/[locale]/welcome/steps", () => ({AddStep: () => null, SizesStep: () => null}));
vi.mock("@/i18n/navigation", () => ({Link: () => null, useRouter: vi.fn()}));

const owner = {familyId: "family", sessionId: "ana", personId: "ana", actingAs: "ana", isOrganizer: false};
const guest = {...owner, sessionId: "rosa", personId: "rosa", actingAs: "rosa",
  borrowed: {lenderSessionId: "ana", lenderPersonId: "ana", hidden: false}};

beforeEach(() => {
  vi.resetAllMocks();
  server.borrowedCookie = "borrowed";
  server.mySizes.mockResolvedValue({noClothes: false, sizes: {tops: "L"}});
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
  await expect(requireWelcomeViewer({}, borrowed)).rejects.toThrow("redirect:/en/welcome/borrowed/expired");
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
  await expect(page()).rejects.toThrow(/^redirect:\/en\/welcome\/borrowed\/expired$/);
});


it("allows the owner's ordinary editing viewer after borrowing expires", async () => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
  await expect(requireViewer({borrowed: "help"})).resolves.toEqual(owner);
});

it("clears an expired borrowed cookie before returning Home", async () => {
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
  await expect(finishExpiredBorrowing()).rejects.toThrow(/^redirect:\/en$/);
  expect(server.borrowedCookie).toBeUndefined();
});

it("preserves a live borrowed session if the cleanup route is opened", async () => {
  const hidden = {...guest, borrowed: {...guest.borrowed, hidden: true}};
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(hidden);
  await expect(finishExpiredBorrowing()).rejects.toThrow("redirect:/en/welcome/done");
  expect(server.borrowedCookie).toBe("borrowed");
});

it("does not retarget old borrowed links after the expired cookie has been cleared", async () => {
  server.borrowedCookie = undefined;
  server.findViewer.mockResolvedValue(owner);
  await expect(WelcomeListPage({searchParams: Promise.resolve({borrowed: guest.sessionId})}))
    .rejects.toThrow("redirect:/en/welcome/borrowed/expired");
});

it.each([
  ["sizes", WelcomeSizesPage], ["list", WelcomeListPage],
] as const)("loads sealed borrowed %s onboarding without accessing the hidden match", async (_name, page) => {
  const hidden = {...guest, borrowed: {...guest.borrowed, hidden: true}};
  server.findViewer.mockResolvedValueOnce(owner).mockResolvedValueOnce(hidden);
  server.welcomeAssignment.mockRejectedValue(new Error("hidden match must stay sealed"));
  const screen = await page({searchParams: Promise.resolve({borrowed: guest.sessionId})});
  expect(screen.props).toMatchObject({ownerId: guest.personId, personOpened: false,
    replace: true, borrowedSessionId: guest.sessionId});
  expect(server.welcomeAssignment).not.toHaveBeenCalled();
});

it.each([
  ["sizes", WelcomeSizesPage], ["list", WelcomeListPage],
] as const)("retains the ordinary viewer's opened match status on the %s step", async (_name, page) => {
  server.borrowedCookie = undefined;
  server.findViewer.mockResolvedValue(owner);
  server.welcomeAssignment.mockResolvedValue({recipientId: "beto", version: 1});
  const screen = await page();
  expect(screen.props).toMatchObject({ownerId: owner.personId, personOpened: true,
    replace: false, borrowedSessionId: undefined});
  expect(server.welcomeAssignment).toHaveBeenCalledWith(owner);
});
