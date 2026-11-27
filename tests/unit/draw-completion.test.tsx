// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {renderServerTree} from "../helpers/render-server";

const {organizerExchange, drawFeasibility, readiness, listFamilyWishlists, viewer} = vi.hoisted(() => ({
  organizerExchange: vi.fn(), drawFeasibility: vi.fn(), readiness: vi.fn(), listFamilyWishlists: vi.fn(),
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
vi.mock("@/server/lists", () => ({listFamilyWishlists}));
vi.mock("@/server/messages", () => ({nudgedToday: async () => []}));
vi.mock("../../src/app/[locale]/exchanges/nudge-actions", () => ({nudgePerson: vi.fn(), remindUnopenedPeople: vi.fn()}));
vi.mock("../../src/app/[locale]/exchanges/actions", () => ({manage: vi.fn(), saveRosterAndContinue: vi.fn()}));
vi.mock("../../src/app/[locale]/family/actions", () => ({addNames: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn()}),
}));

const {default: DrawPage} = await import("../../src/app/[locale]/exchanges/[exchangeId]/manage/draw/page");
const {default: ExchangeDetailsPage} = await import("../../src/app/[locale]/exchanges/[exchangeId]/manage/details/page");
const {default: PeoplePage} = await import("../../src/app/[locale]/exchanges/[exchangeId]/manage/people/page");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  organizerExchange.mockReset();
  drawFeasibility.mockReset().mockResolvedValue({possible: true, blocker: null, fewestChoices: 3, limitedChoices: 0});
  readiness.mockReset().mockResolvedValue({members: ["organizer", "Alex", "Sam", "Rosa", "Leo"].map((id) => ({id, name: id})), sent: []});
  listFamilyWishlists.mockReset().mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(status: "open" | "drawn" | "locked" | "closed", version: number, participating = true, page = DrawPage) {
  organizerExchange.mockResolvedValue({
    exchange: {id: "exchange", name: "Christmas", status, version, seal: version ? "ABCD" : null,
      budgetAmount: null, giftDay: null, giftTime: null, place: "Community Hall", listDeadline: null},
    people: [{id: "organizer", displayName: "Organizer", participating},
      ...["Alex", "Sam", "Rosa", "Leo"].map((displayName) => ({id: displayName, displayName, participating: true}))],
  });
  const tree = await renderServerTree(await page({params: Promise.resolve({exchangeId: "exchange"})}));
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

it.each([
  ["details", 0, ExchangeDetailsPage], ["details", 1, ExchangeDetailsPage],
  ["people", 0, PeoplePage], ["people", 1, PeoplePage],
] as const)("shows closed facts instead of the %s editor for draw version %s", async (_name, version, page) => {
  await render("closed", version, true, page);
  expect(container.textContent).toContain(en.draw.closed);
  expect(container.textContent).toContain("Community Hall");
  expect(container.querySelector("form, input, select, button")).toBeNull();
  const back = container.querySelector("[data-back-row] a");
  expect(back?.getAttribute("href")).toBe("/exchanges/exchange/manage");
  expect(back?.textContent).toContain("Christmas");
  expect(readiness).not.toHaveBeenCalled();
  expect(listFamilyWishlists).not.toHaveBeenCalled();
});

it("keeps details editable while the exchange is active", async () => {
  await render("drawn", 1, true, ExchangeDetailsPage);
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe("Christmas");
  const save = [...container.querySelectorAll("button")].find((button) => button.textContent === en.draw.saveDetails)!;
  expect(save.disabled).toBe(false);
  expect(container.textContent).not.toContain(en.draw.closed);
});

it("keeps the roster setup available before an active exchange is drawn", async () => {
  await render("open", 0, true, PeoplePage);
  expect(container.querySelector("h1")?.textContent).toBe(en.draw.setup.peopleTitle);
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(5);
  const next = [...container.querySelectorAll("button")].find((button) => button.textContent === en.draw.setup.nextHouses)!;
  expect(next.disabled).toBe(false);
});

it.each(["drawn", "locked"] as const)("keeps the same list nudge controls in a %s exchange", async (status) => {
  listFamilyWishlists.mockResolvedValue([{id: "Alex", itemCount: 2, ready: true}]);
  await render(status, 1, true, PeoplePage);
  expect(container.querySelector("h1")?.textContent).toBe(en.draw.season.whosIn);
  expect(container.textContent).toContain("Alex");
  expect(container.querySelector("form")).toBeNull();
  expect(listFamilyWishlists).toHaveBeenCalledWith(viewer);
  const alex = [...container.querySelectorAll("li")].find((row) => row.textContent?.includes("Alex"))!;
  expect(alex.textContent).toContain(en.draw.season.listReady);
  expect(alex.querySelector("button")).toBeNull();
  const leo = [...container.querySelectorAll("li")].find((row) => row.textContent?.includes("Leo"))!;
  expect(leo.textContent).toContain(en.draw.season.notStarted);
  expect(leo.querySelector("button")?.getAttribute("aria-label")).toBe("Nudge Leo");
  const bulk = [...container.querySelectorAll("button")].filter((button) => button.textContent === en.draw.season.remindUnopened);
  expect(bulk).toHaveLength(1);
  expect([...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent).sort())
    .toEqual(["Nudge Sam", "Nudge Rosa", "Nudge Leo", en.draw.season.remindUnopened].sort());
});
