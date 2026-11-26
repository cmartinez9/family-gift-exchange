CREATE TYPE "public"."exchange_status" AS ENUM('setup', 'open', 'drawn', 'locked', 'closed');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('link', 'photo', 'note');--> statement-breakpoint
CREATE TYPE "public"."keep_apart_reason" AS ENUM('partner', 'custom');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'es');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('push');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('captured', 'pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('organizer', 'co_organizer', 'member');--> statement-breakpoint
CREATE TABLE "about_me" (
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"likes" text,
	"dislikes" text,
	"allergies" text,
	"colors" text,
	CONSTRAINT "about_me_family_id_person_id_pk" PRIMARY KEY("family_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"claimer_id" uuid NOT NULL,
	"bought_at" timestamp with time zone,
	"wrapped_at" timestamp with time zone,
	CONSTRAINT "claims_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"gift_day" date,
	"place" text,
	"budget_amount" numeric(10, 2),
	"list_deadline" date,
	"draw_day" date,
	"status" "exchange_status" DEFAULT 'setup' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seal" text,
	"draw_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exchanges_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid GENERATED ALWAYS AS (id) STORED NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"default_language" "language" DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "households_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "item_kind" NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"url" text,
	"image_key" text,
	"price" numeric(10, 2),
	"store" text,
	"starred" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"preview" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "items_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "keep_apart" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"person_a" uuid NOT NULL,
	"person_b" uuid NOT NULL,
	"reason" "keep_apart_reason" NOT NULL,
	CONSTRAINT "keep_apart_family_id_exchange_id_person_a_person_b_pk" PRIMARY KEY("family_id","exchange_id","person_a","person_b"),
	CONSTRAINT "keep_apart_ordered_pair" CHECK ("keep_apart"."person_a" < "keep_apart"."person_b")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"template" text NOT NULL,
	"language" "language" NOT NULL,
	"status" "message_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbox_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "participant_status" DEFAULT 'in' NOT NULL,
	"joined_at" timestamp with time zone,
	"seen_version" integer,
	CONSTRAINT "participants_family_id_exchange_id_person_id_pk" PRIMARY KEY("family_id","exchange_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"language" "language" DEFAULT 'en' NOT NULL,
	"helper_id" uuid,
	"household_id" uuid,
	"role" "person_role" DEFAULT 'member' NOT NULL,
	"no_clothes" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "people_family_id_id_pk" PRIMARY KEY("family_id","id")
);
--> statement-breakpoint
CREATE TABLE "sizes" (
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sizes_family_id_person_id_kind_pk" PRIMARY KEY("family_id","person_id","kind")
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"giver_id" uuid NOT NULL,
	"recipient_sealed" "bytea" NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "assignments_family_id_exchange_id_giver_id_pk" PRIMARY KEY("family_id","exchange_id","giver_id"),
	CONSTRAINT "assignments_positive_version" CHECK ("assignments"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"family_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"exchange_id" uuid NOT NULL,
	"asker_id" uuid NOT NULL,
	"recipient_sealed" "bytea" NOT NULL,
	"draw_version" integer NOT NULL,
	"text" text NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "questions_family_id_id_pk" PRIMARY KEY("family_id","id"),
	CONSTRAINT "questions_positive_draw_version" CHECK ("questions"."draw_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "about_me" ADD CONSTRAINT "about_me_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "about_me" ADD CONSTRAINT "about_me_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_actor_fk" FOREIGN KEY ("family_id","actor_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_item_fk" FOREIGN KEY ("family_id","item_id") REFERENCES "public"."items"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimer_fk" FOREIGN KEY ("family_id","exchange_id","claimer_id") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "families" ADD CONSTRAINT "families_created_by_fk" FOREIGN KEY ("id","created_by") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_fk" FOREIGN KEY ("family_id","owner_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_apart" ADD CONSTRAINT "keep_apart_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_apart" ADD CONSTRAINT "keep_apart_person_a_fk" FOREIGN KEY ("family_id","exchange_id","person_a") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keep_apart" ADD CONSTRAINT "keep_apart_person_b_fk" FOREIGN KEY ("family_id","exchange_id","person_b") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_exchange_fk" FOREIGN KEY ("family_id","exchange_id") REFERENCES "public"."exchanges"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_helper_fk" FOREIGN KEY ("family_id","helper_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_household_fk" FOREIGN KEY ("family_id","household_id") REFERENCES "public"."households"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sizes" ADD CONSTRAINT "sizes_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sizes" ADD CONSTRAINT "sizes_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_giver_fk" FOREIGN KEY ("family_id","exchange_id","giver_id") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_asker_fk" FOREIGN KEY ("family_id","exchange_id","asker_id") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_per_item_per_exchange" ON "claims" USING btree ("family_id","exchange_id","item_id");--> statement-breakpoint
CREATE INDEX "items_owner_position_idx" ON "items" USING btree ("family_id","owner_id","position");