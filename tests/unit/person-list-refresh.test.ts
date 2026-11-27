import {beforeEach, expect, it, vi} from "vitest";
import en from "../../messages/en.json";

const {getWishlist, revalidatePath, revealMyPerson, viewer} = vi.hoisted(() => ({
  getWishlist: vi.fn(), revalidatePath: vi.fn(), revealMyPerson: vi.fn(),
  viewer: {familyId: "family", personId: "member", actingAs: "member", isOrganizer: false, sessionId: "session"},
}));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", async () => {
  const {createTranslator} = await import("next-intl");
  return {getTranslations: async () => createTranslator({locale: "en", messages: en, namespace: "lists"})};
});
vi.mock("next/cache", () => ({revalidatePath}));
vi.mock("next/navigation", () => ({redirect: vi.fn()}));
vi.mock("@/server/auth", () => ({requireViewer: async () => viewer}));
vi.mock("@/server/lists", () => ({getWishlist}));
vi.mock("@/server/draw", () => ({revealMyPerson}));

import {readPersonList} from "../../src/app/[locale]/exchanges/actions";

beforeEach(() => {
  getWishlist.mockReset();
  revalidatePath.mockReset();
  revealMyPerson.mockReset();
});

it("reads the known recipient's current wishlist with the authenticated viewer without revealing again", async () => {
  getWishlist.mockResolvedValue({owner: {noClothes: false}, sizes: [{kind: "tops", value: "M"}], about: {likes: "Hiking"},
    items: [{id: "scarf", title: "Blue scarf", store: null, price: "20.00", note: null, starred: false, hasPhoto: true, hasIcon: false}]});
  expect(await readPersonList("alex")).toEqual({sizes: "Tops M", likes: "Hiking", items: [
    {id: "scarf", title: "Blue scarf", store: null, price: "20.00", note: null, starred: false, photo: "photo"},
  ]});
  expect(getWishlist).toHaveBeenCalledWith(viewer, "alex");
  expect(revealMyPerson).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("returns no replacement list when authorized wishlist access fails", async () => {
  getWishlist.mockRejectedValue(new Error("unavailable"));
  expect(await readPersonList("alex")).toBeUndefined();
  expect(revealMyPerson).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});
