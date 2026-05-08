/**
 * capabilityRegistry — role → capability mapping + hierarchy expansion.
 *
 * The runtime authority for "what can a role do" lives in this file. The
 * mapping is intentionally narrow: roles confer the minimum capability set
 * that preserves existing behavior. Wider grants are explicit — handed out
 * via capability_assignments (audited).
 *
 * Wave 2A constraint: this mapping must NOT change observable behavior on
 * the existing route surface. Each role's capability list is calibrated
 * against current role-check sites.
 *
 * Wave 2C (the route-conversion phase) is the moment to refine grants.
 */

import {
  ALL_CAPABILITIES,
  CAPABILITY_HIERARCHY,
  type Capability,
  // Identity
  IDENTITY_ADMIN,
  // Org
  ORGANIZATION_MANAGE,
  ORGANIZATION_DELETE,
  // Billing
  BILLING_MANAGE,
  BILLING_VIEW,
  // Campaigns
  CAMPAIGN_EXECUTE,
  CAMPAIGN_DELETE,
  CAMPAIGN_VIEW,
  // Content
  CONTENT_PUBLISH,
  CONTENT_REVIEW,
  CONTENT_CREATE,
  CONTENT_DELETE,
  // Integrations / API keys
  INTEGRATION_MANAGE,
  API_KEY_MANAGE,
  // Automation
  AUTOMATION_EXECUTE,
  AUTOMATION_EXECUTE_PROD,
  AUTOMATION_TRANSFER,
  // MFA
  MFA_ENROLL,
  MFA_REVOKE,
  MFA_VIEW_FACTORS,
  // Phase 1 — super-admin canonicalization
  SUPER_ADMIN_DASHBOARD_VIEW,
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  BLOG_PUBLISH_MANAGE,
  CONSUMPTION_VIEW_AGGREGATE,
  INTELLIGENCE_OVERRIDE_MANAGE,
  CRON_CONFIG_MANAGE,
  CONTENT_ARCHITECT_READ,
  CONTENT_ARCHITECT_WRITE,
  // Phase: Platform Authority Isolation — platform-tier billing
  BILLING_PLATFORM_MANAGE,
  BILLING_PLAN_MANAGE,
  BILLING_GRANT_FREE_CREDITS,
  // Bridge
  SUPER_ADMIN_LEGACY_BRIDGE,
} from '../../shared/contracts/security';

/**
 * The runtime role surface. Anchored on rbacPrimitives.Role values; legacy
 * aliases (ADMIN, CONTENT_MANAGER, etc.) are normalized BEFORE reaching this
 * mapping by rbacPrimitives.normalizeRole.
 */
export type CanonicalRole =
  | 'SUPER_ADMIN'
  | 'COMPANY_ADMIN'
  | 'CONTENT_ARCHITECT'
  | 'CONTENT_CREATOR'
  | 'CONTENT_REVIEWER'
  | 'CONTENT_PUBLISHER'
  | 'VIEW_ONLY';

/**
 * ROLE_CAPABILITIES — the canonical mapping.
 *
 * SUPER_ADMIN intentionally does NOT include identity-administration
 * capabilities at the role level: those go through capability_assignments
 * with audit. The role grants enough to access platform admin surfaces;
 * platform mutation requires explicit grant.
 *
 * The legacy cookie super-admin path (super_admin_session=1) maps to a
 * DIFFERENT capability set — see legacyCookieSuperAdminBridge.ts.
 */
export const ROLE_CAPABILITIES: Readonly<Record<CanonicalRole, ReadonlyArray<Capability>>> = {
  SUPER_ADMIN: [
    // Platform admin surface (read-mostly + admin-action gating).
    IDENTITY_ADMIN,             // expansion: assign / revoke / delete
    ORGANIZATION_MANAGE,
    ORGANIZATION_DELETE,
    BILLING_MANAGE,             // expansion: view + purchase + audit.view
    INTEGRATION_MANAGE,         // expansion: secrets.read
    API_KEY_MANAGE,             // expansion: generate
    AUTOMATION_EXECUTE_PROD,    // expansion: execute
    AUTOMATION_TRANSFER,
    MFA_ENROLL,
    MFA_REVOKE,                 // expansion: view_factors
    CAMPAIGN_EXECUTE,           // expansion: view
    CAMPAIGN_DELETE,
    CONTENT_PUBLISH,            // expansion: review + create
    CONTENT_DELETE,
    // Phase 1 — platform-admin surfaces formerly granted by bridge cookie.
    SUPER_ADMIN_DASHBOARD_VIEW,
    INTEGRATION_PLATFORM_OAUTH_MANAGE,  // step-up required (see STEP_UP_REQUIRED_CAPABILITIES)
    BLOG_PUBLISH_MANAGE,
    CONSUMPTION_VIEW_AGGREGATE,
    INTELLIGENCE_OVERRIDE_MANAGE,
    CRON_CONFIG_MANAGE,
    // Phase: Platform Authority Isolation — platform-tier billing.
    // These are NOT inherited from BILLING_MANAGE because BILLING_MANAGE is
    // a per-tenant capability granted to COMPANY_ADMIN. Without an explicit
    // platform-tier capability, COMPANY_ADMINs would satisfy platform billing
    // routes whenever the route omits an `organizationId` binding.
    BILLING_PLATFORM_MANAGE,
    BILLING_PLAN_MANAGE,
    BILLING_GRANT_FREE_CREDITS,
  ],
  COMPANY_ADMIN: [
    ORGANIZATION_MANAGE,        // org settings, member management (NOT delete)
    BILLING_MANAGE,             // expansion: view + purchase + audit.view
    INTEGRATION_MANAGE,         // expansion: secrets.read (NOT platform-oauth — that's SUPER_ADMIN-only)
    API_KEY_MANAGE,             // expansion: generate
    AUTOMATION_EXECUTE,         // production execution requires step-up + role escalation
    MFA_ENROLL,
    MFA_VIEW_FACTORS,
    CAMPAIGN_EXECUTE,           // expansion: view
    CAMPAIGN_DELETE,
    CONTENT_PUBLISH,            // expansion: review + create
    CONTENT_DELETE,
  ],
  CONTENT_ARCHITECT: [
    // Platform-level role: read+author across all companies.
    CONTENT_ARCHITECT_WRITE,    // expansion: read
    CAMPAIGN_VIEW,
    CONTENT_CREATE,
    CONTENT_REVIEW,
    MFA_ENROLL,
    MFA_VIEW_FACTORS,
  ],
  CONTENT_PUBLISHER: [
    CAMPAIGN_VIEW,
    CONTENT_PUBLISH,            // expansion: review + create
    MFA_ENROLL,
    MFA_VIEW_FACTORS,
  ],
  CONTENT_REVIEWER: [
    CAMPAIGN_VIEW,
    CONTENT_REVIEW,
    CONTENT_CREATE,
    MFA_ENROLL,
    MFA_VIEW_FACTORS,
  ],
  CONTENT_CREATOR: [
    CAMPAIGN_VIEW,
    CONTENT_CREATE,
    MFA_ENROLL,
    MFA_VIEW_FACTORS,
  ],
  VIEW_ONLY: [
    CAMPAIGN_VIEW,
    MFA_ENROLL,                 // a viewer may still self-enroll their own MFA
    MFA_VIEW_FACTORS,
  ],
};

/**
 * The legacy cookie super-admin bridge grants a narrow surface that PRESERVES
 * existing behavior of cookie-protected endpoints, but does NOT satisfy
 * step-up requirements. Wave 3 deletes this entirely once a DB-backed
 * SUPER_ADMIN principal exists.
 */
export const LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES: ReadonlyArray<Capability> = [
  SUPER_ADMIN_LEGACY_BRIDGE,
  // These cover the read-mostly admin endpoints that historically accept the
  // cookie. Mutation endpoints that should require step-up (e.g. billing,
  // identity admin, api-key issuance) MUST gate on phishing-resistant
  // step-up — the legacy bridge cannot satisfy that gate.
  CAMPAIGN_VIEW,
  BILLING_VIEW,
  MFA_VIEW_FACTORS,
  // Phase 2 — bridge compatibility expansion. These read capabilities are
  // granted to bridge principals so admin routes migrated to
  // `requireCapability(...)` continue to work for cookie-only operators
  // until Wave 3 deletes the bridge.
  // Mutation/elevated capabilities (INTEGRATION_PLATFORM_OAUTH_MANAGE,
  // BLOG_PUBLISH_MANAGE write paths, INTELLIGENCE_OVERRIDE_MANAGE,
  // CRON_CONFIG_MANAGE) are intentionally NOT in this list — bridge
  // principals must upgrade to canonical session for those.
  SUPER_ADMIN_DASHBOARD_VIEW,
  CONSUMPTION_VIEW_AGGREGATE,
];

/**
 * Build a parent → children adjacency from CAPABILITY_HIERARCHY.
 */
function buildHierarchyIndex(): Map<Capability, ReadonlyArray<Capability>> {
  const map = new Map<Capability, Capability[]>();
  for (const { parent, child } of CAPABILITY_HIERARCHY) {
    const list = map.get(parent) ?? [];
    list.push(child);
    map.set(parent, list);
  }
  return map;
}

const HIERARCHY_INDEX = buildHierarchyIndex();

/**
 * Expand a set of capabilities through the parent→child hierarchy. The
 * result is a deduplicated, transitively-closed set (so granting
 * `identity.admin` yields `identity.admin`, `identity.admin.assign`,
 * `identity.admin.revoke`, `identity.admin.delete`).
 */
export function expandWithHierarchy(
  base: ReadonlyArray<Capability>,
): ReadonlyArray<Capability> {
  const result = new Set<Capability>();
  const stack = [...base];
  while (stack.length > 0) {
    const cap = stack.pop()!;
    if (result.has(cap)) continue;
    result.add(cap);
    const children = HIERARCHY_INDEX.get(cap) ?? [];
    for (const child of children) {
      if (!result.has(child)) stack.push(child);
    }
  }
  return Array.from(result);
}

/**
 * Resolve a role to its hierarchy-expanded capability set.
 * Unknown roles return an empty list.
 */
export function capabilitiesForRole(role: string | null | undefined): ReadonlyArray<Capability> {
  if (!role) return [];
  const upper = role.toUpperCase() as CanonicalRole;
  const base = ROLE_CAPABILITIES[upper];
  if (!base) return [];
  return expandWithHierarchy(base);
}

/**
 * Resolve the legacy cookie super-admin bridge capability set.
 */
export function legacyCookieSuperAdminCapabilities(): ReadonlyArray<Capability> {
  return expandWithHierarchy(LEGACY_COOKIE_SUPER_ADMIN_CAPABILITIES);
}

/**
 * Validation helper for the migration safety report. Returns capabilities
 * that exist in ALL_CAPABILITIES but are not granted by ANY role and have
 * no hierarchy parent that IS granted. These are "orphan" capabilities —
 * declared but unreachable until an explicit capability_assignment is made.
 */
export function orphanCapabilities(): ReadonlyArray<Capability> {
  const reachable = new Set<Capability>();
  for (const role of Object.keys(ROLE_CAPABILITIES) as CanonicalRole[]) {
    for (const cap of capabilitiesForRole(role)) reachable.add(cap);
  }
  for (const cap of legacyCookieSuperAdminCapabilities()) reachable.add(cap);
  return ALL_CAPABILITIES.filter((c) => !reachable.has(c));
}
