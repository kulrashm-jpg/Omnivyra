-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260411105217  Name: fix_user_preferences_fk_to_public_users
-- Idempotency: NOT GUARDED — DROP CONSTRAINT will fail on second apply. Flagged in B0 report.

ALTER TABLE public.user_preferences
  DROP CONSTRAINT user_preferences_user_id_fkey,
  ADD CONSTRAINT user_preferences_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
