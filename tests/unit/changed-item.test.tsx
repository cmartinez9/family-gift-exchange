// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {claimCommand} from "../../src/app/[locale]/lists/actions";
import {ChangedItem} from "../../src/app/[locale]/lists/getting/changed-item";
import {ItemPicture} from "../../src/components/ui/item-card";
import {dismissToast, ToastHost} from "../../src/components/ui/toast";

vi.mock("../../src/app/[locale]/lists/actions", () => ({claimCommand: vi.fn(), acknowledgeChange: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn().mockReturnValue({matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()});
  Element.prototype.animate = vi.fn().mockReturnValue({cancel() {}, onfinish: null});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { dismissToast(); root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(locale: "en" | "es" = "en", settled?: ReactNode) {
  const messages = locale === "en" ? en : es;
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Chicago">
      <ChangedItem actingAs="buyer" itemId="slippers" title="Slippers" ownerName="Ana" version="current"
        changes={[{field: "photo", hasPhoto: true}]} gold
        picture={<ItemPicture src="/current-picture.webp" alt="Slippers" />} settled={settled} />
      <ToastHost undoLabel={messages.ui.undo} />
    </NextIntlClientProvider>,
  ));
}

async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it.each(["en", "es"] as const)("shows a photo-only change and the current picture in %s", async (locale) => {
  await render(locale);
  const messages = locale === "en" ? en : es;
  expect(container.querySelector("h2")?.textContent).toBe(messages.lists.changed.title.replace("{name}", "Ana"));
  expect(container.querySelector('[data-changed="photo"]')?.textContent).toBe(messages.lists.changed.newPicture);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/current-picture.webp");
  expect(container.querySelector("del")).toBeNull();
});

it("carries the released progress through the toast Undo after the changed card unmounts", async () => {
  const released = {bought: true, wrapped: true};
  vi.mocked(claimCommand).mockResolvedValueOnce({released}).mockResolvedValueOnce({});
  await render();
  await click(en.lists.changed.letGo);
  expect(claimCommand).toHaveBeenNthCalledWith(1, "buyer", "slippers", "undo", false);
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
      <ToastHost undoLabel={en.ui.undo} />
    </NextIntlClientProvider>,
  ));
  await click(en.ui.undo);
  expect(claimCommand).toHaveBeenNthCalledWith(2, "buyer", "slippers", "claim", true, {released});
});
