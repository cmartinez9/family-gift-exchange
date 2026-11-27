import {afterEach, expect, it, vi} from "vitest";
import {GET} from "../../src/app/api/cron/notifications/route";
import {todayInExchangeCalendar, tomorrowInExchangeCalendar} from "../../src/server/messages/calendar";
import {runDailyReminders} from "../../src/server/messages/reminders";

vi.mock("../../src/server/messages/reminders", () => ({runDailyReminders: vi.fn()}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const url = "https://gifts.example/api/cron/notifications";
it("schedules reminders using the exchange calendar instead of UTC midnight", () => {
  expect(tomorrowInExchangeCalendar(new Date("2032-12-24T05:59:00Z"))).toBe("2032-12-24");
  expect(tomorrowInExchangeCalendar(new Date("2032-12-24T06:00:00Z"))).toBe("2032-12-25");
});

it("counts once-a-day nudges by the exchange calendar day", () => {
  expect(todayInExchangeCalendar(new Date("2032-12-11T05:59:00Z"))).toBe("2032-12-10");
  expect(todayInExchangeCalendar(new Date("2032-12-11T06:00:00Z"))).toBe("2032-12-11");
  // daylight saving: Chicago is UTC-5 in summer
  expect(todayInExchangeCalendar(new Date("2032-07-04T04:59:00Z"))).toBe("2032-07-03");
});

it("rejects absent, wrong, and unconfigured secrets before running the job", async () => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  expect((await GET(new Request(url))).status).toBe(401);
  expect((await GET(new Request(url, {headers: {authorization: "Bearer fake-cron-secret"}}))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", undefined);
  expect((await GET(new Request(url, {headers: {authorization: "Bearer undefined"}}))).status).toBe(401);
  expect(runDailyReminders).not.toHaveBeenCalled();
});

it("runs the job with Vercel's bearer authorization header", async () => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  expect((await GET(new Request(url, {headers: {authorization: "Bearer test-cron-secret"}}))).status).toBe(204);
  expect(runDailyReminders).toHaveBeenCalledOnce();
});
