// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {renderServerTree} from "../helpers/render-server";

const {memberDrawStatus, listOwnQuestions, reveal, settings, viewer} = vi.hoisted(() => ({
  memberDrawStatus: vi.fn(), listOwnQuestions: vi.fn(), reveal: vi.fn(), settings: {locale: "en" as "en" | "es"},
  viewer: {familyId: "family", personId: "member", actingAs: "member", isOrganizer: false, sessionId: "session"},
}));
vi.mock("next-intl/server", async () => {
  const {createFormatter, createTranslator} = await import("next-intl");
  return {
    getFormatter: async () => createFormatter({locale: settings.locale, timeZone: "America/Chicago"}),
    getTranslations: async (namespace: keyof typeof en) => createTranslator({locale: settings.locale,
      messages: settings.locale === "en" ? en : es, namespace}),
  };
});
vi.mock("next/navigation", () => ({notFound: () => { throw new Error("not found"); }}));
vi.mock("@/server/auth", () => ({requireViewer: async () => viewer}));
vi.mock("@/server/draw", () => ({memberDrawStatus, listOwnQuestions, DrawError: class extends Error {}}));
vi.mock("../../src/app/[locale]/exchanges/actions", () => ({reveal, memberAction: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push: vi.fn()}),
}));

const {default: MemberExchangePage} = await import("../../src/app/[locale]/exchanges/[exchangeId]/page");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
  Element.prototype.animate ??= function () { return {cancel() {}, onfinish: null} as unknown as Animation; };
  Element.prototype.getAnimations ??= () => [];
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLDialogElement.prototype.close ??= function () { this.open = false; };
  reveal.mockReset().mockResolvedValue({personName: "Alex", personId: "alex", list: {items: [], sizes: null, likes: null}});
  listOwnQuestions.mockResolvedValue({version: 1, incoming: [], outgoing: []});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(text: string) {
  return [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === text)!;
}

function expectFacts(locale: "en" | "es") {
  const messages = locale === "en" ? en : es;
  const details = container.querySelector(`section[aria-label="${messages.draw.detailsTitle}"]`)!;
  expect(details).not.toBeNull();
  expect(details.textContent).toContain(messages.draw.giftDay);
  expect(details.textContent).toContain(messages.draw.setup.listsReadyBy);
  for (const date of ["2026-12-24", "2026-12-05"]) {
    expect(details.querySelector(`time[datetime="${date}"]`)?.textContent).toBe(
      new Intl.DateTimeFormat(locale, {dateStyle: "full", timeZone: "UTC"}).format(new Date(`${date}T00:00:00Z`)));
  }
  expect(details.querySelector('time[datetime="19:30"]')?.textContent).toBe(
    new Intl.DateTimeFormat(locale, {timeStyle: "short", timeZone: "UTC"}).format(new Date("2000-01-01T19:30:00Z")));
  expect(details.textContent).toContain("Community Hall");
  expect(details.querySelector("button, input, a")).toBeNull();
}

it.each([
  ["en", false], ["en", true], ["es", false], ["es", true],
] as const)("keeps saved schedule facts on a %s member's drawn exchange (seen: %s)", async (locale, seen) => {
  settings.locale = locale;
  memberDrawStatus.mockResolvedValue({status: "ready", seen, canReport: false, subjectName: "Sam",
    exchange: {id: "exchange", name: "Christmas", version: 1, status: "drawn", giftDay: "2026-12-24",
      giftTime: "19:30:00", listDeadline: "2026-12-05", place: "Community Hall", budgetAmount: "50.00"}});
  const tree = await renderServerTree(await MemberExchangePage({params: Promise.resolve({exchangeId: "exchange"}), searchParams: Promise.resolve({})}));
  await act(async () => root.render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es}
    timeZone="America/Chicago">{tree}</NextIntlClientProvider>));
  expectFacts(locale);
  expect(reveal).not.toHaveBeenCalled();
  const messages = locale === "en" ? en : es;
  await act(async () => button(seen ? messages.draw.reveal : messages.draw.person.revealTap).click());
  if (!seen) {
    await act(async () => button(messages.draw.person.seePage.replace("{name}", "Alex")).click());
  }
  expectFacts(locale);
  expect(container.querySelector('a[href="/lists/alex"]')).not.toBeNull();
  expect(container.querySelector('a[href*="/manage"]')).toBeNull();
  expect(memberDrawStatus).toHaveBeenLastCalledWith(viewer, "exchange");
});
