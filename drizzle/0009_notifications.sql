ALTER TYPE "public"."message_status" ADD VALUE 'skipped';--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	CONSTRAINT "push_subscriptions_family_id_session_id_pk" PRIMARY KEY("family_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "requester_name" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "push_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_fk" FOREIGN KEY ("family_id","session_id") REFERENCES "public"."sessions"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_family_endpoint_idx" ON "push_subscriptions" USING btree ("family_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_person_idx" ON "push_subscriptions" USING btree ("family_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe_idx" ON "outbox" USING btree ("family_id","person_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_person_created_idx" ON "outbox" USING btree ("family_id","person_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("family_id","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_requester_is_pin_reset" CHECK ("outbox"."requester_name" is null or "outbox"."template" = 'pin-reset-request');