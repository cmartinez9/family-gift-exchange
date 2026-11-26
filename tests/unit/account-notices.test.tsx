// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {renderToStaticMarkup} from "react-dom/server";
import {createTranslator, NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import AccountPage from "../../src/app/[locale]/account/page";
import NoticesPage from "../../src/app/[locale]/account/notices/page";

const server = vi.hoisted(() => ({
  requireViewer: vi.fn(), account: vi.fn(), youSummary: vi.fn(), mySizes: vi.fn(), listNotifications: vi.fn(), getUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({requireViewer: server.requireViewer}));
vi.mock("@/server/auth/account", () => ({youSummary: server.youSummary, mySizes: server.mySizes}));
vi.mock("@/server/auth/security", () => ({account: server.account, actFor: vi.fn(), disputeEvent: vi.fn(), endSessions: vi.fn()}));
vi.mock("@/server/auth/request", () => ({currentDeviceKind: async () => "iphone", clearSession: vi.fn()}));
vi.mock("@/server/auth/access", () => ({lockFamily: vi.fn()}));
vi.mock("@/server/auth/session", () => ({revalidateViewer: vi.fn(), uuidPattern: /^[a-z]+$/}));
vi.mock("@/server/db/client", () => ({withFamily: (_: string, run: () => unknown) => run()}));
vi.mock("@/server/lists/claims", () => ({getGettingList: async () => []}));
vi.mock("@/server/messages/inbox", () => ({
  listNotifications: server.listNotifications, getUnreadCount: server.getUnreadCount, markNotificationRead: server.markNotificationRead,
}));
vi.mock("next/cache", () => ({revalidatePath: server.revalidatePath}));
vi.mock("next/navigation", () => ({redirect: server.redirect}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: keyof typeof en | `getIn.${keyof typeof en.getIn}`) => createTranslator({locale: "en", messages: en, namespace}),
  getFormatter: async () => ({dateTime: () => "Dec 1"}),
}));
vi.mock("../../src/app/[locale]/sign-in/actions", () => ({}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn(), replace: vi.fn()}),
}));

const viewer = {familyId: "family", personId: "organizer", actingAs: "organizer", isOrganizer: true};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
  server.requireViewer.mockResolvedValue(viewer);
  server.account.mockResolvedValue({name: "Rosa", helpers: [], activity: []});
  server.youSummary.mockResolvedValue({familyName: "Family", sizes: {shoes: "7.5"}, noClothes: false, devices: 1, faceId: false});
  server.listNotifications.mockResolvedValue([]);
  server.getUnreadCount.mockResolvedValue(0);
  server.markNotificationRead.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function intl(node: ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">{node}</NextIntlClientProvider>;
}

it("renders saved shoe sizes in the server account summary", async () => {
  const page = await AccountPage({searchParams: Promise.resolve({})});
  container.innerHTML = renderToStaticMarkup(intl(page));
  const sizes = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/lists/organizer/profile");
  expect(sizes?.textContent).toBe("My sizesShoes 7½");
});

it.each([false, true])("shows the helped person's sizes and clothing preference (%s) with the helper's devices", async (noClothes) => {
  const helping = {...viewer, personId: "ana", actingAs: "leo", isOrganizer: false};
  server.requireViewer.mockResolvedValue(helping);
  server.account.mockResolvedValue({name: "Ana", helpers: [{id: "leo", name: "Leo"}], activity: []});
  server.youSummary.mockResolvedValue({familyName: "Family", sizes: {tops: "L", shoes: "7.5"}, noClothes: !noClothes, devices: 3, faceId: true});
  server.mySizes.mockImplementation(async (_tx, _family, personId) => {
    expect(personId).toBe("leo");
    return {sizes: {tops: "XS", shoes: "2C"}, noClothes};
  });
  const page = await AccountPage({searchParams: Promise.resolve({})});
  container.innerHTML = renderToStaticMarkup(intl(page));
  const profile = container.querySelector('a[href="/lists/leo/profile"]');
  expect(profile?.textContent).toBe(`My sizes${noClothes ? en.getIn.sizes.noClothes : "Tops XS · Shoes 2C"}`);
  expect(container.querySelector("h1")?.textContent).toBe("Ana");
  expect(container.querySelector('a[href="/account/phones"]')?.textContent).toBe("Your phones3 signed in");
  expect(container.textContent).toContain("On for this iPhone");
  expect(server.youSummary).toHaveBeenCalledWith(undefined, helping, expect.any(Date));
});

it("marks an unread reset request before navigating to Family", async () => {
  server.listNotifications.mockResolvedValue([{
    id: "notice", title: "Ana needs a new PIN", body: "Send a replacement key", createdAt: new Date("2030-12-01"),
    isRead: false, isPinResetRequest: true, language: "en",
  }]);
  const marked = Promise.withResolvers<void>();
  server.markNotificationRead.mockReturnValue(marked.promise);
  const page = await NoticesPage();
  await act(async () => root.render(intl(page)));
  const notice = container.querySelector<HTMLButtonElement>('[data-notice="message"] button');
  expect(notice?.textContent).toContain("Ana needs a new PIN");
  await act(async () => notice!.click());
  expect(server.markNotificationRead).toHaveBeenCalledExactlyOnceWith(viewer, "notice");
  expect(server.redirect).not.toHaveBeenCalled();
  await act(async () => marked.resolve());
  expect(server.revalidatePath).toHaveBeenCalledWith("/[locale]/account", "layout");
  expect(server.redirect).toHaveBeenCalledExactlyOnceWith("/en/family");
});

it("keeps read reset requests linked to Family", async () => {
  server.listNotifications.mockResolvedValue([{
    id: "notice", title: "Ana needs a new PIN", body: "Send a replacement key", createdAt: new Date("2030-12-01"),
    isRead: true, isPinResetRequest: true, language: "en",
  }]);
  const page = await NoticesPage();
  await act(async () => root.render(intl(page)));
  const notice = container.querySelector<HTMLAnchorElement>('[data-notice="message"] a');
  expect(notice?.getAttribute("href")).toBe("/family");
  expect(notice?.textContent).toContain("Ana needs a new PIN");
  expect(server.markNotificationRead).not.toHaveBeenCalled();
});
