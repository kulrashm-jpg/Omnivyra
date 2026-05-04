-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260421043806  Name: consolidate_meta_oauth_under_facebook
-- Idempotency: SAFE (DELETE is idempotent).

DELETE FROM platform_oauth_configs WHERE platform IN ('instagram', 'whatsapp', 'meta');
