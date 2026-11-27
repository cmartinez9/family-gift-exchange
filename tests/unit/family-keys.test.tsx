// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {Link} from "@/i18n/navigation";
import en from "../../messages/en.json";
import type {Prepared} from "../../src/app/[locale]/family/actions";

const {prepareKey, sentKey} = vi.hoisted(() => ({prepareKey: vi.fn(), sentKey: vi.fn()}));
vi.mock("../../src/app/[locale]/family/actions", () => ({prepareKey, sentKey}));
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

function button(text: string, within: ParentNode = container) {
  return [...within.querySelectorAll("button")].find((element) => element.textContent?.trim() === text)!;
}

function printButton() {
  return container.querySelector<HTMLButtonElement>("section > div:last-child button")!;
}

async function render(currentPeople = people) {
  await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    <Link href="/family">Family</Link>
    <KeysList people={currentPeople} helped={[]} />
    <input aria-label="Family sign-in address" readOnly value="https://example.com/sign-in?family=family" />
    <Link href="/family/group-chat">Tell the family</Link>
  </NextIntlClientProvider>));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  prepareKey.mockReset();
  sentKey.mockReset();
  vi.spyOn(window, "print").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
  Element.prototype.animate ??= function () {
    return {cancel() {}, onfinish: null} as unknown as Animation;
  };
  Element.prototype.getAnimations ??= () => [];
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLDialogElement.prototype.close ??= function () { this.open = false; };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
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

it.each(["qr", "print"] as const)("prints one row's %s key through the printable cards view", async (kind) => {
  const invitation = key("invitation");
  const printable = key(`alex-${kind}`);
  prepareKey.mockResolvedValueOnce({key: {...invitation.key!, qr: undefined}}).mockResolvedValueOnce(printable);
  const row = container.querySelector<HTMLLIElement>("#member-alex")!;
  expect(button("Send", row)).toBeDefined();
  await act(async () => button("Send", row).click());
  await act(async () => button(kind === "qr" ? en.auth.showQr : "Print a card", row).click());
  expect(prepareKey).toHaveBeenLastCalledWith("alex", kind);
  expect(row.textContent).toContain(printable.key!.message);
  expect(row.textContent).toContain(printable.key!.code);
  expect(row.textContent).toContain(printable.key!.familyAddress);
  expect(row.querySelector("img")?.getAttribute("src")).toBe(printable.key!.qr);
  expect(button("Print a card", row)).toBeDefined();
  await act(async () => button(en.auth.print, row).click());
  expect(window.print).not.toHaveBeenCalled();
  expect(prepareKey).toHaveBeenCalledTimes(2);
  const cards = container.querySelectorAll("section li");
  expect(cards).toHaveLength(1);
  expect(cards[0].textContent).toContain("Alex");
  expect(cards[0].textContent).not.toContain("Sam");
  expect(cards[0].textContent).toContain(printable.key!.code);
  expect(cards[0].textContent).toContain(printable.key!.familyAddress);
  expect(cards[0].querySelector("img")?.getAttribute("src")).toBe(printable.key!.qr);
  expect(printButton().disabled).toBe(false);
  await act(async () => printButton().click());
  expect(window.print).toHaveBeenCalledOnce();
  expect(row.textContent).toContain(printable.key!.message);
});

it("prepares a replacement after a cached invitation is redeemed and marked sent", async () => {
  const invitation = key("invitation");
  invitation.key!.message = "Old invitation";
  invitation.key!.qr = undefined;
  const replacement = key("replacement");
  replacement.key!.message = "Replacement key";
  replacement.key!.qr = undefined;
  prepareKey.mockResolvedValueOnce(invitation).mockResolvedValueOnce(replacement);
  const row = container.querySelector<HTMLLIElement>("#member-alex")!;
  await act(async () => button("Send", row).click());
  expect(row.textContent).toContain("Old invitation");
  let finishSending: (result: {success: string}) => void = () => {};
  sentKey.mockReturnValue(new Promise((resolve) => { finishSending = resolve; }));
  await act(async () => button(en.auth.markSent, row).click());
  expect(sentKey).toHaveBeenLastCalledWith("invitation");
  await render([{...people[0], joined: true}, people[1]]);
  expect(button("Reset PIN", row).disabled).toBe(true);
  await act(async () => finishSending({success: "sent"}));
  await act(async () => button("Reset PIN", row).click());
  expect(row.querySelector("dialog")?.open).toBe(true);
  expect(row.textContent).not.toContain("Old invitation");
  expect(button("Reset and send a new key", row).disabled).toBe(false);
  expect(prepareKey).toHaveBeenCalledOnce();
  await act(async () => button("Reset and send a new key", row).click());
  expect(prepareKey).toHaveBeenLastCalledWith("alex", "reset");
  expect(row.textContent).toContain("Replacement key");
  expect(row.textContent).toContain(replacement.key!.code);
  expect(row.querySelector("img")).toBeNull();
  sentKey.mockResolvedValueOnce({success: "sent"});
  await act(async () => button(en.auth.markSent, row).click());
  expect(sentKey).toHaveBeenLastCalledWith("replacement");
});

it.each([
  ["qr", "cancel"], ["qr", "back"], ["print", "cancel"], ["print", "back"],
] as const)("moves focus into the %s modal and restores it after %s", async (kind, exit) => {
  prepareKey.mockResolvedValue(key("alex"));
  const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
  const close = vi.spyOn(HTMLDialogElement.prototype, "close");
  const opener = button(kind === "qr" ? en.auth.showQr : en.draw.keys.printCards);
  opener.focus();
  expect(document.activeElement).toBe(opener);
  await act(async () => opener.click());
  const dialog = container.querySelector<HTMLDialogElement>("dialog[open]")!;
  expect(dialog).not.toBeNull();
  expect(showModal).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(button(en.auth.sendKeys, dialog));
  if (exit === "cancel") {
    const cancel = new Event("cancel", {cancelable: true});
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
  } else {
    await act(async () => button(en.auth.sendKeys, dialog).click());
  }
  expect(close).toHaveBeenCalledOnce();
  expect(container.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("keeps the displayed QR with its person when they join, then prepares the next person", async () => {
  prepareKey.mockImplementation(async (id: string) => key(id));
  await act(async () => button(en.auth.showQr).click());
  const dialog = container.querySelector("dialog[open]")!;
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(key("alex").key!.qr);
  await render([{...people[0], joined: true}, people[1]]);
  expect(dialog.querySelector("h2")?.textContent).toBe(en.draw.keys.qrTitle.replace("{name}", "Alex"));
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(key("alex").key!.qr);
  expect(prepareKey).toHaveBeenCalledOnce();
  await act(async () => button(en.draw.keys.nextPerson, dialog).click());
  expect(prepareKey).toHaveBeenLastCalledWith("sam", "qr");
  expect(dialog.querySelector("h2")?.textContent).toBe(en.draw.keys.qrTitle.replace("{name}", "Sam"));
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(key("sam").key!.qr);
  expect(dialog.querySelector('[aria-busy="true"]')).toBeNull();
  await act(async () => button(en.draw.keys.done, dialog).click());
  expect(container.querySelector("dialog")).toBeNull();
});

it("keeps the current QR open when an earlier person joins during a roster refresh", async () => {
  prepareKey.mockImplementation(async (id: string) => key(id));
  await act(async () => button(en.auth.showQr).click());
  await act(async () => button(en.draw.keys.nextPerson).click());
  await render([{...people[0], joined: true}, people[1]]);
  const dialog = container.querySelector("dialog[open]")!;
  expect(dialog).not.toBeNull();
  expect(dialog.querySelector("h2")?.textContent).toBe(en.draw.keys.qrTitle.replace("{name}", "Sam"));
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(key("sam").key!.qr);
  expect(prepareKey).toHaveBeenCalledTimes(2);
  await act(async () => button(en.draw.keys.done, dialog).click());
  expect(container.querySelector("dialog")).toBeNull();
});
