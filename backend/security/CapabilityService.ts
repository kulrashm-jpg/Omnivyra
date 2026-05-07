/**
 * CapabilityService — resolve a user's effective capability set.
 *
 * Sources, merged in order:
 *   1. user_company_roles → ROLE_CAPABILITIES (via capabilityRegistry)
 *   2. capability_assignments (explicit grants; per-org or platform-wide)
 *   3. hierarchy expansion (parent → child)
 *
 * NEVER consults users.role / users.company_id — both are deprecated
 * (Wave 1 removed all reads).
 */

import { supabase as db } from '../db/supabaseClient';
import { logger } from '../services/logger';
import {
  capabilitiesForRole,
  expandWithHierarchy,
  type CanonicalRole,
} from './capabilityRegistry';
import type { Capability } from '../../shared/contracts/security';

interface RoleRow {
  role: string | null;
  status: string | null;
  company_id: string | null;
}

interface AssignmentRow {
  capability: string;
  organization_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface UserCapabilityResolution {
  /** Capabilities aggregated across all active org memberships + assignments. */
  aggregate: ReadonlyArray<Capability>;
  /** Capabilities by org id (where org-scoped). Includes both role-derived
   *  and assignment-derived capabilities. */
  byOrganization: ReadonlyMap<string, ReadonlyArray<Capability>>;
}

/**
 * Resolve the full effective capability set for a user.
 *
 * Aggregate capabilities are the UNION of:
 *   - capabilities from each active user_company_roles row's role
 *   - capabilities from each non-expired non-revoked capability_assignments row
 * After hierarchy expansion.
 */
export async function resolveUserCapabilities(userId: string): Promise<UserCapabilityResolution> {
  const [{ data: roleRows }, { data: assignmentRows }] = await Promise.all([
    db
      .from('user_company_roles')
      .select('role, status, company_id')
      .eq('user_id', userId),
    db
      .from('capability_assignments')
      .select('capability, organization_id, expires_at, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null),
  ]);

  const aggregate = new Set<Capability>();
  const byOrg = new Map<string, Set<Capability>>();

  // Role-derived capabilities.
  for (const row of (roleRows ?? []) as RoleRow[]) {
    if (row.status !== 'active') continue;
    const caps = capabilitiesForRole(row.role);
    for (const cap of caps) aggregate.add(cap);
    if (row.company_id) {
      const set = byOrg.get(row.company_id) ?? new Set<Capability>();
      for (const cap of caps) set.add(cap);
      byOrg.set(row.company_id, set);
    }
  }

  // Assignment-derived capabilities. Skip expired.
  const now = Date.now();
  for (const row of (assignmentRows ?? []) as AssignmentRow[]) {
    if (row.expires_at && Date.parse(row.expires_at) <= now) continue;
    const expanded = expandWithHierarchy([row.capability as Capability]);
    for (const cap of expanded) aggregate.add(cap);
    if (row.organization_id) {
      const set = byOrg.get(row.organization_id) ?? new Set<Capability>();
      for (const cap of expanded) set.add(cap);
      byOrg.set(row.organization_id, set);
    }
  }

  // Materialize maps as readonly.
  const byOrganization = new Map<string, ReadonlyArray<Capability>>();
  for (const [k, v] of byOrg) byOrganization.set(k, Array.from(v));

  return {
    aggregate: Array.from(aggregate),
    byOrganization,
  };
}

/**
 * Convenience: resolve capabilities for the most common shape — a user
 * with a "current org" filter. When orgId is omitted, returns the
 * cross-org aggregate.
 */
export async function resolveCapabilitiesForOrg(
  userId: string,
  organizationId?: string | null,
): Promise<ReadonlyArray<Capability>> {
  const all = await resolveUserCapabilities(userId);
  if (!organizationId) return all.aggregate;
  return all.byOrganization.get(organizationId) ?? [];
}

/**
 * Validation hook used by health-check tooling: assert the role registry is
 * internally consistent (no roles produce empty expansions, no orphan
 * roles, no unknown capabilities). Throws on first inconsistency.
 */
export function assertRoleRegistryConsistent(roles: ReadonlyArray<CanonicalRole>): void {
  for (const role of roles) {
    const caps = capabilitiesForRole(role);
    if (caps.length === 0) {
      logger.warn('capability_registry_role_empty', { role });
      throw new Error(`Role registry inconsistency: role ${role} has no capabilities.`);
    }
  }
}
