import "server-only";
import {and, asc, eq, gt, isNull, sql} from "drizzle-orm";
import {after} from "next/server";
import {sessions} from "../auth/schema";
import {withFamily} from "../db/client";
import {outbox, people} from "../db/schema";
import {exchangeTimeZone} from "./calendar";
import {createPushSender, pushConfig, type PushPayload, type PushSender} from "./push";
import {isPushProduction} from "./queue";
import {pushSubscriptions} from "./schema";
import {readTemplateContent, renderMessage, renderPrivatePush} from "./templates";

export async function deliverPendingPushForFamily(familyId: string, sender?: PushSender) {
  if (!isPushProduction()) return;
  const config = pushConfig();
  const availableSender = sender ?? (config && createPushSender(config));
  if (!availableSender) return;
  const send: PushSender = availableSender;

  let cursor: {createdAt: string; id: string} | undefined;
  const batchSize = 10;
  while (true) {
    const batch = await withFamily(familyId, async (tx) => {
      // Calendar reminders expire at local midnight, including across daylight saving changes.
      const startOfDay = sql`date_trunc('day', now() AT TIME ZONE ${exchangeTimeZone}::text)`;
      const messages = await tx.select({
        id: outbox.id,
        createdAt: sql<string>`${outbox.createdAt}::text`,
        sentAt: outbox.sentAt,
        personId: outbox.personId,
        language: outbox.language,
        template: outbox.template,
        requesterName: outbox.requesterName,
        pushAttempts: outbox.pushAttempts,
        helperId: people.helperId,
        removedAt: people.removedAt,
        reminderTtl: sql<number | null>`CASE WHEN ${outbox.template} IN ('gift-day-reminder', 'list-reminder')
          THEN CASE WHEN ${outbox.createdAt} < (${startOfDay} AT TIME ZONE ${exchangeTimeZone}::text) THEN 0
          ELSE floor(extract(epoch FROM (
            ((${startOfDay} + interval '1 day') AT TIME ZONE ${exchangeTimeZone}::text) - now()
          )))::integer END END`,
      }).from(outbox)
        .innerJoin(people, and(eq(people.familyId, outbox.familyId), eq(people.id, outbox.personId)))
        .where(and(
          eq(outbox.familyId, familyId), eq(outbox.channel, "push"), eq(outbox.status, "pending"),
          cursor ? sql`(${outbox.createdAt}, ${outbox.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .limit(batchSize)
        .for("update", {of: outbox, skipLocked: true});

      async function deliverMessage(message: (typeof messages)[number]) {
        const addressedTo = message.helperId ?? message.personId;
        const subscriptions = message.removedAt || message.reminderTtl === 0 ? [] : await tx.select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
          sessionId: pushSubscriptions.sessionId,
        }).from(pushSubscriptions)
          .innerJoin(people, and(eq(people.familyId, pushSubscriptions.familyId), eq(people.id, pushSubscriptions.personId)))
          .innerJoin(sessions, and(
            eq(sessions.familyId, pushSubscriptions.familyId), eq(sessions.id, pushSubscriptions.sessionId),
            eq(sessions.personId, pushSubscriptions.personId),
          ))
          .where(and(
            eq(pushSubscriptions.familyId, familyId), eq(pushSubscriptions.personId, addressedTo), isNull(people.removedAt),
            isNull(people.helperId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()),
          ));

        const content = readTemplateContent(message);
        const payload: PushPayload | null = content && {
          // Requester names stay in the organizer's authenticated inbox.
          ...(message.helperId || content.template === "pin-reset-request"
            ? renderPrivatePush(message.language) : renderMessage(message.language, content)),
          url: `/${message.language}/notifications`,
          tag: message.id,
        };
        const results = payload ? await Promise.all(subscriptions.map(async (subscription) => {
          const result = await send(subscription, payload, message.reminderTtl ?? undefined).catch(() => "retry" as const);
          if (result === "gone") {
            await tx.delete(pushSubscriptions).where(and(
              eq(pushSubscriptions.familyId, familyId),
              eq(pushSubscriptions.sessionId, subscription.sessionId),
              eq(pushSubscriptions.endpoint, subscription.endpoint),
              eq(pushSubscriptions.p256dh, subscription.p256dh),
              eq(pushSubscriptions.auth, subscription.auth),
            ));
          }
          return result;
        })) : [];

        const pushAttempts = message.pushAttempts + 1;
        const sentAt = message.sentAt ?? (results.includes("sent") ? new Date() : null);
        const status = results.includes("retry") && pushAttempts < 3 ? "pending"
          : sentAt ? "sent"
          : results.some((result) => result === "retry" || result === "failed") ? "failed"
          : "skipped";
        await tx.update(outbox).set({status, pushAttempts, sentAt})
          .where(and(eq(outbox.familyId, familyId), eq(outbox.id, message.id)));
      }

      const byRecipient = Map.groupBy(messages, (message) => message.helperId ?? message.personId);
      await Promise.all([...byRecipient.values()].map(async (group) => {
        for (const message of group) await deliverMessage(message);
      }));
      return messages;
    });
    if (batch.length < batchSize) return;
    cursor = batch.at(-1);
  }
}

export function schedulePushDelivery(familyId: string) {
  if (!isPushProduction() || !pushConfig()) return;
  try {
    after(() => deliverPendingPushForFamily(familyId));
  } catch (error) {
    // Standalone domain callers do not have a Next.js request. Cron drains their queue.
    if (!(error instanceof Error) || !error.message.includes("outside a request scope")) throw error;
  }
}
