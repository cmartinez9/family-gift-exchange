import {timingSafeEqual} from "node:crypto";
import {runDailyReminders} from "../../../../server/messages/reminders";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);

  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return new Response(null, {status: 401});
  }

  await runDailyReminders();
  return new Response(null, {status: 204});
}
