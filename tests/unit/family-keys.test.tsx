// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import type {Prepared} from "../../src/app/[locale]/family/actions";

const {prepareKey} = vi.hoisted(() => ({prepareKey: vi.fn()}));
vi.mock("../../src/app/[locale]/family/actions", () => ({prepareKey, sentKey: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
}));

const {KeysList} = await import("../../src/app/[locale]/family/keys/key-row");
const people = [
  {id: "alex", name: "Alex", joined: false, sent: false},
  {id: "sam", name: "Sam", joined: false, sent: false},
];
let container: HTMLDivElement;
let root: Root;

function key(id: string): Prepared {
  return {key: {id, url: `https://example.com/key/${id}`, familyAddress: `https://example.com/en/sign-in?family=${id}`,
    code: "ABC234", message: "Your key", qr: `data:image/png;base64,${id}`, expiresAt: "2026-12-30T00:00:00Z"}};
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === text)!;
}

function printButton() {
  return container.querySelector<HTMLButtonElement>("section > div:last-child button")!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  prepareKey.mockReset();
  vi.spyOn(window, "print").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    <KeysList people={people} helped={[]} />
  </NextIntlClientProvider>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for every current card and prints its code and family address", async () => {
  const resolve: Array<(prepared: Prepared) => void> = [];
  prepareKey.mockImplementation(() => new Promise<Prepared>((done) => resolve.push(done)));
  await act(async () => button(en.draw.keys.printCards).click());
  expect(printButton().disabled).toBe(true);
  await act(async () => printButton().click());
  expect(window.print).not.toHaveBeenCalled();
  await act(async () => resolve[0](key("alex")));
  expect(printButton().disabled).toBe(true);
  await act(async () => resolve[1](key("sam")));
  expect(printButton().disabled).toBe(false);
  const cards = container.querySelectorAll("section li");
  expect(cards).toHaveLength(2);
  for (const [index, card] of [...cards].entries()) {
    expect(card.querySelector("img")).not.toBeNull();
    expect(card.textContent).toContain("ABC234");
    expect(card.textContent).toContain(key(people[index].id).key!.familyAddress);
  }
  await act(async () => printButton().click());
  expect(window.print).toHaveBeenCalledOnce();
  await act(async () => container.querySelector<HTMLButtonElement>("section button")!.click());
  await act(async () => button(en.draw.keys.printCards).click());
  expect(printButton().disabled).toBe(true);
  expect(container.querySelectorAll("section img")).toHaveLength(0);
  await act(async () => resolve[2](key("alex")));
  await act(async () => resolve[3](key("sam")));
});

it.each(["refusal", "exception"])("shows preparation %s and keeps printing disabled", async (failure) => {
  if (failure === "exception") prepareKey.mockRejectedValueOnce(new Error("offline"));
  else prepareKey.mockResolvedValueOnce({error: "unavailable"});
  prepareKey.mockResolvedValueOnce(key("sam"));
  await act(async () => button(en.draw.keys.printCards).click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(en.auth.feedback.unavailable);
  expect(printButton().disabled).toBe(true);
  await act(async () => printButton().click());
  expect(window.print).not.toHaveBeenCalled();
});
