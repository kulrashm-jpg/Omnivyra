-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260422192026  Name: auth_user_has_password_fn
-- Idempotency: GUARDED (CREATE OR REPLACE FUNCTION; REVOKE/GRANT are idempotent).

CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (SELECT encrypted_password IS NOT NULL AND encrypted_password <> ''
     FROM auth.users
     WHERE id = p_user_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.auth_user_has_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role;
