// @vitest-environment jsdom
import {randomUUID} from "node:crypto";
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {ClaimItem} from "../../src/app/[locale]/lists/[personId]/claim-item";
import {OwnList} from "../../src/app/[locale]/lists/[personId]/own-list";
import {POST} from "../../src/app/[locale]/lists/[personId]/items/[itemId]/remove/route";
import {claimCommand, removeItem, saveItem, setItemStar} from "../../src/app/[locale]/lists/actions";
import type {FormState} from "../../src/app/[locale]/lists/action-types";
import {ItemThumb, toItemView, type ListItemView} from "../../src/app/[locale]/lists/item-view";
import {removeWithUndo} from "../../src/app/[locale]/lists/pending-removals";
import {dismissToast, ToastHost} from "../../src/components/ui/toast";

vi.mock("../../src/app/[locale]/lists/actions", () => ({
  itemCommand: vi.fn(), removeItem: vi.fn(), setItemStar: vi.fn(), saveItem: vi.fn(), previewItemLink: vi.fn(), claimCommand: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, transitionTypes, ...rest}: {href: string; children: ReactNode; transitionTypes?: string[]}) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>{children}</a>
  ),
}));

let ownerId: string;
const actingAs = "buyer";
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
  ownerId = randomUUID();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    const url = new URL(path, "https://gift.example");
    const [, , , personId, , itemId] = url.pathname.split("/");
    return POST(new Request(url, {method: "POST", headers: {origin: url.origin}}), {
      params: Promise.resolve({personId, itemId}),
    });
  }));
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
  vi.mocked(removeItem).mockImplementation(async (_owner, id) => {
    items = items.filter((entry) => entry.id !== id);
    root.render(screen());
    return {status: "saved"};
  });
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

it("keeps Undo effective after leaving the list while the page stays visible", async () => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  expect(container.querySelector("article")).toBeNull();
  document.dispatchEvent(new Event("visibilitychange"));
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

it.each(["pagehide", "hidden"] as const)("flushes a removal once with keepalive on %s before reloading the list", async (event) => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  expect(removeItem).not.toHaveBeenCalled();
  await act(async () => {
    if (event === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    } else window.dispatchEvent(new Event("pagehide"));
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/en/lists/${ownerId}/items/${item.id}/remove`, {method: "POST", keepalive: true});
  expect(removeItem).toHaveBeenCalledExactlyOnceWith(ownerId, item.id);
  expect(container.querySelector(".fge-toast")?.getAttribute("data-show")).toBe("false");
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(removeItem).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.querySelector("article")).toBeNull();
});

it("flushes every pending removal on exit even after leaving the list", async () => {
  vi.useFakeTimers();
  items.push({...item, id: "second", title: "Winter book"});
  await render();
  await takeOff();
  await takeOff();
  showingList = false;
  await render();
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(removeItem).toHaveBeenCalledWith(ownerId, item.id);
  expect(removeItem).toHaveBeenCalledWith(ownerId, "second");
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(removeItem).toHaveBeenCalledTimes(2);
  showingList = true;
  await render();
  expect(container.querySelector("article")).toBeNull();
});

it.each(["returned", "rejected"] as const)("restores an item after a %s keepalive failure", async (failure) => {
  vi.useFakeTimers();
  if (failure === "returned") vi.mocked(removeItem).mockResolvedValueOnce({error: "forbidden"});
  else vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
  await render();
  await takeOff();
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(container.querySelector("article")?.textContent).toContain(item.title);
  const message = en.lists.feedback[failure === "returned" ? "forbidden" : "could-not-save"];
  expect(container.querySelector(".fge-toast")?.textContent).toContain(message);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(fetch).toHaveBeenCalledOnce();
  expect(removeItem).toHaveBeenCalledTimes(failure === "returned" ? 1 : 0);
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
  showingList = true;
  await render();
  expect(container.querySelector("article")).toBeNull();
});

it("keeps a saved removal hidden until refreshed list data acknowledges it", async () => {
  vi.useFakeTimers();
  vi.mocked(removeItem).mockResolvedValueOnce({status: "saved"});
  await render();
  await takeOff();
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(container.querySelector("article")).toBeNull();
  showingList = false;
  await render();
  showingList = true;
  await render();
  expect(container.querySelector("article")).toBeNull();
  items = [];
  await render();
  items = [{...item}];
  await render();
  expect(container.querySelector("article")?.textContent).toContain(item.title);
});

it("keeps a pending item hidden after returning to the list and cancels its original removal", async () => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  showingList = false;
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  showingList = true;
  await render();
  expect(container.querySelector("article")).toBeNull();
  await click(container.querySelector<HTMLButtonElement>(".fge-toast button")!);
  expect(container.querySelector("article")?.textContent).toContain(item.title);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(removeItem).not.toHaveBeenCalled();
});

it("shares cancellation when the same item removal is requested twice", async () => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  await act(async () => removeWithUndo("en", ownerId, item.id, "Duplicate request", () => "Failed"));
  await click(container.querySelector<HTMLButtonElement>(".fge-toast button")!);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(removeItem).not.toHaveBeenCalled();
  expect(container.querySelector("article")?.textContent).toContain(item.title);
});

it("keeps pending removals scoped to their owner", async () => {
  vi.useFakeTimers();
  await render();
  await takeOff();
  await render(<NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <OwnList ownerId="another-owner" items={items} sizes={null} closeLabel="Close" />
    <ToastHost undoLabel="Undo" />
  </NextIntlClientProvider>);
  expect(container.querySelector("article")?.textContent).toContain(item.title);
  await click(container.querySelector<HTMLButtonElement>(".fge-toast button")!);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(removeItem).not.toHaveBeenCalled();
});

it.each(["returned", "rejected"] as const)("restores an item and reports a %s removal failure after remount", async (failure) => {
  vi.useFakeTimers();
  if (failure === "returned") vi.mocked(removeItem).mockResolvedValueOnce({error: "forbidden"});
  else vi.mocked(removeItem).mockRejectedValueOnce(new Error("Offline"));
  await render();
  await takeOff();
  showingList = false;
  await render();
  showingList = true;
  await render();
  expect(container.querySelector("article")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(removeItem).toHaveBeenCalledExactlyOnceWith(ownerId, item.id);
  expect(container.querySelector("article")?.textContent).toContain(item.title);
  const message = en.lists.feedback[failure === "returned" ? "forbidden" : "could-not-save"];
  expect(container.querySelector(".fge-toast")?.textContent).toContain(message);
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
    <ClaimItem actingAs={actingAs} item={item} ownerName="Willow" canClaim={canClaim} />
  </NextIntlClientProvider>;
  await render(card(false));
  expect(container.querySelector("article")?.textContent).toContain(item.title);
  expect(container.querySelector("button")).toBeNull();
  await render(card(true));
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === en.lists.claim)).toBe(true);
});

it.each(["claim", "undo"] as const)("restores the previous claim state after a rejected %s and allows retry", async (command) => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(claimCommand).mockReturnValueOnce(response.promise).mockResolvedValueOnce({});
  const initial: ListItemView = {...item, ...(command === "undo" ? {claim: "mine"} : {})};
  await render(<NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <ClaimItem actingAs={actingAs} item={initial} ownerName="Willow" canClaim />
    <ToastHost undoLabel="Undo" />
  </NextIntlClientProvider>);
  const label = command === "claim" ? en.lists.claim : en.lists.undoClaim;
  const button = () => [...container.querySelectorAll<HTMLButtonElement>("article button")].find((entry) => entry.textContent === label)!;
  const before = command === "claim" ? "open" : "mine";
  const after = command === "claim" ? "mine" : "open";
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe(before);
  await click(button());
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe(after);
  expect(container.querySelector("article")?.getAttribute("aria-busy")).toBe("true");
  expect(button().disabled).toBe(true);
  await act(async () => response.reject(new Error("Offline")));
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe(before);
  expect(container.querySelector("article")?.getAttribute("aria-busy")).toBe("false");
  expect(button().disabled).toBe(false);
  expect(container.querySelector(".fge-toast")?.textContent).toContain(en.lists.feedback["could-not-save"]);
  await click(button());
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe(after);
  expect(claimCommand).toHaveBeenCalledTimes(2);
  expect(claimCommand).toHaveBeenNthCalledWith(1, actingAs, item.id, command, command === "claim");
  expect(claimCommand).toHaveBeenNthCalledWith(2, actingAs, item.id, command, command === "claim");
});

it("keeps the taken-card response when another person claimed the item first", async () => {
  vi.mocked(claimCommand).mockResolvedValueOnce({error: "already-claimed"});
  await render(<NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <ClaimItem actingAs={actingAs} item={item} ownerName="Willow" canClaim />
    <ToastHost undoLabel="Undo" />
  </NextIntlClientProvider>);
  await click(container.querySelector<HTMLButtonElement>("[data-claim-origin]")!);
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe("late");
  expect(container.querySelector("article")?.textContent).toContain(en.lists.justGot);
  expect(container.querySelector("article button")).toBeNull();
});

it("refreshes a reservation undone in another tab when a different item is claimed", async () => {
  const reservations = new Map<string, "mine">();
  let entries: ListItemView[] = [{...item, id: "a"}, {...item, id: "b", title: "Book"}];
  const list = () => <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    {entries.map((entry) => <ClaimItem actingAs={actingAs} key={entry.id} item={entry} ownerName="Willow" canClaim />)}
  </NextIntlClientProvider>;
  const card = (id: string) => container.querySelectorAll<HTMLElement>("article")[id === "a" ? 0 : 1];
  vi.mocked(claimCommand).mockImplementation(async (_actingAs, id) => {
    reservations.set(id, "mine");
    entries = entries.map((entry) => ({...entry, claim: reservations.get(entry.id)}));
    root.render(list());
    return {};
  });
  await render(list());
  await click(card("a").querySelector<HTMLButtonElement>("[data-claim-origin]")!);
  expect(card("a").getAttribute("data-claim")).toBe("mine");
  reservations.delete("a");
  await click(card("b").querySelector<HTMLButtonElement>("[data-claim-origin]")!);
  expect(card("a").getAttribute("data-claim")).toBe("open");
  expect(card("a").querySelector("[data-claimed]")?.getAttribute("data-claimed")).toBe("false");
  expect(card("b").getAttribute("data-claim")).toBe("mine");
});

it("shows a reservation made in another tab after receiving refreshed item data", async () => {
  const card = (entry: ListItemView) => <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <ClaimItem actingAs={actingAs} item={entry} ownerName="Willow" canClaim />
  </NextIntlClientProvider>;
  await render(card(item));
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe("open");
  await render(card({...item, claim: "mine"}));
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe("mine");
  expect(container.querySelector("[data-claimed]")?.getAttribute("data-claimed")).toBe("true");
});

it.each([undefined, "mine", "someone"] as const)("clears stale late feedback when refreshed claim data is %s", async (claim) => {
  vi.mocked(claimCommand).mockResolvedValueOnce({error: "already-claimed"});
  const card = (entry: ListItemView) => <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <ClaimItem actingAs={actingAs} item={entry} ownerName="Willow" canClaim />
  </NextIntlClientProvider>;
  await render(card(item));
  await click(container.querySelector<HTMLButtonElement>("[data-claim-origin]")!);
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe("late");
  await render(card({...item, claim}));
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe(claim ?? "open");
  expect(container.querySelector("article [role=status]")).toBeNull();
  expect(container.querySelector("article")?.textContent).not.toContain(en.lists.justGot);
});

it.each(["claim", "undo"] as const)("keeps refreshed server data after an older %s request fails", async (command) => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(claimCommand).mockReturnValueOnce(response.promise);
  const card = (entry: ListItemView) => <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    <ClaimItem actingAs={actingAs} item={entry} ownerName="Willow" canClaim />
    <ToastHost undoLabel="Undo" />
  </NextIntlClientProvider>;
  await render(card({...item, claim: command === "undo" ? "mine" : undefined}));
  const label = command === "claim" ? en.lists.claim : en.lists.undoClaim;
  const button = [...container.querySelectorAll<HTMLButtonElement>("article button")].find((entry) => entry.textContent === label)!;
  await click(button);
  await render(card({...item, claim: command === "claim" ? "mine" : undefined}));
  await act(async () => response.reject(new Error("Offline")));
  expect(container.querySelector("article")?.getAttribute("data-claim")).toBe(command === "claim" ? "mine" : "open");
  expect(container.querySelector(".fge-toast")?.textContent).toContain(en.lists.feedback["could-not-save"]);
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
