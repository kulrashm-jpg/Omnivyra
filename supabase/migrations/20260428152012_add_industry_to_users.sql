-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260428152012  Name: add_industry_to_users
-- Idempotency: GUARDED.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS industry text;
