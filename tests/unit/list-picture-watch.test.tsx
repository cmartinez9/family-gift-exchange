// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {PictureWatch} from "../../src/app/[locale]/lists/picture-watch";
import {PICTURE_WAIT_MS} from "../../src/server/lists/validation";

const router = vi.hoisted(() => ({refresh: vi.fn()}));
vi.mock("next/navigation", () => ({useRouter: () => router}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  router.refresh.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reloads the list while a picture is on its way, and stops when it lands", () => {
  act(() => root.render(<PictureWatch waiting />));
  act(() => { vi.advanceTimersByTime(3000); });
  expect(router.refresh).toHaveBeenCalledTimes(2);
  act(() => root.render(<PictureWatch waiting={false} />));
  act(() => { vi.advanceTimersByTime(6000); });
  expect(router.refresh).toHaveBeenCalledTimes(2);
});

it("gives up once the wait runs out and skips a page in the background", () => {
  act(() => root.render(<PictureWatch waiting />));
  act(() => { vi.advanceTimersByTime(PICTURE_WAIT_MS + 10_000); });
  const calls = router.refresh.mock.calls.length;
  expect(calls).toBeLessThanOrEqual(Math.ceil(PICTURE_WAIT_MS / 1500) + 1);
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(router.refresh).toHaveBeenCalledTimes(calls);

  act(() => root.render(<PictureWatch waiting={false} />));
  router.refresh.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  act(() => root.render(<PictureWatch waiting />));
  act(() => { vi.advanceTimersByTime(6000); });
  expect(router.refresh).not.toHaveBeenCalled();
});

it("does nothing when nothing is waiting", () => {
  act(() => root.render(<PictureWatch waiting={false} />));
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(router.refresh).not.toHaveBeenCalled();
});
