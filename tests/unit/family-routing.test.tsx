import type {ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {NextIntlClientProvider} from "next-intl";
import {beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {renderServerTree} from "../helpers/render-server";

const {readiness, listExchanges, redirect} = vi.hoisted(() => ({
  readiness: vi.fn(), listExchanges: vi.fn(), redirect: vi.fn((href: string) => { throw new Error(href); }),
}));
vi.mock("next/navigation", () => ({redirect, notFound: () => { throw new Error("not found"); }}));
vi.mock("next-intl/server", async () => {
  const {createTranslator} = await import("next-intl");
  return {getLocale: async () => "en", getFormatter: async () => ({}),
    getTranslations: async (namespace: keyof typeof en) => createTranslator({locale: "en", messages: en, namespace})};
});
vi.mock("@/server/auth", () => ({requireViewer: async () => ({familyId: "family", personId: "organizer"})}));
vi.mock("@/server/auth/families", () => ({readiness}));
vi.mock("@/server/db/client", () => ({withFamily: async (_id: string, action: (tx: object) => unknown) => action({})}));
vi.mock("@/server/draw", () => ({listExchanges}));
vi.mock("@/server/messages/inbox", () => ({getUnreadCount: async () => 0}));
vi.mock("../../src/app/[locale]/family/actions", () => ({
  deleteMember: vi.fn(), updateCoOrganizer: vi.fn(), updateHousehold: vi.fn(), updateMember: vi.fn(), updatePair: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn()}),
}));

const {default: FamilyPage} = await import("../../src/app/[locale]/family/page");

beforeEach(() => {
  redirect.mockClear();
  readiness.mockResolvedValue({familyName: "Riveras", exchangeId: "exchange", constraintsOpen: true,
    members: [], devices: [], groups: [], pairs: [], requests: [], sent: [], activity: []});
});

it("leads a new family's setup with the exchange details while keeping the family manageable", async () => {
  listExchanges.mockResolvedValue([{id: "exchange", status: "setup"}]);
  const tree = await renderServerTree(await FamilyPage());
  const markup = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{tree}</NextIntlClientProvider>);
  expect(redirect).not.toHaveBeenCalled();
  expect(markup).toContain('href="/exchanges/exchange/manage"');
  expect(markup).toContain(en.draw.setup.startExchange);
  expect(markup).toContain("Add a person");
});

it("keeps the family add-person form available after details are saved", async () => {
  listExchanges.mockResolvedValue([{id: "exchange", status: "open"}]);
  const tree = await renderServerTree(await FamilyPage());
  const markup = renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{tree}</NextIntlClientProvider>);
  expect(redirect).not.toHaveBeenCalled();
  expect(markup).toContain("Who lives where?");
  expect(markup).toContain("Add a person");
  expect(markup).toContain('name="name"');
});
