-- ════════════════════════════════════════════════════════════════════════════
-- PROPOSAL — Closure-015L. NOT A MIGRATION. Not executed.
--
-- The rbac_config table the application has used since 760a3d24 (2026-02-10)
-- has no DDL anywhere in the repository or the production-derived baseline.
-- This proposal is VARIANT A: the table does not exist. If an operator finds an
-- existing table, use VARIANT B (bottom) instead — never both.
--
-- Columns derived from the code (backend/services/rbacService.ts):
--   roles        — saved by saveRbacConfig, read by getRbacConfig
--   permissions  — idem
--   updated_by   — saveRbacConfig (input.updatedBy = users.id, a uuid)
--   updated_at   — ordering key of getRbacConfig (order by updated_at desc)
-- ONE added column, the concurrency token required by the approved stale-edit
-- decision:
--   version      — bigint identity, assigned under a transaction-scoped advisory
--                  lock so version order = commit order.
-- The CHECKs mirror validateRbacConfigInput's structural rules (non-empty roles
-- array; non-empty permissions object). Finer rules stay in the application.
--
-- Write path: ONLY public.save_rbac_config (below) — it serializes saves across
-- every application instance, rejects a stale expected_version, and stamps a
-- strictly increasing updated_at so the existing updated_at-ordered read stays
-- correct. Direct INSERT is revoked from service_role once the application
-- uses the RPC (step 3 — owner decision on timing).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.rbac_config (
  version     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  roles       jsonb       NOT NULL,
  permissions jsonb       NOT NULL,
  updated_by  uuid        NULL,                  -- owner decision: FK to users(id)? (not added: audit rows must survive user deletion)
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rbac_config_roles_shape       CHECK (jsonb_typeof(roles) = 'array' AND jsonb_array_length(roles) > 0),
  CONSTRAINT rbac_config_permissions_shape CHECK (jsonb_typeof(permissions) = 'object' AND permissions <> '{}'::jsonb)
);
CREATE INDEX rbac_config_updated_at_desc ON public.rbac_config (updated_at DESC, version DESC);

ALTER TABLE public.rbac_config ENABLE ROW LEVEL SECURITY;      -- no policies: service_role only (ownedDbTable)
REVOKE ALL ON public.rbac_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rbac_config TO service_role;    -- step 3 revokes INSERT
-- Initial state: NO row. An empty table means "never configured" → the built-in
-- PERMISSIONS defaults (current application behaviour); the first governed save
-- passes expected_version = NULL.

CREATE OR REPLACE FUNCTION public.save_rbac_config(
  p_roles            jsonb,
  p_permissions      jsonb,
  p_updated_by       uuid,
  p_expected_version bigint
)
RETURNS TABLE(version bigint, roles jsonb, permissions jsonb, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_head_version bigint;
  v_head_at      timestamptz;
  v_at           timestamptz;
BEGIN
  -- One writer at a time across all instances (released at commit / rollback).
  PERFORM pg_advisory_xact_lock(hashtext('public.rbac_config'));

  SELECT c.version, c.updated_at INTO v_head_version, v_head_at
    FROM rbac_config c ORDER BY c.version DESC LIMIT 1;

  -- Stale edit: the caller edited a version that is no longer the newest (NULL
  -- = "edited the built-in defaults", valid only while nothing is stored).
  IF p_expected_version IS DISTINCT FROM v_head_version THEN
    RAISE EXCEPTION 'RBAC_CONFIG_STALE'
      USING ERRCODE = 'P0001',
            DETAIL  = coalesce(v_head_version::text, 'none');
  END IF;

  -- Strictly increasing, so the updated_at-ordered read agrees with version order.
  v_at := greatest(clock_timestamp(), coalesce(v_head_at + interval '1 microsecond', '-infinity'::timestamptz));

  RETURN QUERY
    INSERT INTO rbac_config (roles, permissions, updated_by, updated_at)
    VALUES (p_roles, p_permissions, p_updated_by, v_at)
    RETURNING rbac_config.version, rbac_config.roles, rbac_config.permissions, rbac_config.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint) TO service_role;

COMMIT;

-- Step 3 (after the application calls save_rbac_config — owner decision):
--   REVOKE INSERT ON public.rbac_config FROM service_role;
-- Rollback (VARIANT A): DROP FUNCTION public.save_rbac_config(jsonb, jsonb, uuid, bigint);
--                       DROP TABLE public.rbac_config;   -- loses every saved configuration

-- ── VARIANT B — the table already exists (operator evidence required first) ──
--   Preconditions: columns/types match roles, permissions, updated_by, updated_at;
--   every row passes the two CHECKs (list and repair failures first).
--   ALTER TABLE public.rbac_config ADD COLUMN version bigint;
--   UPDATE public.rbac_config r SET version = s.n
--     FROM (SELECT ctid, row_number() OVER (ORDER BY updated_at, ctid) AS n FROM public.rbac_config) s
--    WHERE r.ctid = s.ctid;                                    -- explicit order, NOT physical order
--   ALTER TABLE public.rbac_config ALTER COLUMN version SET NOT NULL;
--   ALTER TABLE public.rbac_config ADD PRIMARY KEY (version);   -- only if no PK exists
--   SELECT setval(pg_get_serial_sequence(...)) — or ADD GENERATED BY DEFAULT AS IDENTITY (START WITH max+1)
--   ALTER TABLE … ADD CONSTRAINT rbac_config_roles_shape … NOT VALID; then VALIDATE CONSTRAINT …;
--   then create save_rbac_config exactly as above.
--   Rollback (B): drop the function; ALTER TABLE … DROP COLUMN version (history order then reverts to updated_at only).
