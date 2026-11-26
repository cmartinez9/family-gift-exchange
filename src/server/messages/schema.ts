import {foreignKey, index, pgTable, primaryKey, text, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {sessions} from "../auth/schema";
import {familyId, people} from "../db/schema";

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
