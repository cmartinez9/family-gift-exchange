\set ON_ERROR_STOP on

BEGIN;

SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fge_runtime') AS create_runtime \gset
\if :create_runtime
-- Neon requires the initial password, so bind it over TLS instead of putting it in query text.
DO $$
BEGIN
  IF current_setting('log_statement') <> 'none'
    OR current_setting('log_min_duration_statement') <> '-1'
    OR current_setting('log_min_duration_sample') <> '-1'
    OR current_setting('log_transaction_sample_rate')::double precision > 0
    OR current_setting('pg_stat_statements.track', true) = 'all'
    OR current_setting('pgaudit.log', true) <> 'none' THEN
    RAISE EXCEPTION 'Provision fge_runtime with statement and audit logging disabled';
  END IF;
END $$;
SET LOCAL log_parameter_max_length_on_error = 0;
\getenv runtime_password FGE_RUNTIME_PASSWORD
\if :{?runtime_password}
SELECT set_config('app.provision_runtime_password', $1, true) IS NOT NULL AS password_loaded
\bind :runtime_password
\gset
\unset runtime_password
\endif

DO $$
DECLARE
  runtime_password text := current_setting('app.provision_runtime_password', true);
BEGIN
  IF coalesce(length(runtime_password), 0) < 32 THEN
    RAISE EXCEPTION 'Set FGE_RUNTIME_PASSWORD to a strong generated password of at least 32 characters';
  END IF;

  BEGIN
    EXECUTE format('CREATE ROLE fge_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      runtime_password);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Could not create fge_runtime (SQLSTATE %)', SQLSTATE;
  END;
  PERFORM set_config('app.provision_runtime_password', '', true);
END $$;
\endif

-- On PostgreSQL 16 and later, role creation alone does not let the owner SET ROLE.
GRANT fge_app TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
GRANT fge_app TO fge_runtime WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = 'fge_runtime'
      AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT FROM pg_auth_members
    WHERE member = 'fge_runtime'::regrole
      AND (roleid <> 'fge_app'::regrole OR admin_option OR inherit_option OR NOT set_option)
  ) OR EXISTS (
    SELECT FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass AND refobjid = 'fge_runtime'::regrole AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION 'fge_runtime has unexpected attributes, memberships, or ownership';
  END IF;
END $$;

COMMIT;
