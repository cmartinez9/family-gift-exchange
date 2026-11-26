import {redirect} from "next/navigation";
import {expect, it, vi} from "vitest";
import {runListAction} from "../../src/app/[locale]/lists/client-action";

it("preserves returned action results and errors", async () => {
  const saved = {status: "saved" as const};
  const denied = {error: "forbidden" as const};
  expect(await runListAction(async () => saved)).toBe(saved);
  expect(await runListAction(async () => denied)).toBe(denied);
});

it("converts rejected requests into the existing save feedback", async () => {
  await expect(runListAction(() => Promise.reject(new TypeError("Failed to fetch"))))
    .resolves.toEqual({error: "could-not-save"});
});

it("handles a request that throws before returning a promise", async () => {
  const action = vi.fn(() => { throw new Error("Disconnected"); });
  await expect(runListAction(action)).resolves.toEqual({error: "could-not-save"});
  expect(action).toHaveBeenCalledOnce();
});

it("preserves Next redirects for the router to handle", async () => {
  let navigation: unknown;
  try {
    redirect("/en/lists/owner");
  } catch (error) {
    navigation = error;
  }
  expect(navigation).toBeInstanceOf(Error);
  await expect(runListAction(() => Promise.reject(navigation))).rejects.toBe(navigation);
});
