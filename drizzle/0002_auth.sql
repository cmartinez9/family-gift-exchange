CREATE TABLE "auth_events" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"device_kind" text,
	"session_id" uuid,
	"key_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_events_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "auth_limits" (
	"family_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "auth_limits_family_id_bucket_pk" PRIMARY KEY("family_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"family_id" uuid NOT NULL,
	"id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "passkeys_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "personal_keys" (
	"family_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_session_id" uuid,
	"revoked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "personal_keys_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "pin_credentials" (
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_in_window" integer DEFAULT 0 NOT NULL,
	"failed_today" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"new_devices_locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pin_credentials_family_id_person_id_pk" PRIMARY KEY("family_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "pin_reset_requests" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"device_kind" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "pin_reset_requests_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "session_disputes" (
	"family_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"disputed_session_id" uuid,
	"reported_by_session_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_disputes_family_id_event_id_pk" PRIMARY KEY("family_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"family_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"acting_as" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"device_kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"trusted" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sessions_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_session_fk" FOREIGN KEY ("family_id","session_id") REFERENCES "public"."sessions"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_key_fk" FOREIGN KEY ("family_id","key_id") REFERENCES "public"."personal_keys"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_limits" ADD CONSTRAINT "auth_limits_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_keys" ADD CONSTRAINT "personal_keys_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_keys" ADD CONSTRAINT "personal_keys_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_keys" ADD CONSTRAINT "personal_keys_issuer_fk" FOREIGN KEY ("family_id","issued_by") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_keys" ADD CONSTRAINT "personal_keys_session_fk" FOREIGN KEY ("family_id","used_session_id") REFERENCES "public"."sessions"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_credentials" ADD CONSTRAINT "pin_credentials_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_credentials" ADD CONSTRAINT "pin_credentials_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_reset_requests" ADD CONSTRAINT "pin_reset_requests_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_reset_requests" ADD CONSTRAINT "pin_reset_requests_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_disputes" ADD CONSTRAINT "session_disputes_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_disputes" ADD CONSTRAINT "session_disputes_event_fk" FOREIGN KEY ("family_id","event_id") REFERENCES "public"."auth_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_disputes" ADD CONSTRAINT "session_disputes_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_disputes" ADD CONSTRAINT "session_disputes_target_fk" FOREIGN KEY ("family_id","disputed_session_id") REFERENCES "public"."sessions"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_disputes" ADD CONSTRAINT "session_disputes_reporter_fk" FOREIGN KEY ("family_id","reported_by_session_id") REFERENCES "public"."sessions"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_as_fk" FOREIGN KEY ("family_id","acting_as") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_person_idx" ON "auth_events" USING btree ("family_id","person_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_keys_token_idx" ON "personal_keys" USING btree ("family_id","token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "personal_keys_code_idx" ON "personal_keys" USING btree ("family_id","code_hash");--> statement-breakpoint
CREATE INDEX "personal_keys_person_idx" ON "personal_keys" USING btree ("family_id","person_id");--> statement-breakpoint
CREATE INDEX "pin_reset_requests_person_idx" ON "pin_reset_requests" USING btree ("family_id","person_id");--> statement-breakpoint
CREATE INDEX "sessions_person_idx" ON "sessions" USING btree ("family_id","person_id");