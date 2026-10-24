-- ============================================================================
-- Closure-014 — PRODUCTION GRANT-IMPACT QUERY (read-only). OPERATOR-RUN ONLY.
-- Candidate under review: integration/closure-014 (built on f0b89519).
-- Target: Supabase project ref klkiseupptzbecbxwrky — verify the REF, never the display name.
-- The agent has NOT run this anywhere; it must be executed by an authorized operator and
-- the output independently reviewed before any conclusion is drawn.
--
-- Purpose: list every principal whose platform-tier WRITE access changes when
-- f0b89519 ships, i.e. principals that HOLD a platform-tier write capability
-- but do NOT satisfy hasPlatformWriteAuthority():
--     an active user_company_roles row with role = 'SUPER_ADMIN' (exact, case-sensitive)
--     (backend/security/platformCapabilities.ts isPlatformSuperAdminPrincipal +
--      backend/security/platformWriteAuthority.ts hasPlatformWriteAuthority).
--
-- Two ways to HOLD such a capability (backend/security/CapabilityService.ts
-- resolveUserCapabilities):
--   A. a direct capability_assignments row: revoked_at IS NULL and
--      (expires_at IS NULL OR expires_at > now()); org-scoped OR global
--      (AuthorizationService.holdsCapabilityInOrganization does not bind
--      platform-tier capabilities to an organisation);
--   B. an ACTIVE role whose UPPER-CASED value is SUPER_ADMIN but which is not the
--      exact string 'SUPER_ADMIN'. Closure-014 (A) made capabilitiesForRole agree
--      with the exact authority predicate: such a row now yields NO capabilities at
--      all (reads included) — a full super-admin LOCKOUT for that operator unless
--      the data is normalized first (owner action, see the Closure-014 report).
--
-- Output: identifiers + capability + source + role status only. No email, name,
-- IP, token or audit content.
--
-- SAFETY: wrapped in a READ ONLY transaction that ends in ROLLBACK. Any write
-- would be rejected by Postgres ("cannot execute ... in a read-only transaction").
-- ============================================================================
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

-- ── Query 1: per-principal impact rows ──────────────────────────────────────
WITH write_tier(capability) AS (
  -- The 15 grantable capability strings that confer a platform-tier WRITE
  -- capability (PLATFORM_TIER_CAPABILITIES minus super_admin.dashboard.view and
  -- consumption.view.aggregate), derived from the code at f0b89519 with
  -- expandWithHierarchy: 'identity.admin' is the only value that expands
  -- (to .assign/.revoke/.delete); every other value confers only itself.
  VALUES
    ('identity.admin'), ('identity.admin.assign'), ('identity.admin.revoke'), ('identity.admin.delete'),
    ('organization.delete'), ('intelligence.override.manage'), ('cron.config.manage'), ('blog.publish.manage'),
    ('integration.platform.oauth.manage'), ('billing.platform.manage'), ('billing.plan.manage'),
    ('billing.grant_free_credits'), ('outreach.platform.manage'), ('publish.recovery.manage'),
    ('platform.controls.manage')
),
membership AS (
  SELECT ucr.user_id,
         bool_or(ucr.role = 'SUPER_ADMIN' AND ucr.status = 'active')                              AS exact_active_super_admin,
         bool_or(upper(ucr.role) = 'SUPER_ADMIN' AND ucr.role <> 'SUPER_ADMIN' AND ucr.status = 'active') AS noncanonical_active_super_admin,
         bool_or(upper(ucr.role) = 'SUPER_ADMIN' AND ucr.status IS DISTINCT FROM 'active')         AS non_active_super_admin_row
  FROM public.user_company_roles ucr
  GROUP BY ucr.user_id
),
holders AS (
  -- A. direct grants
  SELECT ca.user_id                                                     AS principal_user_id,
         ca.capability                                                  AS capability,
         'capability_assignments'::text                                 AS grant_source,
         CASE WHEN ca.organization_id IS NULL THEN 'global' ELSE 'organization' END AS grant_scope
  FROM public.capability_assignments ca
  JOIN write_tier w ON w.capability = ca.capability
  WHERE ca.revoked_at IS NULL
    AND (ca.expires_at IS NULL OR ca.expires_at > now())
  UNION ALL
  -- B. active non-canonical SUPER_ADMIN role spelling (role-derived holder)
  SELECT ucr.user_id, 'ALL platform-tier write capabilities (via role)', 'user_company_roles.role', 'organization'
  FROM public.user_company_roles ucr
  WHERE ucr.status = 'active' AND upper(ucr.role) = 'SUPER_ADMIN' AND ucr.role <> 'SUPER_ADMIN'
)
SELECT h.principal_user_id,
       h.capability,
       h.grant_source,
       h.grant_scope,
       CASE
         WHEN coalesce(m.noncanonical_active_super_admin, false) THEN 'active_noncanonical_super_admin_role'
         WHEN coalesce(m.non_active_super_admin_row, false)      THEN 'super_admin_row_not_active'
         ELSE 'no_super_admin_row'
       END                                                              AS super_admin_role_status,
       CASE
         WHEN u.is_deleted OR to_jsonb(u) ->> 'status' = 'deleted' THEN 'deleted_cannot_authenticate'
         ELSE 'can_authenticate'
       END                                                              AS account_state,
       CASE
         WHEN u.is_deleted OR to_jsonb(u) ->> 'status' = 'deleted' THEN 'no_runtime_change'
         WHEN coalesce(m.noncanonical_active_super_admin, false) THEN 'RELEASE_BLOCKER_super_admin_lockout'
         ELSE 'LOSES_platform_write_access'
       END                                                              AS impact
FROM holders h
LEFT JOIN membership m ON m.user_id = h.principal_user_id
LEFT JOIN public.users u ON u.id = h.principal_user_id
WHERE NOT coalesce(m.exact_active_super_admin, false)   -- exact active SUPER_ADMIN: unaffected
ORDER BY impact, h.principal_user_id, h.capability;

-- ── Query 2: counts only (no identifiers) — share this first ────────────────
WITH write_tier(capability) AS (
  VALUES
    ('identity.admin'), ('identity.admin.assign'), ('identity.admin.revoke'), ('identity.admin.delete'),
    ('organization.delete'), ('intelligence.override.manage'), ('cron.config.manage'), ('blog.publish.manage'),
    ('integration.platform.oauth.manage'), ('billing.platform.manage'), ('billing.plan.manage'),
    ('billing.grant_free_credits'), ('outreach.platform.manage'), ('publish.recovery.manage'),
    ('platform.controls.manage')
),
exact_sa AS (
  SELECT DISTINCT user_id FROM public.user_company_roles WHERE role = 'SUPER_ADMIN' AND status = 'active'
)
SELECT 'direct_grant_holders_without_exact_active_super_admin' AS metric,
       count(DISTINCT ca.user_id)                              AS principals,
       count(*)                                                AS grant_rows
FROM public.capability_assignments ca
JOIN write_tier w ON w.capability = ca.capability
WHERE ca.revoked_at IS NULL AND (ca.expires_at IS NULL OR ca.expires_at > now())
  AND ca.user_id NOT IN (SELECT user_id FROM exact_sa)
UNION ALL
SELECT 'active_noncanonical_super_admin_role_without_exact_row',
       count(DISTINCT ucr.user_id), count(*)
FROM public.user_company_roles ucr
WHERE ucr.status = 'active' AND upper(ucr.role) = 'SUPER_ADMIN' AND ucr.role <> 'SUPER_ADMIN'
  AND ucr.user_id NOT IN (SELECT user_id FROM exact_sa)
UNION ALL
SELECT 'exact_active_super_admins_unaffected', count(*), NULL FROM exact_sa;

-- ── Query 3: break-glass (counts only) ──────────────────────────────────────
-- After Closure-014 only an exact active SUPER_ADMIN can perform platform writes,
-- and ALL 15 platform-tier write capabilities require a passkey step-up on a
-- trusted device (StepUpPolicyRegistry: phishingResistantOnly + trustedDeviceRequired).
-- Release requires >= 1 (recommended >= 2) such operator WITH a usable passkey.
-- webauthn_credentials: user_id, revoked_at (IdentityResolver.fetchMfaState).
SELECT count(DISTINCT ucr.user_id)                                         AS exact_active_super_admins,
       count(DISTINCT ucr.user_id) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.webauthn_credentials wc
         WHERE wc.user_id = ucr.user_id AND wc.revoked_at IS NULL))        AS with_active_passkey
FROM public.user_company_roles ucr
JOIN public.users u ON u.id = ucr.user_id
WHERE ucr.role = 'SUPER_ADMIN' AND ucr.status = 'active'
  AND NOT u.is_deleted AND coalesce(to_jsonb(u) ->> 'status', 'active') <> 'deleted';

-- ── Query 4: legacy direct grants requiring review (Closure-014 E; identifiers only) ──
-- Every ACTIVE direct grant of ANY platform-tier capability (write OR read), with the
-- holder's SUPER_ADMIN status. Read grants (super_admin.dashboard.view,
-- consumption.view.aggregate) to non-super-admins stay valid but should be confirmed;
-- write grants to non-super-admins are inert after Closure-014 and are candidates for
-- revocation BY THE OWNER through the established revoke path (never by this script).
SELECT ca.user_id AS principal_user_id,
       ca.capability,
       CASE WHEN ca.organization_id IS NULL THEN 'global' ELSE 'organization' END AS grant_scope,
       CASE WHEN ca.capability IN ('super_admin.dashboard.view', 'consumption.view.aggregate') THEN 'platform_read' ELSE 'platform_write' END AS capability_class,
       EXISTS (SELECT 1 FROM public.user_company_roles r WHERE r.user_id = ca.user_id AND r.role = 'SUPER_ADMIN' AND r.status = 'active') AS holder_is_active_super_admin,
       (ca.expires_at IS NOT NULL) AS has_expiry
FROM public.capability_assignments ca
WHERE ca.revoked_at IS NULL
  AND (ca.expires_at IS NULL OR ca.expires_at > now())
  AND ca.capability IN (
    'identity.admin', 'identity.admin.assign', 'identity.admin.revoke', 'identity.admin.delete',
    'organization.delete', 'intelligence.override.manage', 'cron.config.manage', 'blog.publish.manage',
    'integration.platform.oauth.manage', 'billing.platform.manage', 'billing.plan.manage',
    'billing.grant_free_credits', 'outreach.platform.manage', 'publish.recovery.manage',
    'platform.controls.manage', 'super_admin.dashboard.view', 'consumption.view.aggregate')
ORDER BY capability_class, holder_is_active_super_admin, ca.capability, ca.user_id;

ROLLBACK;
