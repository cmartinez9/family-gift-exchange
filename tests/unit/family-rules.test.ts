import {randomUUID} from "node:crypto";
import {expect, it, vi} from "vitest";

const {viewer, setKeepApart, setParticipants, revalidatePath, redirect, addMembers, withFamily, transaction} = vi.hoisted(() => ({
  viewer: {familyId: "family", personId: "organizer"},
  setKeepApart: vi.fn(), setParticipants: vi.fn(), revalidatePath: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error(href); }), addMembers: vi.fn(), withFamily: vi.fn(), transaction: {},
}));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({getLocale: async () => "en", getTranslations: async () => (key: string) => key}));
vi.mock("next/cache", () => ({revalidatePath}));
vi.mock("next/navigation", () => ({redirect}));
vi.mock("@/server/auth", () => ({requireViewer: async () => viewer}));
vi.mock("@/server/auth/families", () => ({addMembers}));
vi.mock("@/server/db/client", () => ({withFamily}));
vi.mock("@/server/draw", () => ({setKeepApart, setParticipants, DrawError: class extends Error {code = "drawLocked";}}));

import {DrawError} from "@/server/draw";
import {addNames, updatePair} from "../../src/app/[locale]/family/actions";
import {saveRosterAndContinue} from "../../src/app/[locale]/exchanges/actions";

it("adds two Alex entries together without merging their display names", async () => {
  withFamily.mockImplementation(async (_family, action) => action(transaction));
  addMembers.mockResolvedValueOnce(null);
  withFamily.mockClear();
  const data = new FormData();
  data.set("names", "Alex, Alex");
  expect(await addNames({}, data)).toEqual({success: "saved", added: 2});
  expect(withFamily).toHaveBeenCalledOnce();
  expect(addMembers).toHaveBeenLastCalledWith(transaction, viewer, ["Alex", "Alex"], "en");
});

it("returns a rejected batch without refreshing the roster as though it succeeded", async () => {
  withFamily.mockImplementation(async (_family, action) => action(transaction));
  addMembers.mockResolvedValueOnce("familyFull");
  revalidatePath.mockClear();
  const data = new FormData();
  data.set("names", "Alex, Alex");
  expect(await addNames({}, data)).toEqual({error: "familyFull"});
  expect(revalidatePath).not.toHaveBeenCalled();
});

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

it("saves the roster through its setup action before continuing to households", async () => {
  const exchangeId = randomUUID();
  const selected = [randomUUID(), randomUUID()];
  const data = new FormData();
  selected.forEach((id) => data.append("people", id));
  await expect(saveRosterAndContinue(exchangeId, {}, data)).rejects.toThrow("/en/family");
  expect(setParticipants).toHaveBeenLastCalledWith(viewer, exchangeId, selected);
  expect(revalidatePath).toHaveBeenCalledWith("/en/exchanges", "layout");
});

it("keeps a rejected roster on its setup step", async () => {
  revalidatePath.mockClear();
  redirect.mockClear();
  setParticipants.mockRejectedValueOnce(new DrawError("drawLocked"));
  expect(await saveRosterAndContinue(randomUUID(), {}, new FormData())).toEqual({error: "errors.drawLocked"});
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});
