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
