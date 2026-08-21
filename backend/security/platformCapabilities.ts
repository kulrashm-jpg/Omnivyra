/**
 * Platform-tier capability registry — strict isolation between platform and
 * tenant authority.
 *
 * Phase: Platform Authority Isolation.
 *
 * Why this file exists:
 *   The canonical capability mapping in `capabilityRegistry.ts` correctly
 *   gives SUPER_ADMIN a superset of COMPANY_ADMIN's capabilities. But some
 *   capabilities (like `BILLING_MANAGE`) are intentionally PER-TENANT — they
 *   need an `organizationId` binding to mean anything safe. When a route
 *   forgets to pass `organizationId`, COMPANY_ADMIN of any single org would
 *   pass the gate even on a platform-level operation.
 *
 *   This module enumerates the capabilities that are PLATFORM-ONLY and MUST
 *   NEVER appear in any tenant role's capability set. The runtime `assert`
 *   helper confirms the canonical registry stays consistent.
 *
 * If you're adding a new platform-tier capability:
 *   1. Define it in `shared/contracts/security/SecurityCapabilities.ts`
 *   2. Add it to ROLE_CAPABILITIES.SUPER_ADMIN (and ONLY SUPER_ADMIN) in
 *      `capabilityRegistry.ts`.
 *   3. Add it to PLATFORM_TIER_CAPABILITIES below.
 *   4. Register a step-up policy in `StepUpPolicyRegistry.ts`.
 *   5. The startup check in this file will fail if any tenant role
 *      accidentally inherits the capability.
 */

import {
  BILLING_GRANT_FREE_CREDITS,
  BILLING_PLAN_MANAGE,
  BILLING_PLATFORM_MANAGE,
  BLOG_PUBLISH_MANAGE,
  CONSUMPTION_VIEW_AGGREGATE,
  CRON_CONFIG_MANAGE,
  IDENTITY_ADMIN,
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_DELETE,
  IDENTITY_ADMIN_REVOKE,
  INTELLIGENCE_OVERRIDE_MANAGE,
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  ORGANIZATION_DELETE,
  STEP_UP_REQUIRED_CAPABILITIES,
  SUPER_ADMIN_DASHBOARD_VIEW,
  type AuthenticatedPrincipal,
  type Capability,
} from '../../shared/contracts/security';
import { ROLE_CAPABILITIES, type CanonicalRole, capabilitiesForRole } from './capabilityRegistry';

/**
 * Capabilities that may ONLY be granted to platform roles (SUPER_ADMIN /
 * CONTENT_ARCHITECT). They MUST NOT appear in COMPANY_ADMIN, CONTENT_*,
 * or VIEW_ONLY mappings.
 *
 * Routes consuming these capabilities can omit `organizationId` from
 * `requireCapability` because the capability itself is platform-tier — no
 * tenant role inherits it, so no tenant escalation is possible.
 */
export const PLATFORM_TIER_CAPABILITIES: ReadonlyArray<Capability> = [
  // Identity admin
  IDENTITY_ADMIN,
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_REVOKE,
  IDENTITY_ADMIN_DELETE,
  // Organization-level destructive
  ORGANIZATION_DELETE,
  // Platform admin surfaces
  SUPER_ADMIN_DASHBOARD_VIEW,
  CONSUMPTION_VIEW_AGGREGATE,
  INTELLIGENCE_OVERRIDE_MANAGE,
  CRON_CONFIG_MANAGE,
  BLOG_PUBLISH_MANAGE,
  // Platform integrations
  INTEGRATION_PLATFORM_OAUTH_MANAGE,
  // Platform billing
  BILLING_PLATFORM_MANAGE,
  BILLING_PLAN_MANAGE,
  BILLING_GRANT_FREE_CREDITS,
];

/**
 * Tenant roles — these MUST NEVER hold any capability in
 * PLATFORM_TIER_CAPABILITIES (transitively expanded through the hierarchy).
 *
 * SUPER_ADMIN and CONTENT_ARCHITECT are excluded — the former is the
 * platform role itself, and CONTENT_ARCHITECT has its own platform-isolation
 * rules (see `CONTENT_ARCHITECT_*` capabilities).
 */
const TENANT_ROLES: ReadonlyArray<CanonicalRole> = [
  'COMPANY_ADMIN',
  'CONTENT_PUBLISHER',
  'CONTENT_REVIEWER',
  'CONTENT_CREATOR',
  'VIEW_ONLY',
];

/**
 * Run-time assertion: confirms the canonical role registry obeys the
 * platform/tenant isolation invariant. Throws on any violation so the
 * server fails to start rather than silently leaking platform authority.
 *
 * Call once at process startup (e.g. from a server entry / health probe).
 * Pure / cheap — no I/O.
 */
export function assertPlatformCapabilityIsolation(): void {
  const violations: string[] = [];
  for (const role of TENANT_ROLES) {
    const expanded = capabilitiesForRole(role);
    for (const platformCap of PLATFORM_TIER_CAPABILITIES) {
      if (expanded.includes(platformCap)) {
        violations.push(
          `Tenant role ${role} unexpectedly holds platform capability ${platformCap}`,
        );
      }
    }
  }
  // Cross-organization identity capabilities must be a subset of the
  // platform tier: if one were ever tenant-grantable, a tenant role could
  // administer membership in tenants it does not belong to.
  const platformSet = new Set(PLATFORM_TIER_CAPABILITIES);
  const stepUpSet = new Set<Capability>(STEP_UP_REQUIRED_CAPABILITIES);
  for (const cap of CROSS_ORGANIZATION_IDENTITY_CAPABILITIES) {
    if (!platformSet.has(cap)) {
      violations.push(
        `Cross-organization identity capability ${cap} is not platform-tier`,
      );
    }
    // ...and must require step-up, so the org-membership waiver can never
    // become an unelevated cross-tenant write.
    if (!stepUpSet.has(cap)) {
      violations.push(
        `Cross-organization identity capability ${cap} does not require step-up`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `[platform-isolation] ${violations.length} violation(s) detected:\n  - ${violations.join('\n  - ')}\n` +
      `Either remove the capability from the tenant role's mapping in capabilityRegistry.ts, ` +
      `or remove it from PLATFORM_TIER_CAPABILITIES if it should be tenant-grantable.`,
    );
  }
}

/**
 * For audit / diagnostic surfaces: returns a read-only view of which
 * capabilities each role has, with platform-tier ones flagged.
 */
export function describeRoleCapabilityIsolation(): Array<{
  role: CanonicalRole;
  capabilities: ReadonlyArray<{ capability: Capability; isPlatformTier: boolean }>;
}> {
  const platformSet = new Set(PLATFORM_TIER_CAPABILITIES);
  return (Object.keys(ROLE_CAPABILITIES) as CanonicalRole[]).map((role) => ({
    role,
    capabilities: capabilitiesForRole(role).map((c) => ({
      capability: c,
      isPlatformTier: platformSet.has(c),
    })),
  }));
}


// ── Cross-organization platform identity administration ──────────────────────
//
// Phase 2Z-AF — SUPER_ADMIN identity-admin bootstrap deadlock.
//
// The problem this solves:
//   `decideCapability` requires the principal to hold an ACTIVE membership in
//   `requirement.organizationId`. For identity administration that rule is
//   self-defeating: the platform administrator provisioning the FIRST member of
//   a tenant can never be a member of it yet, so the very operation that would
//   create the membership is denied NOT_ORG_MEMBER. Production proved this —
//   a canonical SUPER_ADMIN was denied while attaching the first operator to an
//   empty tenant.
//
// The rule below is deliberately NOT "SUPER_ADMIN skips organization checks".
// It is the narrowest statement of the actual intent:
//
//     platform SUPER_ADMIN + an identity-administration capability
//       → may administer membership in the EXPLICITLY SUPPLIED tenant
//
// What is waived is only the ACTOR-membership precondition. Everything else is
// untouched: the capability must still be held, the target organization must
// still be supplied and still bounds the write, step-up is still evaluated
// downstream, and the decision is still audited against the target org.

/**
 * Capabilities whose organization scope names the TARGET of a cross-tenant
 * platform operation rather than an organization the actor must belong to.
 *
 * Keep this list minimal. A capability belongs here only when the operation is
 * inherently cross-tenant AND cannot be performed by a tenant-resident actor.
 * Membership in this list is constrained by `assertPlatformCapabilityIsolation`:
 * every member must also be platform-tier (so no tenant role can ever inherit
 * it) and step-up-required (so elevation can never be dropped).
 */
export const CROSS_ORGANIZATION_IDENTITY_CAPABILITIES: ReadonlyArray<Capability> = [
  IDENTITY_ADMIN_ASSIGN,
];

/**
 * True iff the principal holds the platform SUPER_ADMIN role itself.
 *
 * Deliberately stricter than holding a platform-tier capability:
 * `capability_assignments` can grant any single capability directly to any
 * user (see CapabilityService.resolveUserCapabilities), so capability
 * possession alone does NOT prove platform authority. Cross-organization
 * identity administration requires the role.
 *
 * Pure — reads only the resolved principal, no I/O.
 */
export function isPlatformSuperAdminPrincipal(principal: AuthenticatedPrincipal): boolean {
  return principal.organizations.some(
    (m) => m.role === 'SUPER_ADMIN' && m.status === 'active',
  );
}

/**
 * Decide whether the actor-membership precondition should be waived for this
 * (principal, capability) pair.
 *
 * ALL of the following must hold:
 *   - the capability is an enumerated cross-organization identity capability;
 *   - the principal holds the platform SUPER_ADMIN role (not merely the cap);
 *   - the principal is NOT a legacy cookie bridge principal;
 *   - the principal has a server-issued session.
 *
 * Step-up is intentionally NOT checked here. It is enforced immediately
 * afterwards by `decideCapabilityWithStepUp`, which is what lets an operator
 * who has not yet elevated receive `STEP_UP_REQUIRED` (401 — the UI launches
 * the passkey challenge) instead of a dead-end `NOT_ORG_MEMBER` (403).
 */
export function allowsCrossOrganizationIdentityAdministration(
  principal: AuthenticatedPrincipal,
  capability: Capability,
): boolean {
  if (!CROSS_ORGANIZATION_IDENTITY_CAPABILITIES.includes(capability)) return false;
  if (principal.legacyCookieSuperAdmin) return false;
  if (!principal.sessionId) return false;
  return isPlatformSuperAdminPrincipal(principal);
}

// ── Boot-time invariant enforcement ──────────────────────────────────────────
//
// Phase: Platform Authority Hard Enforcement.
//
// Run the isolation check at module load. If a tenant role was modified to
// hold a platform-tier capability (drift), this throws and the import that
// brought us here propagates the failure. Side-effect importers — notably
// `backend/security/IdentityResolver.ts` (canonical for every auth-gated
// request) — therefore guarantee the invariant fires on every server boot.
//
// Failure mode: first request that touches IdentityResolver returns 500 with
// a descriptive error logged. Operator sees the violation immediately rather
// than the platform silently leaking authority.
//
// Why module-load instead of an explicit boot hook: Next.js Pages Router has
// no canonical server-bootstrap entry point; modules load on first import.
// IdentityResolver is the closest thing to a guaranteed-eager security
// dependency.
try {
  assertPlatformCapabilityIsolation();
} catch (err) {
  // Re-throw so the import fails. Logging the descriptive message helps
  // operators triage when stack traces are obscured by Next.js bundling.
  // eslint-disable-next-line no-console
  console.error('[platform-isolation] BOOT ASSERTION FAILED:', err instanceof Error ? err.message : String(err));
  throw err;
}
