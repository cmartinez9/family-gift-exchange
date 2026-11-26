ALTER TABLE "session_disputes" ADD COLUMN "affected_session_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
--> statement-breakpoint
GRANT SELECT (affected_session_ids) ON public.session_disputes TO fge_draw;
--> statement-breakpoint
GRANT SELECT (person_id) ON public.sessions TO fge_draw;
