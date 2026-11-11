-- W6 — Supabase-compatible bootstrap for a disposable CI PostgreSQL database.
--
-- A stock `postgres` image has none of the roles, schemas or helper functions
-- that Supabase provides and that this repository's migrations reference. This
-- file creates just enough of that surface for a governed migration replay to
-- be meaningful. It is NEVER applied to production — it exists only so a throw-
-- away container resembles the platform the migrations were written against.
--
-- Deliberately minimal: this is a test scaffold, not a Supabase reimplementation.

-- Roles referenced by GRANT statements and RLS policies across the migration set.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'w6';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

-- Supabase installs extensions into the `extensions` schema and the governed
-- schema references them fully qualified (extensions.uuid_generate_v4(),
-- extensions.vector). Installing them anywhere else makes ~100 objects fail to
-- restore, so the schema placement here is load-bearing, not cosmetic.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- gen_random_uuid() is called unqualified throughout; keep it resolvable
-- without forcing every session to carry a custom search_path.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Supabase's migration ledger, so a replay can record what it applied.
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);

-- auth.users is referenced by foreign keys in several migrations.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The RLS helper functions policies call. Under test they return NULL unless a
-- test explicitly sets the corresponding GUC, which keeps policies parseable
-- without pretending to reproduce GoTrue.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.email', true), '') $$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;

-- ─── HOSTED DEFAULT TABLE PRIVILEGES (PI-LDB 2F, requirement 11) ───────────
--
-- A stock postgres image has an EMPTY `pg_default_acl`. Supabase's hosted
-- database does not: every table `postgres` creates in `public` arrives with
-- ALL privileges (arwdDxtm) already granted to `service_role`, and nothing in
-- this repository revokes that default. Measured on cert, which is a restore
-- of a production pg_dump INCLUDING ACLs:
--   docs/security/CLOSURE_015Q_RBAC_EFFECTIVE_PRIVILEGES.md:42
--   docs/security/CLOSURE_015P_RELEASE_BOUNDARY_AND_CERT_RESULTS.md:333
--   docs/security/CLOSURE_015U_FINAL_OPERATOR_PACKET.md (P-4)
--
-- WHY THIS LINE HAS TO EXIST. Without it the surplus never arrives here, so
-- every assertion of the form
--
--     has_table_privilege('service_role', <table>, 'TRUNCATE') IS NOT FALSE
--
-- is VACUOUSLY satisfied: the privilege the migration exists to remove was
-- never present to remove. A privilege migration could ship with a
-- three-grantee REVOKE that leaves `service_role` holding DELETE and TRUNCATE
-- in production, and this harness would stay green. That is not a
-- hypothetical — it is what Prompt 2B found and corrected.
--
-- NOT the reason an earlier note gave. `has_table_privilege(<role>, ...)`
-- answers about the NAMED role, not about the asking session, and
-- `service_role` here is NOLOGIN NOINHERIT BYPASSRLS rather than a superuser.
-- The harness connecting as `postgres` is therefore not what made those
-- assertions vacuous; the empty default ACL was.
--
-- `FOR ROLE postgres` is the same owner the in-repo precedent targets
-- (20261026000000_close_anon_rls_exposure.sql:453-457), and `postgres` is the
-- role this harness creates every table as, so these defaults are the ones
-- that will apply.
--
-- SCOPE, deliberately minimum: `service_role` only. The client roles
-- (`anon`, `authenticated`) are left without default table privileges, because
-- several suites assert client-role emptiness across tables that the
-- enumerated hardening migrations may not all reach, and granting them here
-- would convert those into failures about the bootstrap rather than about the
-- schema. `service_role` is the exposure that matters: it is the application
-- role, and BYPASSRLS means RLS does not compensate for excess table
-- privileges.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

-- Supabase puts `extensions` on the database search_path, which is why
-- migrations can write `vector(1536)` unqualified. Without this a replay fails
-- with "type vector does not exist" even though the extension is installed.
-- Database-scoped, so it applies to every session opened afterwards.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO %s',
                 current_database(), '"$user", public, extensions');
END
$$;
