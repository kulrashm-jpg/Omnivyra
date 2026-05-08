/**
 * Orphan Organization Detector
 *
 * Surfaces tenant states that today require manual SQL to repair:
 *
 *   1. HEADLESS — the company has at least one active member, but no
 *      active member with COMPANY_ADMIN / SUPER_ADMIN / ADMIN role.
 *      Dangerous: the org cannot be administered. Customer Success
 *      cannot help users in this state without operator intervention.
 *
 *   2. ABANDONED — the company has zero active members. Either every
 *      member was deleted or every membership row was set to
 *      status='inactive' / 'deactivated'. The org is invisible to all
 *      users; data is silently inaccessible.
 *
 *   3. DELETED_OWNER — every active admin's `users` row has
 *      `is_deleted=true`. Edge of HEADLESS — useful as a separate
 *      classification for support triage.
 *
 *   4. SUSPENDED_WITH_ACTIVITY — companies.status != 'active' but the
 *      org still has scheduled work (active campaigns, scheduled posts,
 *      etc.). Means a tenant was suspended but the suspension didn't
 *      clean up its in-flight pipeline. Today only flagged via the
 *      lightest probe (any active campaign).
 *
 * Read-only by design. Repair is operator-driven and tracked separately.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';

export type OrphanOrgClassification =
  | 'HEADLESS'
  | 'ABANDONED'
  | 'DELETED_OWNER'
  | 'SUSPENDED_WITH_ACTIVITY';

export interface OrphanOrgEntry {
  organizationId: string;
  organizationName: string | null;
  status: string | null;
  classifications: ReadonlyArray<OrphanOrgClassification>;
  /** Active member count (status='active' rows in user_company_roles). */
  activeMemberCount: number;
  /** Active admin count (active members with admin-class role). */
  activeAdminCount: number;
  /** Soft-deleted member count among the admins. */
  deletedAdminCount: number;
  /** Has at least one active campaign. Cheap probe; not exhaustive. */
  hasActiveCampaigns: boolean;
}

const ADMIN_ROLES = new Set(['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN']);

interface CompanyRow {
  id: string;
  name: string | null;
  status: string | null;
}

interface RoleRow {
  company_id: string | null;
  user_id: string | null;
  role: string | null;
  status: string | null;
}

interface UserRow {
  id: string;
  is_deleted: boolean | null;
}

interface CampaignRow {
  company_id: string | null;
}

export interface DetectOrphansInput {
  /** Cap on companies scanned per run. Default: 1000. */
  limit?: number;
}

export async function detectOrphans(input: DetectOrphansInput = {}): Promise<OrphanOrgEntry[]> {
  const limit = input.limit ?? 1000;

  // Pull every company in scope (active + suspended). We classify both —
  // an active company can be HEADLESS; a suspended one can have
  // SUSPENDED_WITH_ACTIVITY.
  const { data: companies, error: cErr } = await ownedDbTable('companies')
    .select('id, name, status')
    .limit(limit);

  if (cErr) {
    logger.error('orphan_detector_company_query_failed', { message: cErr.message });
    throw new Error(`orphan_detector_company_query_failed: ${cErr.message}`);
  }
  if (!companies || companies.length === 0) return [];

  const orgIds = (companies as CompanyRow[]).map((c) => c.id);

  // One query for every active membership across these orgs.
  const { data: roles } = await ownedDbTable('user_company_roles')
    .select('company_id, user_id, role, status')
    .in('company_id', orgIds)
    .eq('status', 'active');

  const roleRows = (roles ?? []) as RoleRow[];

  // Resolve admin user_ids to check for soft-deletion.
  const adminUserIds = Array.from(
    new Set(
      roleRows
        .filter((r) => r.user_id && r.role && ADMIN_ROLES.has(r.role))
        .map((r) => r.user_id as string),
    ),
  );

  let deletedUserIds = new Set<string>();
  if (adminUserIds.length > 0) {
    const { data: users } = await ownedDbTable('users')
      .select('id, is_deleted')
      .in('id', adminUserIds);
    deletedUserIds = new Set(
      ((users ?? []) as UserRow[])
        .filter((u) => !!u.is_deleted)
        .map((u) => u.id),
    );
  }

  // Cheap activity probe: any active campaign per org. Used only for
  // SUSPENDED_WITH_ACTIVITY classification.
  const { data: campaigns } = await ownedDbTable('campaigns')
    .select('company_id')
    .in('company_id', orgIds)
    .in('status', ['active', 'execution_ready', 'scheduled']);

  const orgsWithActiveCampaigns = new Set(
    ((campaigns ?? []) as CampaignRow[])
      .map((c) => c.company_id)
      .filter((id): id is string => !!id),
  );

  // Build the classification per org.
  const out: OrphanOrgEntry[] = [];
  for (const org of companies as CompanyRow[]) {
    const orgRoles = roleRows.filter((r) => r.company_id === org.id);
    const adminRoles = orgRoles.filter((r) => r.role && ADMIN_ROLES.has(r.role));
    const adminUserIdsForOrg = adminRoles
      .map((r) => r.user_id)
      .filter((id): id is string => !!id);
    const deletedAdmins = adminUserIdsForOrg.filter((id) => deletedUserIds.has(id));

    const activeMemberCount = orgRoles.length;
    const activeAdminCount  = adminRoles.length;
    const deletedAdminCount = deletedAdmins.length;
    const hasActiveCampaigns = orgsWithActiveCampaigns.has(org.id);

    const classifications: OrphanOrgClassification[] = [];

    if (activeMemberCount === 0) {
      classifications.push('ABANDONED');
    } else if (activeAdminCount === 0) {
      classifications.push('HEADLESS');
    } else if (deletedAdminCount === activeAdminCount) {
      classifications.push('DELETED_OWNER');
    }

    if (org.status !== 'active' && hasActiveCampaigns) {
      classifications.push('SUSPENDED_WITH_ACTIVITY');
    }

    if (classifications.length === 0) continue;

    out.push({
      organizationId:    org.id,
      organizationName:  org.name,
      status:            org.status,
      classifications,
      activeMemberCount,
      activeAdminCount,
      deletedAdminCount,
      hasActiveCampaigns,
    });
  }

  return out;
}
