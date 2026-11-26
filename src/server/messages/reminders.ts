import "server-only";
import {and, eq, ne, or, sql} from "drizzle-orm";
import {getDatabase, withFamily} from "../db/client";
import {exchanges} from "../db/schema";
import {tomorrowInExchangeCalendar} from "./calendar";
import {deliverPendingPushForFamily} from "./delivery";
import {exchangeRecipients} from "./events";
import {enqueueMessages, isPushProduction, type Message} from "./queue";

export async function runDailyReminders(now = new Date()) {
  const tomorrow = tomorrowInExchangeCalendar(now);
  // The discovery function can return only family IDs with work. All tenant
  // data is read or written as fge_app in the corresponding family scope.
  const families = await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fge_app`);
    return tx.execute<{family_id: string}>(sql`
      select family_id from public.fge_notification_work(${tomorrow}::date, ${isPushProduction()})
    `);
  });

  for (const {family_id: familyId} of families.rows) {
    await withFamily(familyId, async (tx) => {
      const due = await tx.select({
        exchangeId: exchanges.id, listDeadline: exchanges.listDeadline, giftDay: exchanges.giftDay,
      }).from(exchanges).where(and(
        eq(exchanges.familyId, familyId),
        ne(exchanges.status, "closed"),
        or(eq(exchanges.listDeadline, tomorrow), eq(exchanges.giftDay, tomorrow)),
      ));

      for (const {exchangeId, listDeadline, giftDay} of due) {
        const recipients = await exchangeRecipients(tx, {familyId, exchangeId});
        const templates: ("list-reminder" | "gift-day-reminder")[] = [];
        if (listDeadline === tomorrow) templates.push("list-reminder");
        if (giftDay === tomorrow) templates.push("gift-day-reminder");
        await enqueueMessages(tx, templates.flatMap((template) =>
          recipients.map((recipient): Message => ({
            ...recipient, familyId, template, dedupeKey: `${template}:${exchangeId}:${tomorrow}`,
          })),
        ));
      }
    });
    await deliverPendingPushForFamily(familyId);
  }
}
