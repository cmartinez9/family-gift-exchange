DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fge_app') THEN
    CREATE ROLE fge_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fge_app;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
  family_scope constant text := 'family_id = nullif(current_setting(''app.family_id'', true), '''')::uuid';
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'families', 'people', 'households', 'exchanges', 'participants', 'keep_apart',
    'assignments', 'items', 'sizes', 'about_me', 'claims', 'questions', 'outbox', 'audit'
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
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.families, public.people, public.households, public.exchanges, public.participants,
  public.keep_apart, public.items, public.sizes, public.about_me, public.claims
TO fge_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.outbox, public.audit TO fge_app;
--> statement-breakpoint
REVOKE ALL ON public.assignments, public.questions FROM PUBLIC, fge_app;
