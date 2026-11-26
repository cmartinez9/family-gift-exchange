CREATE TABLE "draw_openings" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"giver_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"viewer_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draw_openings_family_id_exchange_id_giver_id_version_session_id_pk" PRIMARY KEY("family_id","exchange_id","giver_id","version","session_id"),
	CONSTRAINT "draw_openings_positive_version" CHECK ("draw_openings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "draw_reports" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"giver_id" uuid NOT NULL,
	CONSTRAINT "draw_reports_family_id_exchange_id_giver_id_pk" PRIMARY KEY("family_id","exchange_id","giver_id")
);
--> statement-breakpoint
CREATE TABLE "draw_rule_snapshots" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"roster" jsonb NOT NULL,
	"keep_apart" jsonb NOT NULL,
	CONSTRAINT "draw_rule_snapshots_family_id_exchange_id_pk" PRIMARY KEY("family_id","exchange_id")
);
--> statement-breakpoint
CREATE TABLE "draw_practice_families" (
	"family_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"practice_family_id" uuid NOT NULL,
	"practice_organizer_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	CONSTRAINT "draw_practice_families_family_id_owner_id_pk" PRIMARY KEY("family_id","owner_id"),
	CONSTRAINT "draw_practice_families_practice_family_id_unique" UNIQUE("practice_family_id")
);
--> statement-breakpoint
ALTER TABLE "exchanges" ADD COLUMN "gift_time" time(0);--> statement-breakpoint
ALTER TABLE "draw_openings" ADD CONSTRAINT "draw_openings_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_openings" ADD CONSTRAINT "draw_openings_giver_fk" FOREIGN KEY ("family_id","exchange_id","giver_id") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_openings" ADD CONSTRAINT "draw_openings_viewer_fk" FOREIGN KEY ("family_id","viewer_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_reports" ADD CONSTRAINT "draw_reports_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_reports" ADD CONSTRAINT "draw_reports_giver_fk" FOREIGN KEY ("family_id","exchange_id","giver_id") REFERENCES "public"."participants"("family_id","exchange_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_rule_snapshots" ADD CONSTRAINT "draw_rule_snapshots_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_rule_snapshots" ADD CONSTRAINT "draw_rule_snapshots_exchange_fk" FOREIGN KEY ("family_id","exchange_id") REFERENCES "public"."exchanges"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_practice_families" ADD CONSTRAINT "draw_practice_families_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_practice_families" ADD CONSTRAINT "draw_practice_families_practice_family_id_families_id_fk" FOREIGN KEY ("practice_family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_practice_families" ADD CONSTRAINT "draw_practice_families_owner_fk" FOREIGN KEY ("family_id","owner_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_practice_families" ADD CONSTRAINT "draw_practice_families_organizer_fk" FOREIGN KEY ("practice_family_id","practice_organizer_id") REFERENCES "public"."people"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_practice_families" ADD CONSTRAINT "draw_practice_families_exchange_fk" FOREIGN KEY ("practice_family_id","exchange_id") REFERENCES "public"."exchanges"("family_id","id") ON DELETE no action ON UPDATE no action;