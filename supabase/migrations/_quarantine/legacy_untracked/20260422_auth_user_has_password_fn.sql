-- Expose a narrow read-only view of auth.users.encrypted_password presence.
--
-- Needed by /api/auth/sync-supabase-user so it can set public.users.has_password
-- on initial row creation. Without this we'd have to expose the whole auth
-- schema or mirror password state from the client (untrustworthy).
--
-- SECURITY DEFINER runs with the function owner's privileges (postgres), which
-- can read auth.users. The function only ever returns a boolean — never the
-- hash itself — and callers must supply the uuid, so it can't enumerate.

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
