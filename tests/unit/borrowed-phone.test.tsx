// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {HelpingKey} from "../../src/app/[locale]/sign-in/helping";
import {SizesStep} from "../../src/app/[locale]/welcome/steps";
import {BorrowedAllSet, HandBack} from "../../src/app/[locale]/welcome/borrowed/hand-back";

const borrowed = vi.hoisted(() => ({returnPhone: vi.fn(), hideOnBorrowedPhone: vi.fn(), revealOnBorrowedPhone: vi.fn()}));
const router = vi.hoisted(() => ({push: vi.fn(), replace: vi.fn()}));
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
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: true, addEventListener() {}, removeEventListener() {}}));
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
  await render(<HandBack name="Rosa" owner="Ana" shown />);
  expect(container.querySelector("h1")?.textContent).toBe("Hand this phone back to Ana");
  expect(container.querySelector("[role=status]")?.textContent)
    .toBe("Rosa's person is hidden again. Nobody holding this phone can see who it is.");
  expect(container.textContent).toContain("Next, Ana can help with Rosa's sizes and list.");
  await click("Ana has the phone");
  expect(router.replace).toHaveBeenCalledWith("/welcome/sizes");
  expect(router.push).not.toHaveBeenCalled();

  await render(<HandBack name="Rosa" owner="Ana" shown={false} />);
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
