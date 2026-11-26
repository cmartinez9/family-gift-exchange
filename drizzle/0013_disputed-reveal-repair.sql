ALTER TABLE "exchanges" ADD COLUMN "disputed_reveal_repaired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draw_openings" ADD COLUMN "invalidated_at" timestamp with time zone;
--> statement-breakpoint
GRANT UPDATE (invalidated_at) ON public.draw_openings TO fge_draw;
--> statement-breakpoint
GRANT SELECT (family_id, id, device_kind) ON public.sessions TO fge_draw;
--> statement-breakpoint
GRANT SELECT (family_id, person_id, disputed_session_id, at) ON public.session_disputes TO fge_draw;
