import {randomUUID} from "node:crypto";
import {expect, it, vi} from "vitest";

const {viewer, setKeepApart, revalidatePath} = vi.hoisted(() => ({
  viewer: {familyId: "family", personId: "organizer"},
  setKeepApart: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en"}));
vi.mock("next/cache", () => ({revalidatePath}));
vi.mock("@/server/auth", () => ({requireViewer: async () => viewer}));
vi.mock("@/server/draw", () => ({setKeepApart, DrawError: class extends Error {code = "drawLocked";}}));

import {DrawError} from "@/server/draw";
import {updatePair} from "../../src/app/[locale]/family/actions";

it("routes family additions and removals to the exchange-scoped draw editor", async () => {
  const exchangeId = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  const data = new FormData();
  data.set("first", first);
  data.set("second", second);
  expect(await updatePair(exchangeId, null, {}, data)).toEqual({success: "saved"});
  expect(setKeepApart).toHaveBeenLastCalledWith(viewer, exchangeId, first, second, "custom");
  expect(await updatePair(exchangeId, [second, first], {}, new FormData())).toEqual({success: "saved"});
  expect(setKeepApart).toHaveBeenLastCalledWith(viewer, exchangeId, second, first, null);
  expect(revalidatePath).toHaveBeenCalledWith("/en/exchanges", "layout");
  expect(revalidatePath).toHaveBeenCalledWith("/en/family");
});

it("reports the canonical editor's sealed-draw rejection to the family form", async () => {
  setKeepApart.mockRejectedValueOnce(new DrawError("drawLocked"));
  const pair: [string, string] = [randomUUID(), randomUUID()];
  expect(await updatePair(randomUUID(), pair, {}, new FormData())).toEqual({error: "drawStarted"});
});
