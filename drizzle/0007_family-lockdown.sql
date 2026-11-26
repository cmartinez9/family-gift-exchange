ALTER TABLE "pin_credentials" ALTER COLUMN "pin_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "co_organizer_granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "needs_new_key" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passkeys" ADD COLUMN "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pin_credentials" ADD COLUMN "changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "had_organizer_access" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "people" SET "co_organizer_granted_at" = now() WHERE "role" = 'co_organizer';
--> statement-breakpoint
UPDATE "sessions" SET "had_organizer_access" = true FROM "people"
WHERE "sessions"."family_id" = "people"."family_id" AND "sessions"."person_id" = "people"."id"
AND "people"."role" IN ('organizer', 'co_organizer');
