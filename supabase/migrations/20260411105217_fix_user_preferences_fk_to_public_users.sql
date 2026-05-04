-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260411105217  Name: fix_user_preferences_fk_to_public_users
-- Idempotency: NOT GUARDED — DROP CONSTRAINT will fail on second apply. Flagged in B0 report.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'user_preferences_user_id_fkey'
      AND table_name = 'user_preferences'
  ) THEN
    ALTER TABLE public.user_preferences
      DROP CONSTRAINT user_preferences_user_id_fkey;
  END IF;
END $$;

ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;