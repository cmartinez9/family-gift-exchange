ALTER TABLE public.list_nudges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.list_nudges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_scope ON public.list_nudges
  USING (family_id = nullif(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = nullif(current_setting('app.family_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.list_nudges TO fge_app;
--> statement-breakpoint
GRANT fge_notify_scheduler TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA public TO fge_notify_scheduler;
--> statement-breakpoint
GRANT SELECT (family_id, kind) ON public.list_nudges TO fge_notify_scheduler;
--> statement-breakpoint
CREATE POLICY nudge_queue ON public.list_nudges
  FOR SELECT TO fge_notify_scheduler USING (kind = 'viewed');
--> statement-breakpoint
CREATE FUNCTION public.fge_nudge_work()
RETURNS TABLE (family_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT DISTINCT list_nudges.family_id
    FROM public.list_nudges
    WHERE nullif(current_setting('app.family_id', true), '') IS NULL
      AND list_nudges.kind = 'viewed'
  ORDER BY 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fge_nudge_work() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fge_nudge_work() TO fge_app;
--> statement-breakpoint
ALTER FUNCTION public.fge_nudge_work() OWNER TO fge_notify_scheduler;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM fge_notify_scheduler;
