// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

const reveal = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, className}: {href: string; children: ReactNode; className?: string}) =>
    <a href={href} className={className}>{children}</a>,
  useRouter: () => ({replace: vi.fn(), push: vi.fn(), back: vi.fn()}),
}));
vi.mock("next/navigation", () => ({useRouter: () => ({replace: vi.fn(), push: vi.fn(), back: vi.fn()})}));
vi.mock("../../src/app/[locale]/exchanges/actions", () => ({reveal, memberAction: vi.fn()}));

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
  reveal.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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
