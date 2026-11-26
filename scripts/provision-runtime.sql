\set ON_ERROR_STOP on

BEGIN;

SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fge_runtime') AS create_runtime,
       NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fge_draw_runtime') AS create_draw
\gset
SELECT :'create_runtime'::boolean OR :'create_draw'::boolean AS create_login \gset
\if :create_login
-- Neon requires the initial password, so bind it over TLS instead of putting it in query text.
DO $$
BEGIN
  IF current_setting('log_statement') <> 'none'
    OR current_setting('log_min_duration_statement') <> '-1'
    OR current_setting('log_min_duration_sample') <> '-1'
    OR current_setting('log_transaction_sample_rate')::double precision > 0
    OR current_setting('pg_stat_statements.track', true) = 'all'
    OR current_setting('pgaudit.log', true) <> 'none' THEN
    RAISE EXCEPTION 'Provision runtime logins with statement and audit logging disabled';
  END IF;
END $$;
SET LOCAL log_parameter_max_length_on_error = 0;
\endif

\if :create_runtime
\getenv runtime_password FGE_RUNTIME_PASSWORD
\if :{?runtime_password}
SELECT set_config('app.provision_runtime_password', $1, true) IS NOT NULL AS password_loaded
\bind :runtime_password
\gset
\unset runtime_password
\endif
\endif

\if :create_draw
\getenv draw_password FGE_DRAW_PASSWORD
\if :{?draw_password}
SELECT set_config('app.provision_draw_password', $1, true) IS NOT NULL AS password_loaded
\bind :draw_password
\gset
\unset draw_password
\endif
\endif

-- On PostgreSQL 16 and later, role creation alone does not let the owner SET ROLE.
GRANT fge_app TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;

DO $$
DECLARE
  role_pair record;
  login_password text;
BEGIN
  FOR role_pair IN SELECT * FROM (VALUES
    ('fge_runtime', 'fge_app', 'FGE_RUNTIME_PASSWORD', 'app.provision_runtime_password'),
    ('fge_draw_runtime', 'fge_draw', 'FGE_DRAW_PASSWORD', 'app.provision_draw_password')
  ) AS pairs(login_name, request_role, password_env, password_setting)
  LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_pair.login_name) THEN
      login_password := current_setting(role_pair.password_setting, true);
      IF coalesce(length(login_password), 0) < 32 THEN
        RAISE EXCEPTION 'Set % to a strong generated password of at least 32 characters', role_pair.password_env;
      END IF;

      BEGIN
        EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
          role_pair.login_name, login_password);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Could not create % (SQLSTATE %)', role_pair.login_name, SQLSTATE;
      END;
      PERFORM set_config(role_pair.password_setting, '', true);
    END IF;

    EXECUTE format('GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE', role_pair.request_role, role_pair.login_name);

    IF EXISTS (
      SELECT FROM pg_roles
      WHERE rolname = role_pair.login_name
        AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    ) OR EXISTS (
      SELECT FROM pg_auth_members
      WHERE member = role_pair.login_name::regrole
        AND (roleid <> role_pair.request_role::regrole OR admin_option OR inherit_option OR NOT set_option)
    ) OR EXISTS (
      SELECT FROM pg_shdepend
      WHERE refclassid = 'pg_authid'::regclass AND refobjid = role_pair.login_name::regrole AND deptype = 'o'
    ) THEN
      RAISE EXCEPTION '% has unexpected attributes, memberships, or ownership', role_pair.login_name;
    END IF;
  END LOOP;
END $$;

COMMIT;
