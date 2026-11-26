import {sql} from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const language = pgEnum("language", ["en", "es"]);
export const personRole = pgEnum("person_role", ["organizer", "co_organizer", "member"]);
export const exchangeStatus = pgEnum("exchange_status", ["setup", "open", "drawn", "locked", "closed"]);
export const participantStatus = pgEnum("participant_status", ["in", "out"]);
export const keepApartReason = pgEnum("keep_apart_reason", ["partner", "custom"]);
export const itemKind = pgEnum("item_kind", ["link", "photo", "note"]);
export const messageChannel = pgEnum("message_channel", ["push"]);
export const messageStatus = pgEnum("message_status", ["captured", "pending", "sent", "failed", "skipped"]);

export const families = pgTable("families", {
  id: uuid("id").defaultRandom().primaryKey(),
  familyId: uuid("family_id").notNull().generatedAlwaysAs(sql`id`),
  name: text("name").notNull(),
  createdBy: uuid("created_by"),
  defaultLanguage: language("default_language").default("en").notNull(),
}, (table) => [
  foreignKey({
    name: "families_created_by_fk",
    columns: [table.id, table.createdBy],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export function familyId() {
  return uuid("family_id").notNull().references((): AnyPgColumn => families.id, {onDelete: "cascade"});
}

export function instant(name: string) {
  return timestamp(name, {withTimezone: true});
}

export const households = pgTable("households", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  name: text("name").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
]);

export const people = pgTable("people", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  displayName: text("display_name").notNull(),
  language: language("language").default("en").notNull(),
  helperId: uuid("helper_id"),
  householdId: uuid("household_id"),
  role: personRole("role").default("member").notNull(),
  coOrganizerGrantedAt: instant("co_organizer_granted_at"),
  needsNewKey: boolean("needs_new_key").default(false).notNull(),
  noClothes: boolean("no_clothes").default(false).notNull(),
  removedAt: instant("removed_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  foreignKey({
    name: "people_helper_fk",
    columns: [table.familyId, table.helperId],
    foreignColumns: [table.familyId, table.id],
  }),
  foreignKey({
    name: "people_household_fk",
    columns: [table.familyId, table.householdId],
    foreignColumns: [households.familyId, households.id],
  }),
]);

export const exchanges = pgTable("exchanges", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  name: text("name").notNull(),
  giftDay: date("gift_day"),
  place: text("place"),
  budgetAmount: numeric("budget_amount", {precision: 10, scale: 2}),
  listDeadline: date("list_deadline"),
  drawDay: date("draw_day"),
  status: exchangeStatus("status").default("setup").notNull(),
  rules: jsonb("rules").$type<Record<string, unknown>>().default({}).notNull(),
  seal: text("seal"),
  drawVersion: integer("draw_version").default(0).notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
]);

export const participants = pgTable("participants", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  personId: uuid("person_id").notNull(),
  status: participantStatus("status").default("in").notNull(),
  joinedAt: instant("joined_at"),
  seenVersion: integer("seen_version"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId, table.personId]}),
  foreignKey({
    name: "participants_exchange_fk",
    columns: [table.familyId, table.exchangeId],
    foreignColumns: [exchanges.familyId, exchanges.id],
  }),
  foreignKey({
    name: "participants_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const keepApart = pgTable("keep_apart", {
  familyId: familyId(),
  exchangeId: uuid("exchange_id").notNull(),
  personA: uuid("person_a").notNull(),
  personB: uuid("person_b").notNull(),
  reason: keepApartReason("reason").notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.exchangeId, table.personA, table.personB]}),
  check("keep_apart_ordered_pair", sql`${table.personA} < ${table.personB}`),
  foreignKey({
    name: "keep_apart_person_a_fk",
    columns: [table.familyId, table.exchangeId, table.personA],
    foreignColumns: [participants.familyId, participants.exchangeId, participants.personId],
  }),
  foreignKey({
    name: "keep_apart_person_b_fk",
    columns: [table.familyId, table.exchangeId, table.personB],
    foreignColumns: [participants.familyId, participants.exchangeId, participants.personId],
  }),
]);

export const items = pgTable("items", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  ownerId: uuid("owner_id").notNull(),
  kind: itemKind("kind").notNull(),
  title: text("title").notNull(),
  note: text("note"),
  url: text("url"),
  imageKey: text("image_key"),
  price: numeric("price", {precision: 10, scale: 2}),
  store: text("store"),
  starred: boolean("starred").default(false).notNull(),
  position: integer("position").default(0).notNull(),
  preview: jsonb("preview").$type<Record<string, unknown>>(),
  createdAt: instant("created_at").defaultNow().notNull(),
  updatedAt: instant("updated_at").defaultNow().notNull(),
  archivedAt: instant("archived_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  index("items_owner_position_idx").on(table.familyId, table.ownerId, table.position),
  foreignKey({
    name: "items_owner_fk",
    columns: [table.familyId, table.ownerId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const sizes = pgTable("sizes", {
  familyId: familyId(),
  personId: uuid("person_id").notNull(),
  kind: text("kind").notNull(),
  value: text("value").notNull(),
  updatedAt: instant("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.personId, table.kind]}),
  foreignKey({
    name: "sizes_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const aboutMe = pgTable("about_me", {
  familyId: familyId(),
  personId: uuid("person_id").notNull(),
  likes: text("likes"),
  dislikes: text("dislikes"),
  allergies: text("allergies"),
  colors: text("colors"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.personId]}),
  foreignKey({
    name: "about_me_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const claims = pgTable("claims", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  itemId: uuid("item_id").notNull(),
  exchangeId: uuid("exchange_id"),
  claimerId: uuid("claimer_id").notNull(),
  boughtAt: instant("bought_at"),
  wrappedAt: instant("wrapped_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  uniqueIndex("claims_one_per_item").on(table.familyId, table.itemId),
  index("claims_claimer_idx").on(table.familyId, table.claimerId),
  foreignKey({
    name: "claims_item_fk",
    columns: [table.familyId, table.itemId],
    foreignColumns: [items.familyId, items.id],
  }),
  foreignKey({
    name: "claims_claimer_fk",
    columns: [table.familyId, table.claimerId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "claims_exchange_fk",
    columns: [table.familyId, table.exchangeId],
    foreignColumns: [exchanges.familyId, exchanges.id],
  }),
]);

export const outbox = pgTable("outbox", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  personId: uuid("person_id").notNull(),
  channel: messageChannel("channel").notNull(),
  template: text("template").notNull(),
  language: language("language").notNull(),
  status: messageStatus("status").notNull(),
  requesterName: text("requester_name"),
  dedupeKey: text("dedupe_key"),
  pushAttempts: integer("push_attempts").default(0).notNull(),
  createdAt: instant("created_at").defaultNow().notNull(),
  sentAt: instant("sent_at"),
  readAt: instant("read_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  uniqueIndex("outbox_dedupe_idx").on(table.familyId, table.personId, table.dedupeKey),
  index("outbox_person_created_idx").on(table.familyId, table.personId, table.createdAt),
  index("outbox_pending_idx").on(table.familyId, table.createdAt).where(sql`${table.status} = 'pending'`),
  check("outbox_requester_is_pin_reset", sql`${table.requesterName} is null or ${table.template} = 'pin-reset-request'`),
  foreignKey({
    name: "outbox_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const audit = pgTable("audit", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  target: text("target"),
  at: instant("at").defaultNow().notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  foreignKey({
    name: "audit_actor_fk",
    columns: [table.familyId, table.actorId],
    foreignColumns: [people.familyId, people.id],
  }),
]);
