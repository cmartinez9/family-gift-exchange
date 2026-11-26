export const exchangeTimeZone = "America/Chicago";

const calendar = new Intl.DateTimeFormat("en-US", {
  timeZone: exchangeTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
});

export function tomorrowInExchangeCalendar(now: Date) {
  const parts = calendar.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1)).toISOString().slice(0, 10);
}
