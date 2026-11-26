import {sql} from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import {familyId, instant, participants} from "../db/schema";

const bytea = customType<{data: Buffer}>({dataType: () => "bytea"});

export const assignments = pgTable("assignments", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  giverId: uuid("giver_id").notNull(),
  recipientSealed: bytea("recipient_sealed").notNull(),
  version: integer("version").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId, table.giverId]}),
  check("assignments_positive_version", sql`${table.version} > 0`),
  foreignKey({
    name: "assignments_giver_fk",
    columns: [table.familyId, table.exchangeId, table.giverId],
    foreignColumns: [participants.familyId, participants.exchangeId, participants.personId],
  }),
]);

export const questions = pgTable("questions", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  exchangeId: uuid("exchange_id").notNull(),
  askerId: uuid("asker_id").notNull(),
  recipientSealed: bytea("recipient_sealed").notNull(),
  drawVersion: integer("draw_version").notNull(),
  text: text("text").notNull(),
  answer: text("answer"),
  createdAt: instant("created_at").defaultNow().notNull(),
  answeredAt: instant("answered_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  check("questions_positive_draw_version", sql`${table.drawVersion} > 0`),
  foreignKey({
    name: "questions_asker_fk",
    columns: [table.familyId, table.exchangeId, table.askerId],
    foreignColumns: [participants.familyId, participants.exchangeId, participants.personId],
  }),
]);
