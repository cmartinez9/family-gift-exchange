// @vitest-environment jsdom
import {randomUUID} from "node:crypto";
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {OwnList} from "../../src/app/[locale]/lists/[personId]/own-list";
import {ProfileForm} from "../../src/app/[locale]/lists/[personId]/profile/profile-form";
import {claimCommand, itemCommand, previewItemLink, saveBudget, saveItem, saveProfileField, setItemStar} from "../../src/app/[locale]/lists/actions";
import type {FormState, PreviewState} from "../../src/app/[locale]/lists/action-types";
import {ChecklistTick, ListForm} from "../../src/app/[locale]/lists/controls";
import {ItemForm} from "../../src/app/[locale]/lists/item-form";
import type {ListItemView} from "../../src/app/[locale]/lists/item-view";
import {dismissToast, ToastHost} from "../../src/components/ui/toast";

vi.mock("../../src/app/[locale]/lists/actions", () => ({
  claimCommand: vi.fn(), itemCommand: vi.fn(), previewItemLink: vi.fn(), removeItem: vi.fn(),
  saveBudget: vi.fn(), saveItem: vi.fn(), saveProfileField: vi.fn(), setItemStar: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children, transitionTypes, ...rest}: {href: string; children: ReactNode; transitionTypes?: string[]}) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>{children}</a>
  ),
}));

const item: ListItemView = {id: "item", kind: "note", title: "Tea tin", note: null, price: null, store: null, starred: false, url: null};
const about = {likes: null, dislikes: null, allergies: null, colors: null};
let ownerId: string;
let container: HTMLDivElement;
let root: Root;
let items: ListItemView[];

function view(node: ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
    {node}<ToastHost undoLabel="Undo" />
  </NextIntlClientProvider>;
}

function own() {
  return <OwnList ownerId={ownerId} items={items} sizes={null} closeLabel="Close" />;
}

function profile(initialSizes: Record<string, string> = {tops: "M", shoeSystem: "us-women", shoes: "7"}) {
  return <ProfileForm ownerId={ownerId} initialSizes={initialSizes} initialAbout={about} initialNoClothes={false} />;
}

async function render(node: ReactNode) {
  await act(async () => root.render(view(node)));
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent === label)!;
}

function expectFeedback() {
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(en.lists.feedback["could-not-save"]);
}

function expectToast() {
  expect(container.querySelector(".fge-toast")?.textContent).toContain(en.lists.feedback["could-not-save"]);
}

beforeEach(() => {
  vi.resetAllMocks();
  ownerId = randomUUID();
  items = [{...item}];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn().mockReturnValue({matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()});
  Element.prototype.animate = vi.fn().mockReturnValue({cancel() {}, onfinish: null});
  Element.prototype.getAnimations = () => [];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(setItemStar).mockImplementation(async (_owner, id, starred) => {
    items = items.map((entry) => entry.id === id ? {...entry, starred} : entry);
    root.render(view(own()));
    return {status: "saved"};
  });
});

afterEach(async () => {
  await act(async () => { dismissToast(); root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  ["bought", false], ["bought", true], ["wrapped", false], ["wrapped", true],
] as const)("rolls back %s from %s after a rejected save and allows retry", async (command, checked) => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(claimCommand).mockReturnValueOnce(response.promise).mockResolvedValueOnce({});
  await render(<ChecklistTick label={en.lists[command]} checked={checked} action={claimCommand.bind(null, item.id, command)} />);
  const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await click(checkbox());
  expect(checkbox().checked).toBe(!checked);
  expect(checkbox().disabled).toBe(true);
  await act(async () => response.reject(new Error("Offline")));
  expect(checkbox().checked).toBe(checked);
  expect(checkbox().disabled).toBe(false);
  expectFeedback();
  await click(checkbox());
  expect(checkbox().checked).toBe(!checked);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(claimCommand).toHaveBeenCalledTimes(2);
  expect(claimCommand).toHaveBeenNthCalledWith(1, item.id, command, !checked, {});
});

it("rolls back a rejected heart save, reports it, and allows retry", async () => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(setItemStar).mockReturnValueOnce(response.promise);
  await render(own());
  const heart = () => container.querySelector<HTMLButtonElement>('article button[aria-pressed]')!;
  await click(heart());
  expect(heart().getAttribute("aria-pressed")).toBe("true");
  await act(async () => response.reject(new Error("Offline")));
  expect(heart().getAttribute("aria-pressed")).toBe("false");
  expectToast();
  await click(heart());
  expect(heart().getAttribute("aria-pressed")).toBe("true");
  expect(setItemStar).toHaveBeenCalledTimes(2);
});

it.each(["up", "down", "refresh"] as const)("reports a rejected %s command and allows retry", async (command) => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(itemCommand).mockReturnValueOnce(response.promise).mockResolvedValueOnce({});
  const neighbor = {...item, id: "neighbor", title: "Book"};
  items = command === "up" ? [neighbor, item] : [item, neighbor];
  if (command === "refresh") items = [{...item, kind: "link", url: "https://gift.example/tea"}];
  await render(own());
  const open = async () => click(container.querySelector<HTMLElement>(`article[aria-label="${item.title}"] a`)!);
  const label = command === "up" ? en.lists.moveUp : command === "down" ? en.lists.moveDown : en.lists.refresh;
  await open();
  await click(button(label));
  await act(async () => response.reject(new Error("Offline")));
  expectToast();
  expect(container.querySelector(`article[aria-label="${item.title}"]`)).not.toBeNull();
  await open();
  await click(button(label));
  expect(itemCommand).toHaveBeenCalledTimes(2);
  expect(itemCommand).toHaveBeenNthCalledWith(1, ownerId, item.id, command);
});

it.each(["budget", "delete"] as const)("shows feedback for a rejected %s form and allows retry", async (kind) => {
  const response = Promise.withResolvers<FormState>();
  const request = kind === "budget" ? vi.mocked(saveBudget) : vi.mocked(itemCommand);
  request.mockReturnValueOnce(response.promise).mockResolvedValueOnce({status: "saved"});
  const action = kind === "budget" ? saveBudget.bind(null, "exchange") : itemCommand.bind(null, ownerId, item.id, "delete");
  await render(<ListForm action={action} label="Submit"><input name="budget" defaultValue="25" /></ListForm>);
  container.querySelector<HTMLInputElement>('input[name="budget"]')!.value = "45";
  await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => response.reject(new Error("Offline")));
  expectFeedback();
  expect(container.querySelector<HTMLInputElement>('input[name="budget"]')!.value).toBe("45");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(["page", "sheet"] as const)("keeps the item draft after a rejected %s save and allows retry", async (mode) => {
  const response = Promise.withResolvers<FormState>();
  const saved = vi.fn();
  vi.mocked(saveItem).mockReturnValueOnce(response.promise).mockResolvedValueOnce({status: "saved"});
  await render(<ItemForm ownerId={ownerId} kind="note" initial={item} mode={mode} onSaved={saved} />);
  await click(container.querySelector<HTMLInputElement>('input[name="starred"]')!);
  expect(container.querySelector<HTMLInputElement>('input[name="starred"]')!.checked).toBe(true);
  await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
  await act(async () => response.reject(new Error("Offline")));
  expectFeedback();
  expect(saved).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>('input[name="starred"]')!.checked).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe(item.title);
  await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(saved).toHaveBeenCalledOnce();
  expect(saveItem).toHaveBeenCalledTimes(2);
});

it("rolls back a rejected clothing preference and keeps its autosave queue usable", async () => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(saveProfileField).mockReturnValueOnce(response.promise).mockResolvedValueOnce({status: "saved"});
  await render(profile());
  const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await click(toggle());
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => response.reject(new Error("Offline")));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expectFeedback();
  await click(toggle());
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(saveProfileField).toHaveBeenCalledTimes(2);
});

it("restores a custom size after a rejected chip save", async () => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(saveProfileField).mockReturnValueOnce(response.promise).mockResolvedValueOnce({status: "saved"});
  await render(profile({tops: "4T"}));
  const chip = () => container.querySelector<HTMLInputElement>('fieldset input[value="M"]')!;
  await click(chip());
  expect(chip().checked).toBe(true);
  await act(async () => response.reject(new Error("Offline")));
  expect(chip().checked).toBe(false);
  const label = [...container.querySelectorAll("label")].find((entry) => entry.textContent === en.lists.size.tops)!;
  expect(container.querySelector<HTMLInputElement>(`input[id="${label.htmlFor}"]`)!.value).toBe("4T");
  expectFeedback();
  await click(chip());
  expect(chip().checked).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("rolls back a rejected shoe step and allows retry", async () => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(saveProfileField).mockReturnValueOnce(response.promise).mockResolvedValueOnce({status: "saved"});
  await render(profile());
  const bigger = () => container.querySelector<HTMLButtonElement>(`button[aria-label="${en.lists.shoeBigger}"]`)!;
  const shoe = () => container.querySelector<HTMLInputElement>('input[id$="-shoes"]')!;
  await click(bigger());
  expect(shoe().value).toBe("7½");
  await act(async () => response.reject(new Error("Offline")));
  expect(shoe().value).toBe("7");
  expectFeedback();
  await click(bigger());
  expect(shoe().value).toBe("7½");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("rolls back a rejected shoe-system change and allows retry", async () => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(saveProfileField).mockReturnValueOnce(response.promise).mockResolvedValueOnce({status: "saved"});
  await render(profile());
  const select = () => container.querySelector<HTMLSelectElement>("select")!;
  const choose = async () => act(async () => {
    select().value = "eu";
    select().dispatchEvent(new Event("change", {bubbles: true}));
  });
  await choose();
  expect(select().value).toBe("eu");
  await act(async () => response.reject(new Error("Offline")));
  expect(select().value).toBe("us-women");
  expectFeedback();
  await choose();
  expect(select().value).toBe("eu");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("retains About me drafts after a rejected autosave and allows retry", async () => {
  vi.mocked(saveProfileField).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({status: "saved"});
  await render(profile());
  const input = container.querySelector<HTMLTextAreaElement>('textarea[id="about-likes"]')!;
  await act(async () => {
    input.value = "Puzzles";
    input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
  });
  expectFeedback();
  expect(input.value).toBe("Puzzles");
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", {bubbles: true})));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(saveProfileField).toHaveBeenCalledTimes(2);
});

it("reports a rejected link preview and allows retry", async () => {
  const response = Promise.withResolvers<PreviewState>();
  const url = "https://gift.example/tea";
  vi.mocked(previewItemLink).mockReturnValueOnce(response.promise).mockResolvedValueOnce({card: {
    url, title: "Tea tin", price: null, store: "gift.example", icon: "store",
  }});
  await render(<ItemForm ownerId={ownerId} kind="link" initial={{...item, url}} />);
  await click(button(en.lists.preview));
  await act(async () => response.reject(new Error("Offline")));
  expectFeedback();
  expect(container.querySelector<HTMLTextAreaElement>('textarea[name="link"]')!.value).toBe(url);
  await click(button(en.lists.preview));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector(`section[aria-label="${en.lists.previewTitle}"]`)?.textContent).toContain("gift.example");
  expect(previewItemLink).toHaveBeenCalledTimes(2);
});
