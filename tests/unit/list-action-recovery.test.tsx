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
import {POST as previewRoute} from "../../src/app/[locale]/lists/[personId]/link-preview/route";
import type {ListItemView} from "../../src/app/[locale]/lists/item-view";
import {dismissToast, ToastHost} from "../../src/components/ui/toast";

vi.mock("../../src/app/[locale]/lists/actions", () => ({
  claimCommand: vi.fn(), itemCommand: vi.fn(), previewItemLink: vi.fn(), removeItem: vi.fn(),
  saveBudget: vi.fn(), saveItem: vi.fn(), saveProfileField: vi.fn(), setItemStar: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({refresh: vi.fn()}),
  Link: ({href, children, transitionTypes, ...rest}: {href: string; children: ReactNode; transitionTypes?: string[]}) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>{children}</a>
  ),
}));

const actingAs = "buyer";
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
  const checklist = (value: boolean) => <ChecklistTick label={en.lists[command]} checked={value} action={claimCommand.bind(null, actingAs, item.id, command)} />;
  vi.mocked(claimCommand).mockReturnValueOnce(response.promise).mockImplementationOnce(async () => {
    root.render(view(checklist(!checked)));
    return {};
  });
  await render(checklist(checked));
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
  expect(claimCommand).toHaveBeenNthCalledWith(1, actingAs, item.id, command, !checked, {});
});

it.each(["bought", "wrapped"] as const)("reconciles %s when a concurrent save returns the same server value", async (command) => {
  const response = Promise.withResolvers<FormState>();
  let checked = true;
  const checklist = () => <ChecklistTick label={en.lists[command]} checked={checked} action={claimCommand.bind(null, actingAs, item.id, command)} />;
  vi.mocked(claimCommand).mockImplementationOnce(async () => {
    checked = false;
    root.render(view(checklist()));
    return {};
  }).mockReturnValueOnce(response.promise);
  await render(checklist());
  const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await click(checkbox());
  expect(checkbox().checked).toBe(false);
  await click(checkbox());
  expect(checkbox().checked).toBe(true);
  expect(checkbox().disabled).toBe(true);
  await act(async () => {
    root.render(view(checklist()));
    response.resolve({});
  });
  expect(checkbox().checked).toBe(false);
  expect(checkbox().disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(claimCommand).toHaveBeenNthCalledWith(1, actingAs, item.id, command, false, {});
  expect(claimCommand).toHaveBeenNthCalledWith(2, actingAs, item.id, command, true, {});
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

it.each(["noClothes", "tops", "bottoms", "shoes", "shoeSystem"] as const)("keeps the newest repeated %s edit when an earlier save fails", async (field) => {
  const first = Promise.withResolvers<FormState>();
  const last = Promise.withResolvers<FormState>();
  const initial = field === "noClothes" ? "false" : field === "shoeSystem" ? "us-women" : field === "shoes" ? "7" : "M";
  const next = field === "noClothes" ? "true" : field === "shoeSystem" ? "eu" : field === "shoes" ? "7.5" : "L";
  let persisted = initial;
  vi.mocked(saveProfileField).mockReturnValueOnce(first.promise).mockImplementation(async (_owner, _field, value) => {
    const result = await last.promise;
    if (result.status === "saved") persisted = value;
    return result;
  });
  await render(profile({tops: "M", bottoms: "M", shoes: "7", shoeSystem: "us-women"}));
  const letters = () => [...container.querySelectorAll("fieldset")].find((entry) =>
    entry.querySelector("legend")?.textContent === en.lists.size[field as "tops" | "bottoms"])!;
  const change = async (value: string) => {
    if (field === "noClothes") await click(container.querySelector<HTMLButtonElement>('[role="switch"]')!);
    else if (field === "shoes") {
      const label = value === next ? en.lists.shoeBigger : en.lists.shoeSmaller;
      await click(container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!);
    } else if (field === "shoeSystem") {
      await act(async () => {
        const select = container.querySelector<HTMLSelectElement>("select")!;
        select.value = value;
        select.dispatchEvent(new Event("change", {bubbles: true}));
      });
    } else await click(letters().querySelector<HTMLInputElement>(`input[value="${value}"]`)!);
  };
  const displayed = () => field === "noClothes"
    ? container.querySelector('[role="switch"]')!.getAttribute("aria-checked")
    : field === "shoes" ? container.querySelector<HTMLInputElement>('input[id$="-shoes"]')!.value
    : field === "shoeSystem" ? container.querySelector<HTMLSelectElement>("select")!.value
    : letters().querySelector<HTMLInputElement>('input:checked')?.value;
  const expected = field === "shoes" ? "7½" : next;
  await change(next);
  await change(initial);
  await change(next);
  expect(displayed()).toBe(expected);
  await act(async () => first.reject(new Error("Offline")));
  expectFeedback();
  expect(displayed()).toBe(expected);
  expect(saveProfileField).toHaveBeenCalledTimes(2);
  expect(saveProfileField).toHaveBeenNthCalledWith(2, ownerId, field, next, field === "noClothes" ? "noClothes" : "size");
  await act(async () => last.resolve({status: "saved"}));
  expect(persisted).toBe(next);
  expect(displayed()).toBe(expected);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector(".fge-toast")?.textContent).toContain(en.lists.saved);
});

it("still rolls back a failed field when a different field was edited later", async () => {
  const first = Promise.withResolvers<FormState>();
  vi.mocked(saveProfileField).mockReturnValueOnce(first.promise).mockResolvedValueOnce({status: "saved"});
  await render(profile({tops: "M", bottoms: "M"}));
  const fields = container.querySelectorAll("fieldset");
  await click(fields[0].querySelector<HTMLInputElement>('input[value="L"]')!);
  await click(fields[1].querySelector<HTMLInputElement>('input[value="L"]')!);
  await act(async () => first.reject(new Error("Offline")));
  expect(fields[0].querySelector<HTMLInputElement>('input[value="M"]')!.checked).toBe(true);
  expect(fields[1].querySelector<HTMLInputElement>('input[value="L"]')!.checked).toBe(true);
  expect(saveProfileField).toHaveBeenCalledTimes(2);
});

it("keeps a newer repeated shoe draft when its earlier autosave fails", async () => {
  const response = Promise.withResolvers<FormState>();
  vi.mocked(saveProfileField).mockReturnValueOnce(response.promise);
  await render(profile());
  await click(container.querySelector<HTMLButtonElement>(`button[aria-label="${en.lists.shoeBigger}"]`)!);
  const input = () => container.querySelector<HTMLInputElement>('input[id$="-shoes"]')!;
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", {bubbles: true}));
  });
  await type("8");
  await render(profile());
  expect(input().value).toBe("8");
  await type("7.5");
  await act(async () => response.reject(new Error("Offline")));
  expect(input().value).toBe("7½");
  expectFeedback();
  expect(saveProfileField).toHaveBeenCalledOnce();
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

/** The form asks for a preview over the link-preview route, which runs the same server function. */
function previewOverRoute() {
  const requests: RequestInit[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
    requests.push(init);
    const url = new URL(path, "https://gift.example");
    const [, , , personId] = url.pathname.split("/");
    const reply = previewRoute(new Request(url, {...init, signal: undefined, headers: {...init.headers, origin: url.origin}}), {
      params: Promise.resolve({personId}),
    });
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      reply.then(resolve, reject);
    });
  }));
  return requests;
}

it("reports a rejected link preview and allows retry", async () => {
  previewOverRoute();
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
  expect(previewItemLink).toHaveBeenLastCalledWith(ownerId, url);
});

it("saves at once while a link preview is still loading, instead of waiting for the store", async () => {
  const requests = previewOverRoute();
  const store = Promise.withResolvers<PreviewState>();
  vi.mocked(previewItemLink).mockReturnValueOnce(store.promise);
  vi.mocked(saveItem).mockResolvedValue({status: "saved"});
  await render(<ItemForm ownerId={ownerId} kind="link" />);
  const field = container.querySelector<HTMLTextAreaElement>('textarea[name="link"]')!;
  await act(async () => {
    const paste = new Event("paste", {bubbles: true, cancelable: true});
    Object.assign(paste, {clipboardData: {getData: () => "https://www.target.com/p/fleece-robe/-/A-12345"}});
    field.dispatchEvent(paste);
  });
  expect(container.textContent).toContain(en.lists.previewLoading);
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(requests[0].signal?.aborted).toBe(true);
  expect(saveItem).toHaveBeenCalledTimes(1);
  const form = vi.mocked(saveItem).mock.calls[0][5] as FormData;
  expect(form.get("link")).toBe("https://www.target.com/p/fleece-robe/-/A-12345");
  expect(form.get("draft")).toBeNull();
  expect(container.textContent).not.toContain(en.lists.previewLoading);
  await act(async () => store.resolve({error: "could-not-save"}));
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
