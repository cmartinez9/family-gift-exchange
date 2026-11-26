// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {ClaimItem} from "../../src/app/[locale]/lists/[personId]/claim-item";
import {OwnList} from "../../src/app/[locale]/lists/[personId]/own-list";
import {removeItem, saveItem, setItemStar} from "../../src/app/[locale]/lists/actions";
import {ItemThumb, toItemView, type ListItemView} from "../../src/app/[locale]/lists/item-view";
import {dismissToast, ToastHost} from "../../src/components/ui/toast";

vi.mock("../../src/app/[locale]/lists/actions", () => ({
  itemCommand: vi.fn(), removeItem: vi.fn(), setItemStar: vi.fn(), saveItem: vi.fn(), previewItemLink: vi.fn(), claimCommand: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, transitionTypes, ...rest}: {href: string; children: ReactNode; transitionTypes?: string[]}) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>{children}</a>
  ),
}));

const ownerId = "owner";
const item: ListItemView = {id: "item", kind: "note", title: "Tea tin", note: null, price: null, store: null, starred: false, url: null};
let container: HTMLDivElement;
let root: Root;
let items: ListItemView[];
let showingList: boolean;

function screen() {
  return <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    {showingList && <OwnList ownerId={ownerId} items={items} sizes={null} closeLabel="Close" />}
    <ToastHost undoLabel="Undo" />
  </NextIntlClientProvider>;
}

async function render(node: ReactNode = screen()) {
  await act(async () => root.render(node));
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn().mockReturnValue({matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()});
  Element.prototype.animate = vi.fn().mockReturnValue({cancel() {}, onfinish: null});
  Element.prototype.getAnimations = () => [];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  items = [{...item}];
  showingList = true;
  vi.mocked(removeItem).mockResolvedValue({status: "saved"});
  vi.mocked(setItemStar).mockImplementation(async (_owner, id, starred) => {
    items = items.map((entry) => entry.id === id ? {...entry, starred} : entry);
    root.render(screen());
    return {status: "saved"};
  });
  vi.mocked(saveItem).mockImplementation(async (_owner, id, _kind, _stay, _previous, form) => {
    items = items.map((entry) => entry.id === id ? {...entry, starred: form.get("starred") === "on"} : entry);
    root.render(screen());
    return {status: "saved"};
  });
});

afterEach(async () => {
  await act(async () => { dismissToast(); root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function takeOff() {
  await click(container.querySelector<HTMLElement>("article a")!);
  const remove = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === en.lists.deleteItem)!;
  await click(remove);
}

it("keeps Undo effective after leaving the list or hiding the page", async () => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  expect(container.querySelector("article")).toBeNull();
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  showingList = false;
  await render();
  expect(removeItem).not.toHaveBeenCalled();
  await click(container.querySelector<HTMLButtonElement>(".fge-toast button")!);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(removeItem).not.toHaveBeenCalled();
  showingList = true;
  await render();
  expect(container.querySelector("article")?.textContent).toContain(item.title);
});

it("commits a removal once after leaving its Undo window unused", async () => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  showingList = false;
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(4900));
  expect(removeItem).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1100));
  expect(removeItem).toHaveBeenCalledExactlyOnceWith(ownerId, item.id);
});

it("uses the edited heart value after a prior optimistic toggle", async () => {
  await render();
  await click(container.querySelector<HTMLButtonElement>("article button[aria-pressed]")!);
  expect(setItemStar).toHaveBeenCalledWith(ownerId, item.id, true);
  expect(container.querySelector("article button[aria-pressed]")?.getAttribute("aria-pressed")).toBe("true");
  await click(container.querySelector<HTMLElement>("article a")!);
  const checkbox = container.querySelector<HTMLInputElement>('input[name="starred"]')!;
  expect(checkbox.checked).toBe(true);
  await click(checkbox);
  await act(async () => container.querySelector<HTMLFormElement>("[data-item-form]")!.requestSubmit());
  expect(saveItem).toHaveBeenCalledOnce();
  expect(container.querySelector("article button[aria-pressed]")?.getAttribute("aria-pressed")).toBe("false");
  await click(container.querySelector<HTMLElement>("article a")!);
  expect(container.querySelector<HTMLInputElement>('input[name="starred"]')!.checked).toBe(false);
});

it("shows claim controls only when the list permits claiming", async () => {
  const card = (canClaim: boolean) => <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <ClaimItem item={item} ownerName="Willow" canClaim={canClaim} />
  </NextIntlClientProvider>;
  await render(card(false));
  expect(container.querySelector("article")?.textContent).toContain(item.title);
  expect(container.querySelector("button")).toBeNull();
  await render(card(true));
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === en.lists.claim)).toBe(true);
});

it("changes the rendered photo URL when a saved photo is replaced", async () => {
  const projected = {...item, kind: "photo" as const, hasPhoto: true, updatedAt: new Date("2032-12-24T12:00:00Z")};
  await render(<ItemThumb item={toItemView(projected, "en")} />);
  const original = container.querySelector("img")!.getAttribute("src");
  await render(<ItemThumb item={toItemView({...projected, updatedAt: new Date("2032-12-24T12:01:00Z")}, "en")} />);
  const replaced = container.querySelector("img")!.getAttribute("src");
  expect(replaced).not.toBe(original);
  expect(new URL(replaced!, "https://gift.example").pathname).toBe("/en/lists/photo/item/photo");
});
