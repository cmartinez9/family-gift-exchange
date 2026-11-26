import {DrawError} from "./access";
import {maximumPeople} from "./solver";

export type ExchangeDetails = {
  name: string;
  giftDay: string | null;
  giftTime: string | null;
  place: string | null;
  budgetAmount: string | null;
  listDeadline: string | null;
  drawDay: string | null;
};

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function recordId(value: string) {
  if (!uuid.test(value)) throw new DrawError("notFound");
  return value.toLowerCase();
}

export function participantIds(values: readonly string[]) {
  if (values.length > maximumPeople || values.some((value) => !uuid.test(value))) {
    throw new DrawError("invalidParticipants");
  }
  return [...new Set(values.map((id) => id.toLowerCase()))];
}

function validateDay(value: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) {
    throw new DrawError("invalidDetails");
  }
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new DrawError("invalidDetails");
  }
  return value;
}

export function exchangeDetails(details: ExchangeDetails): ExchangeDetails {
  const name = details.name.trim();
  const place = details.place?.trim() || null;
  const amount = details.budgetAmount?.trim() || null;
  const giftTime = details.giftTime || null;
  const giftDay = validateDay(details.giftDay);
  if (
    !name || name.length > 100 || (place && place.length > 200) ||
    (amount && !/^\d{1,8}(\.\d{1,2})?$/.test(amount)) ||
    (giftTime && (!giftDay || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(giftTime)))
  ) throw new DrawError("invalidDetails");

  const [dollars, cents = ""] = amount?.split(".") ?? [];
  return {
    name, place, giftDay, giftTime,
    budgetAmount: amount ? `${Number(dollars)}.${cents.padEnd(2, "0")}` : null,
    drawDay: validateDay(details.drawDay),
    listDeadline: validateDay(details.listDeadline),
  };
}

export function questionText(value: string) {
  const text = value.trim();
  if (!text || text.length > 500) throw new DrawError("invalidQuestion");
  return text;
}
