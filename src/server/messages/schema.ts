import {date, foreignKey, index, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {sessions} from "../auth/schema";
import {exchanges, familyId, people} from "../db/schema";

export const pushSubscriptions = pgTable("push_subscriptions", {
  familyId: familyId(),
  personId: uuid("person_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.sessionId]}),
  uniqueIndex("push_subscriptions_family_endpoint_idx").on(table.familyId, table.endpoint),
  index("push_subscriptions_person_idx").on(table.familyId, table.personId),
  foreignKey({
    name: "push_subscriptions_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "push_subscriptions_session_fk",
    columns: [table.familyId, table.sessionId],
    foreignColumns: [sessions.familyId, sessions.id],
  }).onDelete("cascade"),
]);

export const nudgeKind = pgEnum("nudge_kind", ["organizer", "viewed"]);

/**
 * Nudges asked for, by exchange calendar day. An organizer row marks the button as used for the day.
 * A viewed row says only that someone opened this person's empty list; the daily job turns it into
 * a notice and deletes it, so no request-time trace links the nudge to whoever looked.
 */
export const listNudges = pgTable("list_nudges", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  personId: uuid("person_id").notNull(),
  kind: nudgeKind("kind").notNull(),
  day: date("day").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId, table.personId, table.kind, table.day]}),
  foreignKey({
    name: "list_nudges_exchange_fk",
    columns: [table.familyId, table.exchangeId],
    foreignColumns: [exchanges.familyId, exchanges.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "list_nudges_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }).onDelete("cascade"),
]);
