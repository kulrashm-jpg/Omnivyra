-- ────────────────────────────────────────────────────────────────────────────
-- 00000000000001_enable_required_extensions.sql
--
-- Phase E preamble: enable every extension that any canonical migration uses.
-- Lex-sorts second (after 00000000000000_baseline_schema.sql) so extensions are
-- ready before any later migration references them.
--
-- Required by:
--   pgcrypto             — gen_random_uuid()         (used by ~40 CREATE TABLE statements)
--   uuid-ossp            — uuid_generate_v4()        (legacy fallback for some tables)
--   pg_cron              — domain_reminders cron     (20260501115028)
--   pg_net               — outbound HTTP from cron   (20260501115028)
--   vector               — pgvector embeddings       (20260504010002 fix migration)
--   supabase_vault       — secret storage for cron   (20260501115028)
--
-- All idempotent (CREATE EXTENSION IF NOT EXISTS).
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
