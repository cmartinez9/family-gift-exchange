// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {HelpingKey} from "../../src/app/[locale]/sign-in/helping";
import {DrawError} from "../../src/server/draw";
import BorrowedPhoneError from "../../src/app/[locale]/welcome/borrowed/error";
import BorrowedPhonePage from "../../src/app/[locale]/welcome/borrowed/page";
import {BorrowedPerson} from "../../src/app/[locale]/welcome/borrowed/person";
import {SizesStep} from "../../src/app/[locale]/welcome/steps";
import {BorrowedAllSet, HandBack} from "../../src/app/[locale]/welcome/borrowed/hand-back";

const borrowed = vi.hoisted(() => ({returnPhone: vi.fn(), hideOnBorrowedPhone: vi.fn(), revealOnBorrowedPhone: vi.fn()}));
const drawState = vi.hoisted(() => ({version: 1, status: "drawn", listExchanges: vi.fn(), memberDrawStatus: vi.fn()}));
vi.mock("@/server/auth", () => ({requireViewer: async () => ({familyId: "family", personId: "rosa", borrowed: {hidden: false}})}));
vi.mock("@/server/auth/access", () => ({activePerson: async () => ({displayName: "Rosa"})}));
vi.mock("@/server/auth/borrowed", () => ({phoneOwnerName: async () => "Ana"}));
vi.mock("@/server/db/client", () => ({withFamily: (_family: string, action: () => unknown) => action()}));
vi.mock("@/server/draw", () => ({
  DrawError: class extends Error {constructor(readonly code: string) {super(code);}},
  listExchanges: drawState.listExchanges,
  memberDrawStatus: drawState.memberDrawStatus,
}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en", getTranslations: vi.fn()}));
const router = vi.hoisted(() => ({push: vi.fn(), replace: vi.fn(), refresh: vi.fn()}));
vi.mock("../../src/app/[locale]/welcome/borrowed/actions", () => borrowed);
vi.mock("../../src/app/[locale]/sign-in/actions", () => ({}));
vi.mock("../../src/app/[locale]/lists/actions", () => ({saveProfileField: vi.fn(), previewItemLink: vi.fn()}));
vi.mock("../../src/app/[locale]/welcome/actions", () => ({addFirstThing: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({href, replace, children}: {href: string; replace?: boolean; children: ReactNode}) =>
    <a href={href} data-replace={replace ? "" : undefined}>{children}</a>,
  useRouter: () => router,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  drawState.version = 1;
  drawState.status = "drawn";
  drawState.listExchanges.mockImplementation(async () => [{id: "christmas", status: drawState.status}]);
  drawState.memberDrawStatus.mockImplementation(async () => ({status: "ready", exchange: {id: "christmas", version: drawState.version}}));
  borrowed.hideOnBorrowedPhone.mockResolvedValue({hidden: true});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
  Element.prototype.getAnimations ??= () => [];
  Element.prototype.animate ??= () => ({cancel() {}, finished: Promise.resolve(), onfinish: null}) as unknown as Animation;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">{node}</NextIntlClientProvider>,
  ));
}

async function click(label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(found, label).toBeDefined();
  await act(async () => found!.click());
}

it("tells the person handed the phone what only they do, and that it is not their phone", async () => {
  await render(<HelpingKey name="Rosa" typed={false} lend onHandOver={vi.fn()} onBack={vi.fn()} />);
  await click("Rosa is here with meHand Rosa this phone for the PIN");
  const text = container.textContent;
  expect(text).toContain("Only Rosa makes the PIN and opens Rosa's person. Look away for those.");
  expect(text).toContain("Rosa hides the person again before handing the phone back.");
  expect(text).toContain("No Face ID here: it's your phone, not Rosa's.");
  // the phone's owner never signs out here: Rosa's sign-in ends on its own
  expect(text).not.toContain(en.auth.switchPerson);
});

it("hands the phone back with nothing of the person on screen, then goes on to the sizes in place", async () => {
  await render(<HandBack name="Rosa" owner="Ana" shown sealed />);
  expect(container.querySelector("h1")?.textContent).toBe("Hand this phone back to Ana");
  expect(container.querySelector("[role=status]")?.textContent)
    .toBe("Rosa's person is hidden again. Nobody holding this phone can see who it is.");
  expect(container.textContent).toContain("Next, Ana can help with Rosa's sizes and list.");
  await click("Ana has the phone");
  expect(router.replace).toHaveBeenCalledWith("/welcome/sizes");
  expect(router.push).not.toHaveBeenCalled();

  await render(<HandBack name="Rosa" owner="Ana" shown={false} sealed={false} />);
  expect(container.querySelector("[role=status]")?.textContent)
    .toBe("Rosa's PIN is made. There's no person to open yet, so nothing was shown.");
});

it("keeps every onboarding step out of the history on a borrowed phone", async () => {
  await render(<SizesStep ownerId="rosa" initial={{noClothes: false, sizes: {}}} profileHref="/profile" replace />);
  await click(en.getIn.sizes.next);
  expect(router.replace).toHaveBeenCalledWith("/welcome/list");
  expect(router.push).not.toHaveBeenCalled();
  expect(container.querySelector('a[href="/welcome/list"]')?.hasAttribute("data-replace")).toBe(true);
});

it("waits for sealing before handing back a phone with no drawn person", async () => {
  const sealed = Promise.withResolvers<{hidden: boolean}>();
  borrowed.hideOnBorrowedPhone.mockReturnValueOnce(sealed.promise);
  await render(<BorrowedPerson name="Rosa" owner="Ana" exchange={null} hidden={false} />);
  expect(borrowed.hideOnBorrowedPhone).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Hand this phone back");
  expect(container.querySelector("button")).toBeNull();
  await act(async () => sealed.resolve({hidden: false}));
  expect(container.textContent).not.toContain("Hand this phone back");
  expect(container.querySelector("[role=alert]")?.textContent).toContain(en.borrowed.hideFailed);
  await click(en.draw.person.tryAgain);
  expect(container.querySelector("h1")?.textContent).toBe("Hand this phone back to Ana");
});

it("refreshes a changed draw and opens the new version on retry", async () => {
  borrowed.revealOnBorrowedPhone.mockResolvedValueOnce({error: "refresh"}).mockResolvedValueOnce({name: "Beto"});
  await render(await BorrowedPhonePage());
  await click(en.draw.person.revealTap);
  expect(router.refresh).toHaveBeenCalledOnce();
  drawState.version = 2;
  await render(await BorrowedPhonePage());
  await click(en.draw.person.revealTap);
  expect(borrowed.revealOnBorrowedPhone).toHaveBeenLastCalledWith("christmas", 2);
  expect(container.textContent).toContain("Hide Beto");
});

it("refreshes a closed exchange into the no-person hand-back flow", async () => {
  borrowed.revealOnBorrowedPhone.mockResolvedValue({error: "refresh"});
  await render(await BorrowedPhonePage());
  await click(en.draw.person.revealTap);
  expect(router.refresh).toHaveBeenCalledOnce();
  drawState.status = "closed";
  await render(await BorrowedPhonePage());
  expect(borrowed.hideOnBorrowedPhone).toHaveBeenCalledOnce();
  expect(container.querySelector("h1")?.textContent).toBe("Hand this phone back to Ana");
  expect(container.textContent).toContain("There's no person to open yet");
  await click("Ana has the phone");
  expect(router.replace).toHaveBeenCalledWith("/welcome/sizes");
});

it("clears the displayed person once an expired borrowed session is safely closed", async () => {
  borrowed.revealOnBorrowedPhone.mockResolvedValue({name: "Beto"});
  await render(<BorrowedPerson name="Rosa" owner="Ana" exchange={{id: "christmas", version: 1}} hidden={false} />);
  await click(en.draw.person.revealTap);
  await click("Hide Beto");
  expect(container.textContent).not.toContain("Beto");
  expect(container.querySelector("h1")?.textContent).toBe("Hand this phone back to Ana");
});

it("keeps More sizes in the borrowed onboarding flow", async () => {
  await render(<SizesStep ownerId="rosa" initial={{noClothes: false, sizes: {}}} profileHref="/welcome/sizes/more" replace />);
  const links = [...container.querySelectorAll("a")];
  const more = links.find((link) => link.textContent === en.getIn.sizes.more);
  expect(more?.getAttribute("href")).toBe("/welcome/sizes/more");
  expect(more?.hasAttribute("data-replace")).toBe(true);
  expect(links.every((link) => link.getAttribute("href")?.startsWith("/welcome/"))).toBe(true);
});

it("signs the relative out of the borrowed phone, and says so when that fails", async () => {
  borrowed.returnPhone.mockRejectedValueOnce(new Error("offline"));
  await render(<BorrowedAllSet name="Rosa" owner="Ana" organizer="Christian" />);
  expect(container.querySelector("h1")?.textContent).toBe("Rosa's all set");
  expect(container.textContent).toContain("All 4 steps done, with Ana's help");
  expect(container.textContent).toContain("Next time, on Rosa's own phone: open the same key, or ask Christian for a new one.");
  await click("Sign Rosa out of this phone");
  expect(borrowed.returnPhone).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[role=alert]")?.textContent).toBe("Couldn't sign Rosa out. Check the connection and try again.");
});


it.each(["listExchanges", "memberDrawStatus"] as const)("keeps a %s timeout retryable without sealing the session", async (boundary) => {
  const error = new DrawError("checkTimedOut");
  drawState[boundary].mockRejectedValueOnce(error);
  await expect(BorrowedPhonePage()).rejects.toBe(error);
  await render(<BorrowedPhoneError />);
  expect(container.querySelector("h1")?.textContent).toBe(en.borrowed.title);
  expect(container.querySelector("[role=alert]")?.textContent).toBe(en.borrowed.revealFailed);
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === en.draw.person.tryAgain)).toBe(true);
  expect(container.textContent).not.toContain("Hand this phone back");
  expect(borrowed.hideOnBorrowedPhone).not.toHaveBeenCalled();
});

it("preserves the borrowed session identity in onboarding links", async () => {
  await render(<HandBack name="Rosa" owner="Ana" shown sealed borrowedSessionId="borrowed-rosa" />);
  await click("Ana has the phone");
  expect(router.replace).toHaveBeenCalledWith("/welcome/sizes?borrowed=borrowed-rosa");
  await render(<SizesStep ownerId="rosa" initial={{noClothes: false, sizes: {}}}
    profileHref="/welcome/sizes/more?borrowed=borrowed-rosa" replace borrowedSessionId="borrowed-rosa" />);
  await click(en.getIn.sizes.next);
  expect(router.replace).toHaveBeenCalledWith("/welcome/list?borrowed=borrowed-rosa");
});
