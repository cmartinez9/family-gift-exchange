import {boolean, foreignKey, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid} from "drizzle-orm/pg-core";
import {familyId, instant, people} from "../db/schema";

export const sessions = pgTable("sessions", {
  familyId: familyId(),
  id: uuid("id").notNull(),
  personId: uuid("person_id").notNull(),
  actingAs: uuid("acting_as").notNull(),
  deviceHash: text("device_hash").notNull(),
  deviceKind: text("device_kind").notNull(),
  passkeyId: text("passkey_id"),
  tokenHash: text("token_hash").notNull(),
  createdAt: instant("created_at").defaultNow().notNull(),
  expiresAt: instant("expires_at").notNull(),
  revokedAt: instant("revoked_at"),
  trusted: boolean("trusted").default(true).notNull(),
  hadOrganizerAccess: boolean("had_organizer_access").default(false).notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  index("sessions_person_idx").on(table.familyId, table.personId),
  foreignKey({
    name: "sessions_passkey_fk",
    columns: [table.familyId, table.passkeyId],
    foreignColumns: [passkeys.familyId, passkeys.id],
  }),
  foreignKey({
    name: "sessions_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "sessions_acting_as_fk",
    columns: [table.familyId, table.actingAs],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const pinCredentials = pgTable("pin_credentials", {
  familyId: familyId(),
  personId: uuid("person_id").notNull(),
  pinHash: text("pin_hash"),
  changedAt: instant("changed_at").defaultNow().notNull(),
  joinedAt: instant("joined_at").defaultNow().notNull(),
  failedInWindow: integer("failed_in_window").default(0).notNull(),
  failedToday: integer("failed_today").default(0).notNull(),
  windowStartedAt: instant("window_started_at"),
  lockedUntil: instant("locked_until"),
  newDevicesLocked: boolean("new_devices_locked").default(false).notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.personId]}),
  foreignKey({
    name: "pin_credentials_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const personalKeys = pgTable("personal_keys", {
  familyId: familyId(),
  id: uuid("id").notNull(),
  personId: uuid("person_id").notNull(),
  issuedBy: uuid("issued_by").notNull(),
  issuedBySessionId: uuid("issued_by_session_id"),
  tokenHash: text("token_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  kind: text("kind", {enum: ["share", "qr", "print", "reset"]}).notNull(),
  createdAt: instant("created_at").defaultNow().notNull(),
  expiresAt: instant("expires_at").notNull(),
  usedAt: instant("used_at"),
  usedSessionId: uuid("used_session_id"),
  revokedAt: instant("revoked_at"),
  sentAt: instant("sent_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  uniqueIndex("personal_keys_token_idx").on(table.familyId, table.tokenHash),
  uniqueIndex("personal_keys_code_idx").on(table.familyId, table.codeHash),
  index("personal_keys_person_idx").on(table.familyId, table.personId),
  foreignKey({
    name: "personal_keys_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "personal_keys_issuer_fk",
    columns: [table.familyId, table.issuedBy],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "personal_keys_session_fk",
    columns: [table.familyId, table.usedSessionId],
    foreignColumns: [sessions.familyId, sessions.id],
  }),
  foreignKey({
    name: "personal_keys_issuing_session_fk",
    columns: [table.familyId, table.issuedBySessionId],
    foreignColumns: [sessions.familyId, sessions.id],
  }),
]);

export const authLimits = pgTable("auth_limits", {
  familyId: familyId(),
  bucket: text("bucket").notNull(),
  windowStartedAt: instant("window_started_at").notNull(),
  count: integer("count").notNull(),
}, (table) => [primaryKey({columns: [table.familyId, table.bucket]})]);

export const pinResetRequests = pgTable("pin_reset_requests", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  personId: uuid("person_id").notNull(),
  deviceKind: text("device_kind").notNull(),
  requestedAt: instant("requested_at").defaultNow().notNull(),
  answeredAt: instant("answered_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  index("pin_reset_requests_person_idx").on(table.familyId, table.personId),
  foreignKey({
    name: "pin_reset_requests_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const passkeys = pgTable("passkeys", {
  familyId: familyId(),
  id: text("id").notNull(),
  personId: uuid("person_id").notNull(),
  deviceHash: text("device_hash").notNull(),
  publicKey: text("public_key").notNull(),
  enrolledAt: instant("enrolled_at").defaultNow().notNull(),
  counter: text("counter").notNull(),
  revokedAt: instant("revoked_at"),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  foreignKey({
    name: "passkeys_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
]);

export const authEvents = pgTable("auth_events", {
  familyId: familyId(),
  id: uuid("id").defaultRandom().notNull(),
  personId: uuid("person_id").notNull(),
  kind: text("kind", {enum: [
    "keyPrepared", "keySent", "keyUsed", "keyDisputed", "familyLockdown", "newDevice", "pinLocked", "newDevicesLocked",
    "resetPrepared", "resetPreparedWithoutRequest", "resetSent", "resetUsed",
  ]}).notNull(),
  deviceKind: text("device_kind"),
  sessionId: uuid("session_id"),
  keyId: uuid("key_id"),
  at: instant("at").defaultNow().notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.id]}),
  index("auth_events_person_idx").on(table.familyId, table.personId, table.at),
  foreignKey({
    name: "auth_events_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "auth_events_session_fk",
    columns: [table.familyId, table.sessionId],
    foreignColumns: [sessions.familyId, sessions.id],
  }),
  foreignKey({
    name: "auth_events_key_fk",
    columns: [table.familyId, table.keyId],
    foreignColumns: [personalKeys.familyId, personalKeys.id],
  }),
]);

export const sessionDisputes = pgTable("session_disputes", {
  familyId: familyId(),
  eventId: uuid("event_id").notNull(),
  personId: uuid("person_id").notNull(),
  disputedSessionId: uuid("disputed_session_id"),
  reportedBySessionId: uuid("reported_by_session_id").notNull(),
  at: instant("at").defaultNow().notNull(),
}, (table) => [
  primaryKey({columns: [table.familyId, table.eventId]}),
  foreignKey({
    name: "session_disputes_event_fk",
    columns: [table.familyId, table.eventId],
    foreignColumns: [authEvents.familyId, authEvents.id],
  }),
  foreignKey({
    name: "session_disputes_person_fk",
    columns: [table.familyId, table.personId],
    foreignColumns: [people.familyId, people.id],
  }),
  foreignKey({
    name: "session_disputes_target_fk",
    columns: [table.familyId, table.disputedSessionId],
    foreignColumns: [sessions.familyId, sessions.id],
  }),
  foreignKey({
    name: "session_disputes_reporter_fk",
    columns: [table.familyId, table.reportedBySessionId],
    foreignColumns: [sessions.familyId, sessions.id],
  }),
]);
