-- ============================================================================
-- PROPOSED — NOT A MIGRATION. Closure-014 (E) grant governance.
-- Lives outside supabase/migrations on purpose: adding it to the release
-- migration set is a SCHEMA decision that needs explicit owner authorization.
-- Not applied anywhere. Not validated against a database yet (the local
-- certification Postgres was unavailable: Docker Desktop "unable to start").
--
-- Rule (mirrors backend/security/capabilityGrantPolicy.ts):
--   an ACTIVE (revoked_at IS NULL) capability_assignments row granting a
--   platform-tier WRITE capability may exist only for a user who holds an
--   ACTIVE user_company_roles row with role exactly 'SUPER_ADMIN'.
--
-- Scope / limits:
--   * BEFORE INSERT OR UPDATE on capability_assignments only. It does not
--     re-check existing rows (legacy grants are found by the read-only
--     grant-impact query and handled by an owner decision) and does not react
--     when a SUPER_ADMIN is later deactivated — requireCapability already
--     refuses such a holder at runtime.
--   * Database-owner bypass remains: a superuser / table owner can
--     `ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER`. Only the service-role
--     write path is constrained; this is documented, not hidden.
--   * The 15 values are the grantable strings that confer a platform-tier write
--     capability at f0b89519 (expandWithHierarchy: 'identity.admin' expands to
--     .assign/.revoke/.delete). Keep in sync with PLATFORM_TIER_WRITE_CAPABILITIES.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.capability_assignments_platform_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.revoked_at IS NULL
     AND NEW.capability IN (
       'identity.admin', 'identity.admin.assign', 'identity.admin.revoke', 'identity.admin.delete',
       'organization.delete', 'intelligence.override.manage', 'cron.config.manage', 'blog.publish.manage',
       'integration.platform.oauth.manage', 'billing.platform.manage', 'billing.plan.manage',
       'billing.grant_free_credits', 'outreach.platform.manage', 'publish.recovery.manage',
       'platform.controls.manage')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_company_roles ucr
       WHERE ucr.user_id = NEW.user_id AND ucr.role = 'SUPER_ADMIN' AND ucr.status = 'active')
  THEN
    RAISE EXCEPTION 'capability_assignments: % is a platform-tier write capability and may only be granted to an active SUPER_ADMIN', NEW.capability
      USING ERRCODE = 'check_violation', HINT = 'A direct grant is not platform authority (Closure-013 D-3 / Closure-014 E).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capability_assignments_platform_write_guard ON public.capability_assignments;
CREATE TRIGGER capability_assignments_platform_write_guard
  BEFORE INSERT OR UPDATE OF capability, revoked_at, user_id ON public.capability_assignments
  FOR EACH ROW EXECUTE FUNCTION public.capability_assignments_platform_write_guard();

COMMENT ON FUNCTION public.capability_assignments_platform_write_guard() IS
  'Closure-014 (E): refuses an active direct grant of a platform-tier WRITE capability to a non-SUPER_ADMIN. Owner/superuser can bypass by disabling the trigger.';

COMMIT;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP TRIGGER IF EXISTS capability_assignments_platform_write_guard ON public.capability_assignments;
--   DROP FUNCTION IF EXISTS public.capability_assignments_platform_write_guard();
-- COMMIT;

-- ── Local validation script (run against the CERT stack only, inside a
--    transaction that is ROLLED BACK) ────────────────────────────────────────
-- BEGIN;
--   \i this-file (without its own BEGIN/COMMIT)
--   -- expect ERROR check_violation: VIEW_ONLY user + 'billing.grant_free_credits'
--   -- expect OK: exact active SUPER_ADMIN + 'billing.grant_free_credits'
--   -- expect OK: VIEW_ONLY user + 'super_admin.dashboard.view'
--   -- expect OK: VIEW_ONLY user + platform write capability with revoked_at set
--   -- expect ERROR: un-revoking (UPDATE revoked_at = NULL) a platform write grant of a non-SUPER_ADMIN
-- ROLLBACK;
