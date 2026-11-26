// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {renderServerTree} from "../helpers/render-server";

const {organizerExchange, drawFeasibility, readiness, viewer} = vi.hoisted(() => ({
  organizerExchange: vi.fn(), drawFeasibility: vi.fn(), readiness: vi.fn(),
  viewer: {familyId: "family", personId: "organizer", actingAs: "organizer", isOrganizer: true, sessionId: "session"},
}));
vi.mock("next-intl/server", async () => {
  const {createTranslator} = await import("next-intl");
  return {getFormatter: async () => ({}),
    getTranslations: async (namespace: keyof typeof en) => createTranslator({locale: "en", messages: en, namespace})};
});
vi.mock("next/navigation", () => ({notFound: () => { throw new Error("not found"); }}));
vi.mock("@/server/auth", () => ({requireViewer: async () => viewer}));
vi.mock("@/server/auth/families", () => ({readiness}));
vi.mock("@/server/db/client", () => ({withFamily: async (_id: string, action: (tx: object) => unknown) => action({})}));
vi.mock("@/server/draw", () => ({organizerExchange, drawFeasibility, DrawError: class extends Error {}}));
vi.mock("../../src/app/[locale]/exchanges/actions", () => ({manage: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn()}),
}));

const {default: DrawPage} = await import("../../src/app/[locale]/exchanges/[exchangeId]/manage/draw/page");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  organizerExchange.mockReset();
  drawFeasibility.mockReset().mockResolvedValue({possible: true, blocker: null, fewestChoices: 3, limitedChoices: 0});
  readiness.mockReset().mockResolvedValue({members: []});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(status: "open" | "drawn" | "locked" | "closed", version: number, participating = true) {
  organizerExchange.mockResolvedValue({
    exchange: {id: "exchange", name: "Christmas", status, version, seal: version ? "ABCD" : null,
      budgetAmount: null, giftDay: null, giftTime: null, place: "Community Hall", listDeadline: null},
    people: [{id: "organizer", displayName: "Organizer", participating},
      ...["Alex", "Sam", "Rosa", "Leo"].map((displayName) => ({id: displayName, displayName, participating: true}))],
  });
  const tree = await renderServerTree(await DrawPage({params: Promise.resolve({exchangeId: "exchange"})}));
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">{tree}</NextIntlClientProvider>));
}

it.each([
  ["drawn", true], ["drawn", false], ["locked", true], ["locked", false],
] as const)("shows the organizer's match only when participating in a %s exchange (%s)", async (status, participating) => {
  await render(status, 1, participating);
  expect(container.querySelector("h1")?.textContent).toBe(en.draw.setup.sealedTitle);
  expect(container.querySelector('a[href="/family/keys"]')?.textContent).toBe(en.draw.setup.nextKeys);
  const personalLink = container.querySelector('a[href="/exchanges/exchange"]');
  if (participating) {
    expect(container.textContent).toContain(en.draw.setup.ownPerson);
    expect(personalLink?.textContent).toBe(en.draw.yourPerson);
  } else {
    expect(container.textContent).not.toContain(en.draw.setup.ownPerson);
    expect(personalLink).toBeNull();
  }
  expect(drawFeasibility).not.toHaveBeenCalled();
});

it.each([0, 1])("shows a closed exchange with draw version %s without announcing a successful draw", async (version) => {
  await render("closed", version);
  expect(container.textContent).toContain(en.draw.closed);
  expect(container.textContent).toContain("Community Hall");
  expect(container.querySelector("h1")?.textContent).not.toBe(en.draw.setup.sealedTitle);
  expect(container.querySelector('a[href="/family/keys"]')).toBeNull();
  expect(container.querySelector('a[href="/exchanges/exchange"]')).toBeNull();
  expect(container.querySelector("[data-back-row] a")?.getAttribute("href")).toBe("/exchanges/exchange/manage");
  expect(drawFeasibility).not.toHaveBeenCalled();
  expect(readiness).not.toHaveBeenCalled();
});

it("keeps an undrawn open exchange ready to draw", async () => {
  await render("open", 0, false);
  expect(container.querySelector("h1")?.textContent).toBe(en.draw.ready);
  const draw = [...container.querySelectorAll("button")].find((button) => button.textContent === en.draw.drawNames)!;
  expect(draw.disabled).toBe(false);
  expect(container.querySelector('a[href="/family/keys"]')).toBeNull();
  expect(drawFeasibility).toHaveBeenCalledOnce();
});
