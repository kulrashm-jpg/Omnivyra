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
  SUPER_ADMIN_DASHBOARD_VIEW,
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
