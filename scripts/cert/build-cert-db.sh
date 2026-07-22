#!/usr/bin/env bash
# WRITER-CERT-002 Phase 2/3 — Reproducible schema-complete certification DB.
#
# Builds an ISOLATED, production-faithful Postgres from a READ-ONLY prod schema
# dump (no data) + the Writer Wave migrations. Never writes to production; never
# runs the app against production. Reproducible from a clean machine (needs only
# Docker + the SUPABASE_POOLER_DB_URL for the one read-only dump).
#
# Why a dump and not `supabase db reset`: the migration history is NOT self-
# contained — ~147 of 351 migrations reference schema created out-of-band (pooler
# DDL / database/*.sql), and 315 use duplicate 8-digit date prefixes that collide
# on the Supabase CLI's version PK. So replay cannot reconstruct the full schema;
# a schema-only pg_dump is the only faithful, complete source.
#
# Usage:
#   CERT_ALLOW_PROD_SCHEMA_DUMP=1 bash scripts/cert/build-cert-db.sh        # dump fresh from prod (read-only)
#   bash scripts/cert/build-cert-db.sh --use-cached <schema.sql>            # load a previously-captured dump
set -euo pipefail

CONTAINER=writer-cert-pg
IMAGE=pgvector/pgvector:pg17
PORT=54322
DB=certfull
DUMP="${CERT_SCHEMA_DUMP:-/tmp/cert_prod_schema.sql}"
MIG_DIR="supabase/migrations"

echo "[cert-db] starting isolated $IMAGE on :$PORT ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p "$PORT:5432" "$IMAGE" >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
echo "[cert-db] postgres ready."

# ── 1. Read-only prod schema dump (or cached) ───────────────────────────────
if [ "${1:-}" = "--use-cached" ] && [ -n "${2:-}" ]; then
  cp "$2" "$DUMP"; echo "[cert-db] using cached dump $2"
else
  : "${CERT_ALLOW_PROD_SCHEMA_DUMP:?set CERT_ALLOW_PROD_SCHEMA_DUMP=1 to authorize the READ-ONLY prod schema dump}"
  URL=$(grep -E "^SUPABASE_POOLER_DB_URL=" .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"'')
  rest=${URL#postgres*://}; ui=${rest%@*}; hp=${rest##*@}
  PU=${ui%%:*}; PP=${ui#*:}; hostport=${hp%%/*}; PH=${hostport%%:*}; PO=${hostport##*:}
  PD=${hp#*/}; PD=${PD%%\?*}; [ -z "$PD" ] && PD=postgres
  echo "[cert-db] READ-ONLY schema dump from prod ($PH:$PO) ..."
  docker run --rm --dns 8.8.8.8 --dns 1.1.1.1 -e PGPASSWORD="$PP" -e PGSSLMODE=require \
    postgres:17 pg_dump -h "$PH" -p "$PO" -U "$PU" -d "$PD" \
    --schema-only --no-owner --no-privileges --no-comments -n public > "$DUMP"
  echo "[cert-db] dumped $(grep -cE '^CREATE TABLE' "$DUMP") tables."
fi

# ── 2. Supabase-faithful base bootstrap ─────────────────────────────────────
docker exec "$CONTAINER" psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
docker exec "$CONTAINER" psql -U postgres -d postgres -c "CREATE DATABASE $DB;" >/dev/null
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -q >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage; CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;
CREATE TABLE IF NOT EXISTS vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE ROLE authenticator; EXCEPTION WHEN duplicate_object THEN null; END $$;
SQL

# ── 3. Load prod schema, then apply Wave migrations on top ──────────────────
echo "[cert-db] loading prod schema ..."
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=0 -q < "$DUMP" >/tmp/cert_load.log 2>&1 || true
echo "[cert-db] loaded $(docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc "select count(*) from pg_tables where schemaname='public'") tables ($(grep -cE '^ERROR' /tmp/cert_load.log) edge errors)."
echo "[cert-db] applying Writer Wave migrations ..."
for m in 20260718000000_canonical_content_foundation 20260718000001_content_intelligence_originality 20260718000002_content_quality_collaboration 20260718000003_content_learning_performance; do
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q < "$MIG_DIR/$m.sql" && echo "  ✓ $m" || { echo "  ✗ $m FAILED"; exit 1; }
done
echo "[cert-db] DONE. Schema-complete cert DB '$DB' on localhost:$PORT (user postgres / pass postgres)."
