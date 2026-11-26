// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {Reveal} from "../../src/app/[locale]/exchanges/reveal";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, className}: {href: string; children: ReactNode; className?: string}) =>
    <a href={href} className={className}>{children}</a>,
}));

let container: HTMLDivElement;
let root: Root;
const firstAlexId = "00000000-0000-4000-8000-000000000001";
const secondAlexId = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["en", "es"] as const)("links the revealed Alex to the exact assigned wishlist in %s", async (locale) => {
  const action = vi.fn().mockResolvedValue({personName: "Alex", personId: secondAlexId});
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es}>
      <Reveal action={action} />
    </NextIntlClientProvider>,
  ));
  expect(container.querySelector("a")).toBeNull();
  expect(action).not.toHaveBeenCalled();
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(action).toHaveBeenCalledOnce();
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe(`/lists/${secondAlexId}`);
  expect(link.getAttribute("href")).not.toBe(`/lists/${firstAlexId}`);
  expect(link.textContent).toBe(locale === "en" ? "Open Alex's wishlist" : "Ver la lista de Alex");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Alex");
});

it("keeps synthetic practice reveals inside practice", async () => {
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Reveal action={async () => ({personName: "Alex", personId: secondAlexId})} practice />
    </NextIntlClientProvider>,
  ));
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Alex");
  expect(container.querySelector("a")).toBeNull();
});
