import {expect, it} from "vitest";
import {daysUntilInExchangeCalendar, tomorrowInExchangeCalendar} from "../../src/server/messages/calendar";

it.each([
  ["2032-12-25T00:30:00Z", 1],
  ["2032-12-25T05:59:59Z", 1],
  ["2032-12-25T06:00:00Z", 0],
  ["2032-12-26T00:30:00Z", 0],
  ["2032-12-26T05:59:59Z", 0],
  ["2032-12-26T06:00:00Z", -1],
] as const)("counts gift days in Chicago at %s", (instant, days) => {
  expect(daysUntilInExchangeCalendar("2032-12-25", new Date(instant))).toBe(days);
});

it("counts calendar days across daylight saving and year boundaries", () => {
  expect(daysUntilInExchangeCalendar("2032-03-15", new Date("2032-03-14T06:00:00Z"))).toBe(1);
  expect(daysUntilInExchangeCalendar("2033-01-01", new Date("2033-01-01T05:59:59Z"))).toBe(1);
  expect(tomorrowInExchangeCalendar(new Date("2033-01-01T05:59:59Z"))).toBe("2033-01-01");
});
