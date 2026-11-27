// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {renderServerTree} from "../helpers/render-server";

const {practiceMemberView, push, settings} = vi.hoisted(() => ({
  practiceMemberView: vi.fn(), push: vi.fn(), settings: {locale: "en" as "en" | "es"},
}));
vi.mock("next-intl/server", async () => {
  const {createTranslator} = await import("next-intl");
  return {getLocale: async () => settings.locale, getFormatter: async () => ({}),
    getTranslations: async (namespace: keyof typeof en) => createTranslator({
      locale: settings.locale, messages: settings.locale === "en" ? en : es, namespace,
    })};
});
vi.mock("next/navigation", () => ({notFound: () => { throw new Error("not found"); }}));
vi.mock("@/server/auth", () => ({requireViewer: async () => ({personId: "organizer"})}));
vi.mock("@/server/draw", () => ({
  practiceMemberView, practiceSeason: vi.fn(), redrawConfirmation: {}, DrawError: class extends Error {},
}));
vi.mock("../../src/app/[locale]/exchanges/actions", () => ({
  beginPractice: vi.fn(), managePractice: vi.fn(), memberAction: vi.fn(), reveal: vi.fn(), readPersonList: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
  useRouter: () => ({push}),
}));

const {default: PracticePage} = await import("../../src/app/[locale]/exchanges/practice/page");
const {PersonStatusScreen} = await import("../../src/app/[locale]/exchanges/components");
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
  push.mockReset();
  settings.locale = "en";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  const tree = await renderServerTree(node);
  await act(async () => root.render(<NextIntlClientProvider locale={settings.locale}
    messages={settings.locale === "en" ? en : es} timeZone="UTC">{tree}</NextIntlClientProvider>));
}

it.each([
  ["en", "waiting"], ["es", "waiting"], ["en", "notParticipating"], ["en", "closed"],
] as const)("keeps the %s practice %s screen and back swipe inside the rehearsal", async (locale, status) => {
  settings.locale = locale;
  practiceMemberView.mockResolvedValue({status: {status, subjectName: "Pinewisp",
    exchange: {name: "Practice exchange", budgetAmount: null, giftDay: null, place: null, listDeadline: null}}, questions: null});
  await render(await PracticePage({searchParams: Promise.resolve({as: "pinewisp"})}));
  const messages = locale === "en" ? en : es;
  const banner = container.querySelector("[data-mode-banner]")!;
  expect(banner.textContent).toContain(messages.draw.practiceViewing.replace("{name}", "Pinewisp"));
  expect(banner.querySelector("a")?.getAttribute("href")).toBe("/exchanges/practice");
  const back = container.querySelector("[data-back-row] a")!;
  expect(back.textContent).toContain(messages.draw.practiceTitle);
  expect(back.getAttribute("href")).toBe("/exchanges/practice");
  expect(container.textContent).toContain(messages.draw[status]);

  const page = container.querySelector<HTMLDivElement>("[data-edge-swipe]")!;
  page.setPointerCapture = vi.fn();
  const animation = {onfinish: null as (() => void) | null};
  page.animate = vi.fn(() => animation as unknown as Animation);
  await act(async () => {
    for (const [type, clientX] of [["pointerdown", 10], ["pointermove", 180], ["pointerup", 180]] as const) {
      page.dispatchEvent(new PointerEvent(type, {pointerId: 1, button: 0, clientX, clientY: 100, bubbles: true}));
    }
    animation.onfinish?.();
  });
  expect(push).toHaveBeenCalledExactlyOnceWith("/exchanges/practice");
});

it("returns a real exchange's waiting screen home", async () => {
  await render(await PersonStatusScreen({status: "waiting"}));
  expect(container.querySelector("[data-mode-banner]")).toBeNull();
  expect(container.querySelector("[data-back-row] a")?.getAttribute("href")).toBe("/");
  expect(container.querySelector("[data-back-row]")?.textContent).toContain(en.draw.person.backHome);
});

it.each([
  ["en", "answer"], ["es", "answer"], ["en", "fixed"], ["es", "fixed"], ["en", "person"], ["es", "person"],
] as const)("keeps one practice banner and a Stop action on the %s %s view", async (locale, view) => {
  settings.locale = locale;
  practiceMemberView.mockResolvedValue({status: {status: "ready", subjectName: "Pinewisp", seen: view === "person", canReport: false,
    exchange: {id: "practice", version: 1, budgetAmount: null}},
    questions: {version: 1, incoming: [{id: "question", text: "Any favorite colors?", answered: false}], outgoing: []}});
  await render(await PracticePage({searchParams: Promise.resolve({as: "pinewisp",
    ...(view === "answer" ? {answer: "1"} : view === "fixed" ? {fixed: "1"} : {})})}));
  const messages = locale === "en" ? en : es;
  const banners = container.querySelectorAll("[data-mode-banner]");
  expect(banners).toHaveLength(1);
  expect(banners[0].textContent).toContain(messages.draw.practiceViewing.replace("{name}", "Pinewisp"));
  const stop = banners[0].querySelector("a");
  expect(stop?.textContent).toBe(messages.draw.setup.stop);
  expect(stop?.getAttribute("href")).toBe("/exchanges/practice");
  const heading = view === "answer" ? messages.draw.person.incomingTitle
    : view === "fixed" ? messages.draw.person.fixedTitle : messages.draw.yourPerson;
  expect(container.querySelector("h1")?.textContent).toBe(heading);
});
