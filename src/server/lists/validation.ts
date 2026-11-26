export const LIST_CAP = 300;
export const NOTE_LIMIT = 500;
export const TITLE_LIMIT = 200;

export const itemKinds = ["link", "photo", "note"] as const;
export type ItemKind = typeof itemKinds[number];

export function listText(value: string, max: number) {
  const cleaned = value.trim();
  return !cleaned.includes("\u0000") && [...cleaned].length <= max ? cleaned : undefined;
}

/** Validate and normalize unsigned USD amounts for numeric(10,2). */
export function usdAmount(value: string): string | null | undefined {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) return undefined;
  return `${Number(match[1])}.${(match[2] ?? "").padEnd(2, "0")}`;
}

export function isOverBudget(price: string | null, budgetAmount: string | null) {
  if (price === null || budgetAmount === null) return false;
  return Number(price) > Number(budgetAmount);
}

export const sizePresets = {
  tops: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "NB", "0–3M", "3–6M", "6–9M", "9–12M",
    "12–18M", "18–24M", "2T", "3T", "4T", "5T", "6", "7", "8", "10", "12", "14", "16"],
  bottoms: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "NB", "0–3M", "3–6M", "6–9M", "9–12M",
    "12–18M", "18–24M", "2T", "3T", "4T", "5T", "6", "7", "8", "10", "12", "14", "16"],
  waist: ["24", "26", "28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48"],
  length: ["26", "28", "29", "30", "31", "32", "33", "34", "36", "38"],
  shoeSystem: ["us-women", "us-men", "us-kids", "eu", "uk", "other"],
  shoes: ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5",
    "11", "11.5", "12", "12.5", "13", "13.5", "1Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y"],
  dress: ["00", "0", "2", "4", "6", "8", "10", "12", "14", "16", "18", "20", "22", "24"],
  ring: ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "11", "12"],
  hat: ["XS", "S", "M", "L", "XL", "XXL"],
  gloves: ["XS", "S", "M", "L", "XL", "XXL"],
  other: [],
} as const;

export type SizeKind = keyof typeof sizePresets;
export const sizeKinds = Object.keys(sizePresets) as SizeKind[];

export function isSizeKind(kind: string): kind is SizeKind {
  return Object.hasOwn(sizePresets, kind);
}

export function sizeValue(kind: SizeKind, rawValue: string) {
  const value = listText(rawValue, kind === "other" ? 160 : 40);
  if (kind === "shoeSystem" && value && !sizePresets.shoeSystem.some((preset) => preset === value)) {
    return undefined;
  }
  return value;
}

export function isListReady(itemCount: number, noClothes: boolean, answered: ReadonlySet<string>) {
  return itemCount > 0 && (noClothes || (
    answered.has("tops") && (answered.has("bottoms") || (answered.has("waist") && answered.has("length"))) &&
    answered.has("shoeSystem") && answered.has("shoes")
  ));
}

export const aboutFields = ["likes", "dislikes", "allergies", "colors"] as const;
export type AboutField = typeof aboutFields[number];
