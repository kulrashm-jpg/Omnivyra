-- ============================================================================
-- Vault RPC wrappers (Wave 2B-B)
-- ============================================================================
-- Supabase JS does not surface non-public schemas through PostgREST cleanly,
-- so we expose three SECURITY DEFINER wrappers in `public` for the security
-- subsystem. They are the ONLY allowed entry points to vault.* from the
-- application layer.
--
-- All three are revocable from PUBLIC; only the service role retains EXECUTE.
-- The functions themselves run as the migration owner so they can read/write
-- vault tables.
--
-- WARNING: Do NOT extend these wrappers to take user-supplied schema names,
-- secret names without prefix sanitization, or arbitrary text without
-- audit. They are narrow-purpose helpers for the TOTP factor flow.
-- ============================================================================

-- 1. Create a vault secret with a stable name. Returns the new uuid.
CREATE OR REPLACE FUNCTION public.security_create_secret(
  p_secret      text,
  p_name        text,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF p_secret IS NULL OR length(p_secret) = 0 THEN
    RAISE EXCEPTION 'security_create_secret: empty secret';
  END IF;
  IF p_name IS NULL OR length(p_name) = 0 THEN
    RAISE EXCEPTION 'security_create_secret: empty name';
  END IF;
  -- Defensive prefix to keep the security subsystem from clobbering
  -- secrets owned by other features.
  IF p_name NOT LIKE 'security:%' THEN
    RAISE EXCEPTION 'security_create_secret: name must start with "security:"';
  END IF;

  SELECT vault.create_secret(p_secret, p_name, p_description) INTO new_id;
  RETURN new_id;
END;
$$;

-- 2. Read a secret by id. Returns NULL if absent.
CREATE OR REPLACE FUNCTION public.security_get_secret(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  result text;
BEGIN
  SELECT ds.decrypted_secret
    INTO result
    FROM vault.decrypted_secrets AS ds
   WHERE ds.id = p_id
   LIMIT 1;
  RETURN result;
END;
$$;

-- 3. Delete a secret by id. Idempotent.
CREATE OR REPLACE FUNCTION public.security_delete_secret(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_id;
END;
$$;

-- Lock down the wrappers: only the service role may call them.
REVOKE EXECUTE ON FUNCTION public.security_create_secret(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.security_get_secret(uuid)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.security_delete_secret(uuid)            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.security_create_secret(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_get_secret(uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.security_delete_secret(uuid)             TO service_role;

COMMENT ON FUNCTION public.security_create_secret(text, text, text) IS
  'Wave 2B-B vault wrapper. service_role only. Names must be prefixed "security:".';
COMMENT ON FUNCTION public.security_get_secret(uuid) IS
  'Wave 2B-B vault read wrapper. service_role only.';
COMMENT ON FUNCTION public.security_delete_secret(uuid) IS
  'Wave 2B-B vault delete wrapper. service_role only.';
