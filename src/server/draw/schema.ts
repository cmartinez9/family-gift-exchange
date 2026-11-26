import {sql} from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import {exchanges, families, familyId, instant, participants, people} from "../db/schema";
import type {DrawPerson, KeepApartPair} from "./solver";

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
  // The question and answer payloads are base64-encoded AES-GCM records.
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

// Pin the rules used for the sealed draw. Checking a live draw must not
// test arbitrary constraints added to the family after the draw.
export const drawRuleSnapshots = pgTable("draw_rule_snapshots", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  roster: jsonb("roster").$type<DrawPerson[]>().notNull(),
  keepApart: jsonb("keep_apart").$type<KeepApartPair[]>().notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId]}),
  foreignKey({
    name: "draw_rule_snapshots_exchange_fk",
    columns: [table.familyId, table.exchangeId],
    foreignColumns: [exchanges.familyId, exchanges.id],
  }),
]);

// First opening per session and draw version. A repair can carry forward seen
// status without creating an opening for a session that never opened that version.
export const drawOpenings = pgTable("draw_openings", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  giverId: uuid("giver_id").notNull(),
  version: integer("version").notNull(),
  viewerId: uuid("viewer_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  openedAt: instant("opened_at").defaultNow().notNull(),
  invalidatedAt: instant("invalidated_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId, table.giverId, table.version, table.sessionId]}),
  check("draw_openings_positive_version", sql`${table.version} > 0`),
  foreignKey({
    name: "draw_openings_giver_fk",
    columns: [table.familyId, table.exchangeId, table.giverId],
    foreignColumns: [participants.familyId, participants.exchangeId, participants.personId],
  }),
  foreignKey({
    name: "draw_openings_viewer_fk",
    columns: [table.familyId, table.viewerId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const drawReports = pgTable("draw_reports", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  giverId: uuid("giver_id").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId, table.giverId]}),
  foreignKey({
    name: "draw_reports_giver_fk",
    columns: [table.familyId, table.exchangeId, table.giverId],
    foreignColumns: [participants.familyId, participants.exchangeId, participants.personId],
  }),
]);

export const practiceFamilies = pgTable("draw_practice_families", {
  familyId: familyId(),
  ownerId: uuid("owner_id").notNull(),
  practiceFamilyId: uuid("practice_family_id").notNull().unique().references(() => families.id, {onDelete: "cascade"}),
  practiceOrganizerId: uuid("practice_organizer_id").notNull(),
  exchangeId: uuid("exchange_id").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.ownerId]}),
  foreignKey({
    name: "draw_practice_families_owner_fk",
    columns: [table.familyId, table.ownerId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "draw_practice_families_organizer_fk",
    columns: [table.practiceFamilyId, table.practiceOrganizerId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "draw_practice_families_exchange_fk",
    columns: [table.practiceFamilyId, table.exchangeId],
    foreignColumns: [exchanges.familyId, exchanges.id],
  }),
]);
