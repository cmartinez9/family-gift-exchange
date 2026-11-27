// @vitest-environment jsdom
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {InstallCard} from "../../src/app/[locale]/_home/install-card";
import {dismissToast, ToastHost} from "../../src/components/ui/toast";

vi.mock("@/i18n/navigation", () => ({
  Link: ({href, children}: {href: string; children: ReactNode}) => <a href={href}>{children}</a>,
}));

const dismissedKey = "fge-install-dismissed";
let container: HTMLDivElement;
let root: Root;

async function render(show = true) {
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
      {show && <InstallCard />}
      <ToastHost undoLabel="Undo" />
    </NextIntlClientProvider>,
  ));
}

async function dismiss() {
  await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${en.homeScreen.installDismiss}"]`)!.click());
}

async function undo() {
  await act(async () => container.querySelector<HTMLButtonElement>(".fge-toast button")!.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()});
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

it.each(["writes", "access"] as const)("keeps dismissal and Undo effective across remounts when storage rejects %s", async (failure) => {
  if (failure === "writes") {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  } else {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  }
  await render();
  expect(container.querySelector("[data-install]")).not.toBeNull();
  await dismiss();
  expect(container.querySelector("[data-install]")).toBeNull();
  expect(container.querySelector(".fge-toast")?.textContent).toContain(en.homeScreen.installDismissed);
  await render(false);
  await render();
  expect(container.querySelector("[data-install]")).toBeNull();
  await undo();
  expect(container.querySelector("[data-install]")).not.toBeNull();
  await render(false);
  await render();
  expect(container.querySelector("[data-install]")).not.toBeNull();
});

it("restores the card when Undo cannot remove a persisted dismissal", async () => {
  await render();
  await dismiss();
  expect(window.localStorage.getItem(dismissedKey)).toBe("1");
  expect(container.querySelector("[data-install]")).toBeNull();
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  await undo();
  expect(window.localStorage.getItem(dismissedKey)).toBe("1");
  expect(container.querySelector("[data-install]")).not.toBeNull();
  await render(false);
  await render();
  expect(container.querySelector("[data-install]")).not.toBeNull();
});

it("resumes persisted dismissal and cross-tab updates after storage recovers", async () => {
  await render();
  await dismiss();
  expect(window.localStorage.getItem(dismissedKey)).toBe("1");
  expect(container.querySelector("[data-install]")).toBeNull();
  await undo();
  expect(window.localStorage.getItem(dismissedKey)).toBeNull();
  expect(container.querySelector("[data-install]")).not.toBeNull();
  await act(async () => {
    window.localStorage.setItem(dismissedKey, "1");
    window.dispatchEvent(new StorageEvent("storage", {key: dismissedKey, newValue: "1"}));
  });
  expect(container.querySelector("[data-install]")).toBeNull();
  await act(async () => {
    window.localStorage.removeItem(dismissedKey);
    window.dispatchEvent(new StorageEvent("storage", {key: dismissedKey, newValue: null}));
  });
  expect(container.querySelector("[data-install]")).not.toBeNull();
});
