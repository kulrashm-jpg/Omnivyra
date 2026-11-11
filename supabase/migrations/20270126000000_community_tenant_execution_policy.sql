-- Prompt 3 / C3: tenant-scoped community execution policy, closed by default.
--
-- NOT applied anywhere. Production application is NOT authorized: it needs an
-- explicit owner decision after review. Written for, and tested only on, a
-- disposable test database.
--
-- community_ai_platform_policy had one implicit global row (no tenant column)
-- and OPEN defaults: no row meant "execution enabled". This migration:
--
-- 1. Adds organization_id / tenant_id (nullable uuid) with a CHECK that both
--    are NULL (the single PLATFORM row: the global kill switch) or both are set
--    and equal (a TENANT row). Partial unique indexes allow one platform row
--    and one row per organization. Refuses (raises) when more than one
--    platform row already exists: which one is authoritative is an owner
--    decision, never a guess. No row is inserted, updated or deleted.
-- 2. Closes the column defaults: execution_enabled and auto_rules_enabled
--    default false, require_human_approval defaults true. Existing rows keep
--    their values.
-- 3. community_execution_policy_decision(p_org, p_tenant) -> (allowed, code,
--    auto_rules_enabled, policy_version). Locks the rows it reads FOR SHARE,
--    so a concurrent policy UPDATE either commits before the decision (and is
--    seen) or waits until the caller's transaction ends. Codes, first match:
--      POLICY_SCOPE_INVALID       p_org or p_tenant is NULL
--      PLATFORM_KILL_SWITCH       a platform row has execution_enabled = false
--      POLICY_MISSING             no platform row, or no row for this tenant
--      POLICY_AMBIGUOUS           more than one platform row or tenant row
--      POLICY_TENANT_MISMATCH     the organization's row belongs to another tenant
--      POLICY_MALFORMED           an execution_enabled / auto_rules_enabled flag is NULL
--      POLICY_EXECUTION_DISABLED  the tenant row has execution_enabled = false
--    allowed = true with code NULL otherwise. auto_rules_enabled is true only
--    when both rows enable auto rules. policy_version is the latest updated_at
--    of the rows read (NULL when none was found).
-- 4. Trigger community_ai_platform_policy_touch: every UPDATE stamps
--    updated_at with the server clock, so policy_version moves on each change,
--    and refuses changing organization_id / tenant_id: a row is never
--    re-pointed to another tenant (or between platform and tenant scope).
--
-- Grants: the decision function is service_role only (REVOKE from PUBLIC,
-- anon, authenticated). Table grants are not changed.
-- ROLLBACK: supabase/migrations/rollbacks/community_tenant_execution_policy_rollback.sql

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF to_regclass('public.community_ai_platform_policy') IS NULL THEN
    RAISE EXCEPTION 'community tenant execution policy: public.community_ai_platform_policy is absent';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy'
         AND column_name IN ('execution_enabled', 'auto_rules_enabled', 'require_human_approval', 'updated_at')) <> 4 THEN
    RAISE EXCEPTION 'community tenant execution policy: community_ai_platform_policy lacks a required column';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy'
                AND column_name = 'organization_id') THEN
    SELECT count(*) INTO v_n FROM public.community_ai_platform_policy WHERE organization_id IS NULL;
  ELSE
    SELECT count(*) INTO v_n FROM public.community_ai_platform_policy;
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'community tenant execution policy: % platform policy rows exist; exactly one may be authoritative (owner decision, not a migration guess)', v_n;
  END IF;
END
$$;

ALTER TABLE public.community_ai_platform_policy
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_ai_platform_policy'::regclass
                    AND conname = 'community_ai_platform_policy_scope') THEN
    ALTER TABLE public.community_ai_platform_policy
      ADD CONSTRAINT community_ai_platform_policy_scope
      CHECK ((organization_id IS NULL AND tenant_id IS NULL)
             OR (organization_id IS NOT NULL AND tenant_id IS NOT NULL AND organization_id = tenant_id));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_ai_platform_policy_platform_row
  ON public.community_ai_platform_policy ((true)) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_ai_platform_policy_org
  ON public.community_ai_platform_policy (organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE public.community_ai_platform_policy ALTER COLUMN execution_enabled SET DEFAULT false;
ALTER TABLE public.community_ai_platform_policy ALTER COLUMN auto_rules_enabled SET DEFAULT false;
ALTER TABLE public.community_ai_platform_policy ALTER COLUMN require_human_approval SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.community_ai_platform_policy_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'community_ai_platform_policy %: organization_id and tenant_id are immutable', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS community_ai_platform_policy_touch ON public.community_ai_platform_policy;
CREATE TRIGGER community_ai_platform_policy_touch
  BEFORE UPDATE ON public.community_ai_platform_policy
  FOR EACH ROW EXECUTE FUNCTION public.community_ai_platform_policy_touch();

CREATE OR REPLACE FUNCTION public.community_execution_policy_decision(p_org uuid, p_tenant uuid)
RETURNS TABLE (allowed boolean, code text, auto_rules_enabled boolean, policy_version timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  r          record;
  v_plat     record;
  v_ten      record;
  v_n_plat   integer := 0;
  v_n_ten    integer := 0;
  v_kill     boolean := false;
  v_version  timestamptz;
BEGIN
  IF p_org IS NULL OR p_tenant IS NULL THEN
    RETURN QUERY SELECT false, 'POLICY_SCOPE_INVALID'::text, false, NULL::timestamptz;
    RETURN;
  END IF;

  FOR r IN SELECT p.execution_enabled, p.auto_rules_enabled, p.updated_at, p.tenant_id
             FROM community_ai_platform_policy p
            WHERE p.organization_id IS NULL
            ORDER BY p.id
              FOR SHARE LOOP
    v_n_plat := v_n_plat + 1;
    v_plat := r;
    IF r.execution_enabled IS FALSE THEN v_kill := true; END IF;
    v_version := greatest(v_version, r.updated_at);
  END LOOP;
  FOR r IN SELECT p.execution_enabled, p.auto_rules_enabled, p.updated_at, p.tenant_id
             FROM community_ai_platform_policy p
            WHERE p.organization_id = p_org
            ORDER BY p.id
              FOR SHARE LOOP
    v_n_ten := v_n_ten + 1;
    v_ten := r;
    v_version := greatest(v_version, r.updated_at);
  END LOOP;

  IF v_kill THEN
    RETURN QUERY SELECT false, 'PLATFORM_KILL_SWITCH'::text, false, v_version; RETURN;
  END IF;
  IF v_n_plat = 0 OR v_n_ten = 0 THEN
    RETURN QUERY SELECT false, 'POLICY_MISSING'::text, false, v_version; RETURN;
  END IF;
  IF v_n_plat > 1 OR v_n_ten > 1 THEN
    RETURN QUERY SELECT false, 'POLICY_AMBIGUOUS'::text, false, v_version; RETURN;
  END IF;
  IF v_ten.tenant_id IS DISTINCT FROM p_tenant THEN
    RETURN QUERY SELECT false, 'POLICY_TENANT_MISMATCH'::text, false, v_version; RETURN;
  END IF;
  IF v_plat.execution_enabled IS NULL OR v_plat.auto_rules_enabled IS NULL
     OR v_ten.execution_enabled IS NULL OR v_ten.auto_rules_enabled IS NULL THEN
    RETURN QUERY SELECT false, 'POLICY_MALFORMED'::text, false, v_version; RETURN;
  END IF;
  IF NOT v_ten.execution_enabled THEN
    RETURN QUERY SELECT false, 'POLICY_EXECUTION_DISABLED'::text, false, v_version; RETURN;
  END IF;
  RETURN QUERY SELECT true, NULL::text, (v_plat.auto_rules_enabled AND v_ten.auto_rules_enabled), v_version;
END
$$;

COMMENT ON FUNCTION public.community_execution_policy_decision(uuid, uuid) IS
  'community_tenant_execution_policy: the one execution-policy decision for a tenant (platform kill switch + tenant row, closed when missing). Rows read FOR SHARE.';

REVOKE EXECUTE ON FUNCTION public.community_execution_policy_decision(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_execution_policy_decision(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.community_ai_platform_policy_touch() FROM PUBLIC, anon, authenticated;

-- Postconditions
DO $$
DECLARE
  f regprocedure := to_regprocedure('public.community_execution_policy_decision(uuid,uuid)');
BEGIN
  IF f IS NULL OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'community tenant execution policy postcondition: decision function absent or not SECURITY DEFINER';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy' AND column_name = 'execution_enabled') <> 'false'
     OR (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy' AND column_name = 'auto_rules_enabled') <> 'false' THEN
    RAISE EXCEPTION 'community tenant execution policy postcondition: execution defaults are not closed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_function_privilege('anon', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community tenant execution policy postcondition: anon can execute the decision';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'community tenant execution policy postcondition: authenticated can execute the decision';
  END IF;
END
$$;
