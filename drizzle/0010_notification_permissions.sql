ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_scope ON public.push_subscriptions
  USING (family_id = nullif(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = nullif(current_setting('app.family_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO fge_app;
--> statement-breakpoint
GRANT UPDATE (status, sent_at, read_at, push_attempts) ON public.outbox TO fge_app;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fge_notify_scheduler') THEN
    CREATE ROLE fge_notify_scheduler NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT fge_notify_scheduler TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA public TO fge_notify_scheduler;
--> statement-breakpoint
GRANT SELECT (family_id, status, list_deadline, gift_day) ON public.exchanges TO fge_notify_scheduler;
--> statement-breakpoint
GRANT SELECT (family_id, channel, status) ON public.outbox TO fge_notify_scheduler;
--> statement-breakpoint
CREATE POLICY notification_calendar ON public.exchanges
  FOR SELECT TO fge_notify_scheduler USING (true);
--> statement-breakpoint
CREATE POLICY notification_queue ON public.outbox
  FOR SELECT TO fge_notify_scheduler USING (channel = 'push' AND status = 'pending');
--> statement-breakpoint
CREATE FUNCTION public.fge_notification_work(reminder_day date, include_push boolean)
RETURNS TABLE (family_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT exchanges.family_id
    FROM public.exchanges
    WHERE nullif(current_setting('app.family_id', true), '') IS NULL
      AND exchanges.status <> 'closed'
      AND (exchanges.list_deadline = reminder_day OR exchanges.gift_day = reminder_day)
  UNION
  SELECT outbox.family_id
    FROM public.outbox
    WHERE nullif(current_setting('app.family_id', true), '') IS NULL
      AND include_push AND outbox.channel = 'push' AND outbox.status = 'pending'
  ORDER BY 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fge_notification_work(date, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fge_notification_work(date, boolean) TO fge_app;
--> statement-breakpoint
ALTER FUNCTION public.fge_notification_work(date, boolean) OWNER TO fge_notify_scheduler;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM fge_notify_scheduler;
