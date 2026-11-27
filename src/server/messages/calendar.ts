export const exchangeTimeZone = "America/Chicago";

const calendar = new Intl.DateTimeFormat("en-US", {
  timeZone: exchangeTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
});

function exchangeDate(now: Date) {
  const parts = calendar.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

export function tomorrowInExchangeCalendar(now: Date) {
  return new Date(exchangeDate(now) + 86_400_000).toISOString().slice(0, 10);
}

export function daysUntilInExchangeCalendar(giftDay: string, now: Date) {
  return Math.round((Date.parse(giftDay) - exchangeDate(now)) / 86_400_000);
}

export function todayInExchangeCalendar(now: Date) {
  return new Date(exchangeDate(now)).toISOString().slice(0, 10);
}
