import "server-only";
import {and, count, desc, eq, isNull, or, sql} from "drizzle-orm";
import type {Viewer} from "../auth";
import {withFamily} from "../db/client";
import type {FamilyTransaction} from "../db/database";
import {outbox, people} from "../db/schema";
import {readTemplateContent, renderMessage} from "./templates";

type InboxViewer = Pick<Viewer, "familyId" | "personId" | "actingAs">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function canReadInbox(tx: FamilyTransaction, viewer: InboxViewer) {
  const [owner] = await tx.select({id: people.id}).from(people).where(and(
    eq(people.familyId, viewer.familyId),
    eq(people.id, viewer.actingAs),
    isNull(people.removedAt),
    or(eq(people.id, viewer.personId), eq(people.helperId, viewer.personId)),
  ));
  return Boolean(owner);
}

function inboxScope(viewer: InboxViewer) {
  return and(eq(outbox.familyId, viewer.familyId), eq(outbox.personId, viewer.actingAs), eq(outbox.channel, "push"));
}

export async function getUnreadCount(viewer: InboxViewer) {
  return withFamily(viewer.familyId, async (tx) => {
    if (!await canReadInbox(tx, viewer)) return 0;
    const [unread] = await tx.select({total: count()}).from(outbox)
      .where(and(inboxScope(viewer), isNull(outbox.readAt)));
    return unread.total;
  });
}

export function listNotifications(viewer: InboxViewer) {
  return withFamily(viewer.familyId, async (tx) => {
    if (!await canReadInbox(tx, viewer)) return [];
    const notices = await tx.select({
      id: outbox.id,
      template: outbox.template,
      requesterName: outbox.requesterName,
      language: outbox.language,
      createdAt: outbox.createdAt,
      readAt: outbox.readAt,
    }).from(outbox).where(inboxScope(viewer))
      .orderBy(desc(outbox.createdAt), desc(outbox.id)).limit(100);
    return notices.flatMap((notice) => {
      const content = readTemplateContent(notice);
      if (!content) return [];
      return [{
        id: notice.id,
        createdAt: notice.createdAt,
        language: notice.language,
        isRead: notice.readAt !== null,
        isPinResetRequest: content.template === "pin-reset-request",
        ...renderMessage(notice.language, content),
      }];
    });
  });
}

export async function markNotificationRead(viewer: InboxViewer, id: unknown) {
  if (typeof id !== "string" || !uuid.test(id)) return;
  await withFamily(viewer.familyId, async (tx) => {
    if (!await canReadInbox(tx, viewer)) return;
    await tx.update(outbox).set({readAt: sql`now()`})
      .where(and(inboxScope(viewer), eq(outbox.id, id), isNull(outbox.readAt)));
  });
}
