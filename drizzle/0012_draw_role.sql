DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fge_draw') THEN
    CREATE ROLE fge_draw NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
  family_scope constant text := 'family_id = nullif(current_setting(''app.family_id'', true), '''')::uuid';
BEGIN
  FOREACH table_name IN ARRAY ARRAY['draw_openings', 'draw_reports', 'draw_practice_families', 'draw_rule_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY family_scope ON public.%I TO fge_draw USING (%s) WITH CHECK (%s)',
      table_name, family_scope, family_scope
    );
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON public.draw_openings, public.draw_reports, public.draw_practice_families, public.draw_rule_snapshots FROM PUBLIC, fge_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fge_draw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.assignments, public.questions, public.exchanges, public.participants, public.keep_apart, public.draw_rule_snapshots
TO fge_draw;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.draw_openings, public.draw_reports, public.draw_practice_families TO fge_draw;
--> statement-breakpoint
GRANT UPDATE (exchange_id) ON public.draw_practice_families TO fge_draw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.families TO fge_draw;
--> statement-breakpoint
GRANT SELECT (family_id, id, display_name, helper_id, household_id, role, removed_at, language),
      INSERT (family_id, id, display_name, role, language),
      UPDATE (helper_id)
ON public.people TO fge_draw;
--> statement-breakpoint
GRANT INSERT ON public.audit, public.outbox TO fge_draw;
--> statement-breakpoint
CREATE FUNCTION public.fge_sealed_recipient(
  requested_exchange uuid, actor uuid, effective_giver uuid, requested_version integer
) RETURNS bytea
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pairing.recipient_sealed
  FROM public.assignments AS pairing
  JOIN public.people AS giver
    ON (giver.family_id, giver.id) = (pairing.family_id, pairing.giver_id)
  JOIN public.people AS viewer
    ON (viewer.family_id, viewer.id) = (giver.family_id, actor)
  JOIN public.participants AS participant
    ON (participant.family_id, participant.exchange_id, participant.person_id)
       = (pairing.family_id, pairing.exchange_id, pairing.giver_id)
  WHERE pairing.family_id = nullif(current_setting('app.family_id', true), '')::uuid
    AND pairing.exchange_id = requested_exchange
    AND pairing.giver_id = effective_giver
    AND pairing.version = requested_version
    AND coalesce(giver.helper_id, giver.id) = actor
    AND giver.removed_at IS NULL
    AND viewer.removed_at IS NULL
    AND viewer.helper_id IS NULL
    AND participant.status = 'in';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fge_sealed_recipient(uuid, uuid, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fge_sealed_recipient(uuid, uuid, uuid, integer) TO fge_draw;
