DO $$
DECLARE
  table_name text;
  family_scope constant text := 'family_id = nullif(current_setting(''app.family_id'', true), '''')::uuid';
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sessions', 'pin_credentials', 'personal_keys', 'auth_limits',
    'pin_reset_requests', 'passkeys', 'auth_events', 'session_disputes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY family_scope ON public.%I USING (%s) WITH CHECK (%s)',
      table_name, family_scope, family_scope
    );
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  public.sessions, public.pin_credentials, public.personal_keys,
  public.pin_reset_requests, public.passkeys
TO fge_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_limits TO fge_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.auth_events, public.session_disputes TO fge_app;
