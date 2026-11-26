import fc from "fast-check";
import {expect, it, vi} from "vitest";
import {hidesClaims} from "../../src/server/lists/access";
import {isListReady, isOverBudget, listText, sizeValue, usdAmount} from "../../src/server/lists/validation";

vi.mock("server-only", () => ({}));

it("hides claims for the signed-in owner and the person a helper is acting for", () => {
  const viewer = {personId: "helper", familyId: "family", actingAs: "child"};
  expect(hidesClaims(viewer, "helper")).toBe(true);
  expect(hidesClaims(viewer, "child")).toBe(true);
  expect(hidesClaims(viewer, "other")).toBe(false);
});

it("uses the same ready rule for normal sizes, waist and length, and no clothes", () => {
  const waistAndLength = new Set(["tops", "waist", "length", "shoeSystem", "shoes"]);
  expect(isListReady(1, false, waistAndLength)).toBe(true);
  waistAndLength.delete("length");
  expect(isListReady(1, false, waistAndLength)).toBe(false);
  waistAndLength.add("bottoms");
  expect(isListReady(1, false, waistAndLength)).toBe(true);
  expect(isListReady(0, true, waistAndLength)).toBe(false);
  expect(isListReady(1, true, new Set())).toBe(true);
});

it("supports custom sizes, validates shoe systems and counts Unicode note characters", () => {
  expect(sizeValue("tops", "  4T ")).toBe("4T");
  expect(sizeValue("other", "Extra long sleeves")).toBe("Extra long sleeves");
  expect(sizeValue("shoeSystem", "eu")).toBe("eu");
  expect(sizeValue("shoeSystem", "something unexpected")).toBeUndefined();
  expect(sizeValue("shoeSystem", "")).toBe("");
  expect(listText("🎁".repeat(500), 500)).toHaveLength(1000);
  expect(listText("🎁".repeat(501), 500)).toBeUndefined();
});

it("normalizes dollar and cent input and compares the amounts consistently", () => {
  fc.assert(fc.property(fc.nat(9_999_999_999), fc.nat(9_999_999_999), (price, budget) => {
    const display = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    const formattedPrice = display(price);
    const formattedBudget = display(budget);
    expect(usdAmount(formattedPrice.replace(".", ","))).toBe(formattedPrice);
    expect(usdAmount(formattedBudget)).toBe(formattedBudget);
    expect(isOverBudget(formattedPrice, formattedBudget)).toBe(price > budget);
  }));
  expect(usdAmount("-5")).toBeUndefined();
  expect(usdAmount("1e2")).toBeUndefined();
  expect(usdAmount("")).toBeNull();
  expect(isOverBudget("2.00", null)).toBe(false);
});
