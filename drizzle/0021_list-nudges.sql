CREATE TYPE "public"."nudge_kind" AS ENUM('organizer', 'viewed');--> statement-breakpoint
CREATE TABLE "list_nudges" (
	"family_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "nudge_kind" NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "list_nudges_family_id_exchange_id_person_id_kind_day_pk" PRIMARY KEY("family_id","exchange_id","person_id","kind","day")
);
--> statement-breakpoint
ALTER TABLE "list_nudges" ADD CONSTRAINT "list_nudges_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_nudges" ADD CONSTRAINT "list_nudges_exchange_fk" FOREIGN KEY ("family_id","exchange_id") REFERENCES "public"."exchanges"("family_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_nudges" ADD CONSTRAINT "list_nudges_person_fk" FOREIGN KEY ("family_id","person_id") REFERENCES "public"."people"("family_id","id") ON DELETE cascade ON UPDATE no action;