ALTER TABLE "sessions" ADD COLUMN "lent_by_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "person_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_lender_fk" FOREIGN KEY ("family_id","lent_by_session_id") REFERENCES "public"."sessions"("family_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT (lent_by_session_id, person_hidden_at) ON public.sessions TO fge_draw;
