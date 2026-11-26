// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

const {reveal, memberAction} = vi.hoisted(() => ({reveal: vi.fn(), memberAction: vi.fn()}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, className}: {href: string; children: ReactNode; className?: string}) =>
    <a href={href} className={className}>{children}</a>,
  useRouter: () => ({replace: vi.fn(), push: vi.fn(), back: vi.fn()}),
}));
vi.mock("next/navigation", () => ({useRouter: () => ({replace: vi.fn(), push: vi.fn(), back: vi.fn()})}));
vi.mock("../../src/app/[locale]/exchanges/actions", () => ({reveal, memberAction}));

const {MemberPerson} = await import("../../src/app/[locale]/exchanges/person");

let container: HTMLDivElement;
let root: Root;
const firstAlexId = "00000000-0000-4000-8000-000000000001";
const secondAlexId = "00000000-0000-4000-8000-000000000002";
const context = {id: "00000000-0000-4000-8000-000000000009", subject: firstAlexId, version: 1};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // reduced motion: the gift opens at once, with no animation to wait for
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
  Element.prototype.animate ??= function animate() {
    return {cancel: () => {}, finished: Promise.resolve(), onfinish: null} as unknown as Animation;
  };
  Element.prototype.getAnimations ??= () => [];
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLDialogElement.prototype.close ??= function () { this.open = false; };
  reveal.mockReset();
  memberAction.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function page(locale: "en" | "es", seen: boolean, practice = false) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="UTC">
      <MemberPerson context={practice ? {...context, practice: true} : context} seen={seen} canReport={false} canAsk={seen}
        budget={50} outgoing={[]} incoming={[]} back="/" backLabel="Home" answerHref="?answer=1" />
    </NextIntlClientProvider>
  );
}

function button(name: string) {
  return [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)!;
}

it.each(["en", "es"] as const)("opens the revealed Alex and links to the exact assigned wishlist in %s", async (locale) => {
  reveal.mockResolvedValue({personName: "Alex", personId: secondAlexId, list: {items: [], sizes: "Tops L", likes: null}});
  await act(async () => root.render(page(locale, true)));
  expect(container.querySelector('a[href^="/lists/"]')).toBeNull();
  expect(reveal).not.toHaveBeenCalled();
  await act(async () => button(locale === "en" ? "Open your person" : "Descubrir a tu persona").click());
  expect(reveal).toHaveBeenCalledOnce();
  const link = container.querySelector<HTMLAnchorElement>('a[href^="/lists/"]')!;
  expect(link.getAttribute("href")).toBe(`/lists/${secondAlexId}`);
  expect(link.getAttribute("href")).not.toBe(`/lists/${firstAlexId}`);
  expect(link.textContent).toBe(locale === "en" ? "Open Alex's wishlist" : "Ver la lista de Alex");
  expect(container.querySelector("h1")?.textContent).toContain("Alex");
  expect(container.textContent).toContain("Tops L");
});

it("waits for the name while the gift unravels, then shows your person's page", async () => {
  let resolve: (value: unknown) => void = () => {};
  reveal.mockReturnValue(new Promise((done) => { resolve = done; }));
  await act(async () => root.render(page("en", false)));
  await act(async () => button("Or tap here to open it").click());
  expect(reveal).toHaveBeenCalledOnce();
  expect(button("See Alex’s page")).toBeUndefined();
  await act(async () => resolve({personName: "Alex", personId: secondAlexId, list: {items: [], sizes: null, likes: null}}));
  await act(async () => button("See Alex’s page").click());
  expect(container.querySelector("h1")?.textContent).toContain("Alex");
  expect(container.querySelector('a[href^="/lists/"]')?.getAttribute("href")).toBe(`/lists/${secondAlexId}`);
});

it("keeps synthetic practice reveals inside practice", async () => {
  reveal.mockResolvedValue({personName: "Alex", personId: secondAlexId});
  await act(async () => root.render(page("en", true, true)));
  await act(async () => button("Open your person").click());
  expect(container.querySelector("h1")?.textContent).toContain("Alex");
  expect(container.querySelector('a[href^="/lists/"]')).toBeNull();
});

it("keeps Ask open when reopened after a successful question", async () => {
  const animations: Array<{onfinish: (() => void) | null}> = [];
  vi.spyOn(Element.prototype, "animate").mockImplementation(() => {
    const animation = {cancel() {}, onfinish: null};
    animations.push(animation);
    return animation as unknown as Animation;
  });
  reveal.mockResolvedValue({personName: "Alex", personId: secondAlexId});
  memberAction.mockResolvedValue({feedback: "Question sent"});
  await act(async () => root.render(page("en", true)));
  await act(async () => button("Open your person").click());
  const ask = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes("Ask Alex"))!;
  await act(async () => ask.click());
  await act(async () => button(en.draw.person.suggestions.size).click());
  const form = container.querySelector("dialog form")!;
  await act(async () => form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
  expect(memberAction).toHaveBeenCalledOnce();
  await act(async () => animations.splice(0).forEach((animation) => animation.onfinish?.()));
  expect(container.querySelector("dialog")?.open).toBe(false);
  await act(async () => ask.click());
  await act(async () => animations.splice(0).forEach((animation) => animation.onfinish?.()));
  expect(container.querySelector("dialog")?.open).toBe(true);
  expect(container.querySelector<HTMLTextAreaElement>("dialog textarea")?.value).toBe("");
  expect(memberAction).toHaveBeenCalledOnce();
});

it("announces the name that arrives during the normal-motion tap animation", async () => {
  vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  const frames = new Map<number, FrameRequestCallback>();
  let frame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  let resolve: (value: unknown) => void = () => {};
  reveal.mockReturnValue(new Promise((done) => { resolve = done; }));
  await act(async () => root.render(page("en", false)));
  await act(async () => button("Or tap here to open it").click());
  await act(async () => resolve({personName: "Alex", personId: secondAlexId}));
  const start = performance.now();
  for (const elapsed of [1200, 2400, 10000]) {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach((callback) => callback(start + elapsed)));
  }
  expect(container.querySelector('[data-reveal="revealed"]')).not.toBeNull();
  expect(container.querySelector('[aria-live="assertive"]')?.textContent).toBe("You’re giving to Alex");
});
