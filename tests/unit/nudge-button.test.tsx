// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {NextIntlClientProvider} from "next-intl";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";
import {NudgeButton} from "../../src/app/[locale]/exchanges/nudge-button";

const {nudgePerson} = vi.hoisted(() => ({nudgePerson: vi.fn()}));
vi.mock("../../src/app/[locale]/exchanges/nudge-actions", () => ({nudgePerson}));
vi.mock("@/components/ui/toast", () => ({toast: vi.fn()}));
vi.mock("@/i18n/navigation", () => ({Link: () => null}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2033-01-10T16:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({matches: true}));
  nudgePerson.mockReset().mockResolvedValue("sent");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(nudged = false, day = "2033-01-10") {
  await act(async () => root.render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="America/Chicago">
      <NudgeButton exchangeId="exchange" personId="person" name="Rosa" day={day} nudged={nudged} />
    </NextIntlClientProvider>,
  ));
}

it("honors refreshed server state in both directions without remounting", async () => {
  await render(false);
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Nudge Rosa");
  await render(true);
  expect(container.querySelector("button")).toBeNull();
  expect(container.textContent).toBe("Nudged");
  await render(false);
  expect(container.querySelector("button")).not.toBeNull();
});

it.each(["sent", "already"])("retains a local %s result until the server state changes", async (result) => {
  nudgePerson.mockResolvedValue(result);
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(nudgePerson).toHaveBeenCalledExactlyOnceWith("exchange", "person");
  expect(container.textContent).toBe("Nudged");
  await render();
  expect(container.querySelector("button")).toBeNull();
  await render(true);
  await render(false);
  expect(container.querySelector("button")).not.toBeNull();
});

it.each([false, true])("resets a %s server nudge at Chicago midnight while the page stays mounted", async (nudged) => {
  await render(nudged);
  if (!nudged) await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  vi.setSystemTime(new Date("2033-01-11T00:00:00Z"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.querySelector("button")).toBeNull();
  vi.setSystemTime(new Date("2033-01-11T06:00:00Z"));
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(container.querySelector("button")).not.toBeNull();
  await render(false, "2033-01-11");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.textContent).toBe("Nudged");
  await render(true, "2033-01-11");
  expect(container.querySelector("button")).toBeNull();
});

it("accepts the next day's server props before the calendar timer fires", async () => {
  await render(true);
  vi.setSystemTime(new Date("2033-01-11T06:00:00Z"));
  await render(false, "2033-01-11");
  expect(container.querySelector("button")).not.toBeNull();
  await render(true, "2033-01-11");
  expect(container.textContent).toBe("Nudged");
});

it("keeps the nudge available when delivery is unavailable", async () => {
  nudgePerson.mockResolvedValue("unavailable");
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector("button")).not.toBeNull();
});
