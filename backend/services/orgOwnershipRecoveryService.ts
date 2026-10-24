/**
 * Org Ownership Recovery — canonical authority for repairing the four
 * orphan-organization classifications surfaced by `orphanOrgDetector`:
 *
 *   - HEADLESS              → promote an existing member to COMPANY_ADMIN
 *   - DELETED_OWNER         → promote a non-deleted member; or invite fresh
 *   - ABANDONED             → archive (or invite fresh + promote)
 *   - SUSPENDED_WITH_ACTIVITY → resume the company status (existing path)
 *
 * Repair operations are:
 *   - explicitly attributable    (every mutation records performedBy + reason)
 *   - safely replayable          (idempotent — repeat clicks produce one effect)
 *   - audit-grade                (every transition writes a security audit row)
 *   - tenant-validated           (operations on missing / inactive orgs reject)
 *   - role-invariant-preserving  (single-owner not a model; multi-COMPANY_ADMIN
 *                                 is allowed; we never demote during a promote)
 *
 * Out of scope (per phase spec):
 *   - rewriting org architecture / role enum
 *   - rewriting MFA architecture
 *   - touching unrelated admin domains
 *
 * Repairs route through this service; admin endpoints are thin wrappers.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import { cascadeDisableCompany } from './lifecycleGovernance';

const ADMIN_ROLES = new Set(['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN']);
const DEFAULT_DEMOTED_ROLE = 'CONTENT_CREATOR';
/** Closure-015J (R-7): non-admin tenant roles a transfer may demote the from-user to. */
const DEMOTABLE_ROLES = new Set(['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY']);
const isSuperAdminRole = (role: string | null | undefined): boolean =>
  String(role ?? '').trim().toUpperCase() === 'SUPER_ADMIN';

// ── Types ────────────────────────────────────────────────────────────────────

export type RecoveryReason =
  | 'NO_ORG'                  // companies row missing
  | 'ORG_INACTIVE'            // companies.status != 'active' (use resume flow)
  | 'NO_TARGET_USER'          // user not found
  | 'TARGET_USER_DELETED'     // users.is_deleted=true
  | 'NO_MEMBERSHIP'           // target user has no row in user_company_roles for this org
  | 'STALE_MEMBERSHIP'        // membership row exists but status != 'active'
  | 'NO_FROM_ROLE'            // transfer requires from-user to have an active admin role
  | 'NOT_ABANDONED'           // archive requires zero active members
  | 'ALREADY_ARCHIVED'        // archive is idempotent — second call is a no-op
  | 'CONFLICT'                // Closure-015J: the row changed between the read and the write
  | 'SUPER_ADMIN_MEMBERSHIP'  // Closure-015J: a SUPER_ADMIN membership is never changed by recovery flows
  | 'INVALID_DEMOTE_ROLE'     // Closure-015J: demoteToRole must be a non-admin tenant role
  | 'DB_ERROR';

export type PromoteResult =
  | { ok: true; previousRole: string | null; newRole: string; idempotent: boolean }
  | { ok: false; reason: RecoveryReason; detail?: string };

export type TransferResult =
  | { ok: true; demotedFromRole: string; promotedToRole: string; idempotent: boolean }
  | { ok: false; reason: RecoveryReason; detail?: string };

export type ArchiveResult =
  | { ok: true; previousStatus: string | null; idempotent: boolean }
  | { ok: false; reason: RecoveryReason; detail?: string };

// ── Internal helpers ─────────────────────────────────────────────────────────

interface OrgRow { id: string; status: string | null }
interface RoleRow { user_id: string; company_id: string; role: string | null; status: string | null }
interface UserRow { id: string; is_deleted: boolean | null }

async function fetchOrg(orgId: string): Promise<OrgRow | null> {
  const { data } = await ownedDbTable('companies')
    .select('id, status')
    .eq('id', orgId)
    .maybeSingle();
  return (data as OrgRow | null) ?? null;
}

async function fetchUser(userId: string): Promise<UserRow | null> {
  const { data } = await ownedDbTable('users')
    .select('id, is_deleted')
    .eq('id', userId)
    .maybeSingle();
  return (data as UserRow | null) ?? null;
}

async function fetchRole(orgId: string, userId: string): Promise<RoleRow | null> {
  const { data } = await ownedDbTable('user_company_roles')
    .select('user_id, company_id, role, status')
    .eq('user_id', userId)
    .eq('company_id', orgId)
    .maybeSingle();
  return (data as RoleRow | null) ?? null;
}

/**
 * Closure-015J (R-4): a lookup error is NOT zero members. It used to be
 * (`count ?? 0`), which made a populated org look abandoned and archivable.
 * Returns null on error so the caller fails closed.
 */
async function countActiveMembers(orgId: string): Promise<number | null> {
  const { count, error } = await ownedDbTable('user_company_roles')
    .select('user_id', { count: 'exact', head: true })
    .eq('company_id', orgId)
    .eq('status', 'active');
  if (error) return null;
  return count ?? 0;
}

/** Closure-015M (R-15): active SUPER_ADMIN memberships of the org; null on error (fail closed). */
async function countActiveSuperAdmins(orgId: string): Promise<number | null> {
  const { data, error } = await ownedDbTable('user_company_roles')
    .select('role')
    .eq('company_id', orgId)
    .eq('status', 'active');
  if (error) return null;
  return ((data ?? []) as Array<{ role: string | null }>).filter((r) => isSuperAdminRole(r.role)).length;
}

// ── Promote: HEADLESS / DELETED_OWNER repair ────────────────────────────────

/**
 * Promote an existing active member to COMPANY_ADMIN. Used for HEADLESS
 * orgs (members exist but no admin) and DELETED_OWNER orgs (only admins
 * are soft-deleted users).
 *
 * Idempotent: re-clicking the promotion when the user is already
 * COMPANY_ADMIN returns `ok=true, idempotent=true` without mutating.
 */
export async function promoteMemberToAdmin(input: {
  orgId: string;
  userId: string;
  performedBy: string;
  reason: string;
}): Promise<PromoteResult> {
  const org = await fetchOrg(input.orgId);
  if (!org) return { ok: false, reason: 'NO_ORG' };
  if (org.status !== 'active') return { ok: false, reason: 'ORG_INACTIVE' };

  const user = await fetchUser(input.userId);
  if (!user) return { ok: false, reason: 'NO_TARGET_USER' };
  if (user.is_deleted) return { ok: false, reason: 'TARGET_USER_DELETED' };

  const existing = await fetchRole(input.orgId, input.userId);
  if (!existing) return { ok: false, reason: 'NO_MEMBERSHIP' };
  if (existing.status !== 'active') return { ok: false, reason: 'STALE_MEMBERSHIP' };

  const previousRole = existing.role;
  if (previousRole && ADMIN_ROLES.has(previousRole)) {
    // Idempotent — already an admin. No mutation.
    void logSecurityEvent({
      capability:      'identity.admin.assign',
      decision:        'allowed',
      actorUserId:     input.performedBy,
      principalUserId: input.userId,
      resourceId:      input.orgId,
      reason:          `promote_member_to_admin idempotent role=${previousRole} reason=${input.reason}`,
    });
    return { ok: true, previousRole, newRole: previousRole, idempotent: true };
  }

  const { error } = await ownedDbTable('user_company_roles')
    .update({ role: 'COMPANY_ADMIN', updated_at: new Date().toISOString() })
    .eq('user_id', input.userId)
    .eq('company_id', input.orgId);

  if (error) {
    logger.error('org_recovery_promote_failed', {
      orgId: input.orgId,
      userId: input.userId,
      message: error.message,
    });
    return { ok: false, reason: 'DB_ERROR', detail: error.message };
  }

  void logSecurityEvent({
    capability:      'identity_admin.assign',
    decision:        'allowed',
    actorUserId:     input.performedBy,
    principalUserId: input.userId,
    resourceId:      input.orgId,
    reason:          `promote_member_to_admin from=${previousRole} to=COMPANY_ADMIN reason=${input.reason}`,
  });

  return { ok: true, previousRole, newRole: 'COMPANY_ADMIN', idempotent: false };
}

// ── Transfer: explicit owner → owner handoff ────────────────────────────────

/**
 * Transfer admin ownership from one user to another. Both users must be
 * active members of the org. The from-user is demoted to a non-admin
 * role so the operation is symmetric — for promote-only without demote,
 * use `promoteMemberToAdmin`.
 *
 * Idempotent: a re-click after a successful transfer (toUser already
 * COMPANY_ADMIN, fromUser already non-admin) returns `idempotent=true`.
 *
 * Does NOT enforce single-owner — multi-COMPANY_ADMIN is allowed by the
 * data model. The demotion side ensures the from-user no longer holds
 * admin even if the to-user already does.
 */
export async function transferOwnership(input: {
  orgId: string;
  fromUserId: string;
  toUserId: string;
  performedBy: string;
  reason: string;
  /** Role to demote the from-user to. Default: CONTENT_CREATOR. */
  demoteToRole?: string;
}): Promise<TransferResult> {
  if (input.fromUserId === input.toUserId) {
    return { ok: false, reason: 'NO_FROM_ROLE', detail: 'fromUser and toUser must differ' };
  }

  const org = await fetchOrg(input.orgId);
  if (!org) return { ok: false, reason: 'NO_ORG' };
  if (org.status !== 'active') return { ok: false, reason: 'ORG_INACTIVE' };

  const [fromUser, toUser, fromRole, toRole] = await Promise.all([
    fetchUser(input.fromUserId),
    fetchUser(input.toUserId),
    fetchRole(input.orgId, input.fromUserId),
    fetchRole(input.orgId, input.toUserId),
  ]);

  if (!toUser) return { ok: false, reason: 'NO_TARGET_USER' };
  if (toUser.is_deleted) return { ok: false, reason: 'TARGET_USER_DELETED' };
  if (!toRole) return { ok: false, reason: 'NO_MEMBERSHIP' };
  if (toRole.status !== 'active') return { ok: false, reason: 'STALE_MEMBERSHIP' };

  // The from-user must currently hold an active admin role for the
  // operation to be a "transfer". Without an active admin row to
  // demote, use `promoteMemberToAdmin` instead.
  if (!fromUser || !fromRole || fromRole.status !== 'active' || !fromRole.role || !ADMIN_ROLES.has(fromRole.role)) {
    return { ok: false, reason: 'NO_FROM_ROLE' };
  }

  // Closure-015J (R-7): ownership transfer never demotes or overwrites platform
  // super-admin authority — on either side. A SUPER_ADMIN membership is changed only
  // by the governed revoke / downgrade flow (identity.admin.revoke); revoke first,
  // then transfer.
  if (isSuperAdminRole(fromRole.role) || isSuperAdminRole(toRole.role)) {
    return { ok: false, reason: 'SUPER_ADMIN_MEMBERSHIP', detail: 'revoke platform super-admin authority through the governed flow first' };
  }

  // Closure-015J (R-7): the documented contract is a demotion to a NON-admin role;
  // demoteToRole was taken from the request unvalidated (it could even be SUPER_ADMIN).
  const requestedDemote = input.demoteToRole && input.demoteToRole.trim().length > 0
    ? input.demoteToRole.trim().toUpperCase()
    : DEFAULT_DEMOTED_ROLE;
  if (!DEMOTABLE_ROLES.has(requestedDemote)) {
    return { ok: false, reason: 'INVALID_DEMOTE_ROLE', detail: `demoteToRole must be one of ${[...DEMOTABLE_ROLES].join(', ')}` };
  }
  const targetDemotedRole = requestedDemote;

  const toIsAdmin = !!toRole.role && ADMIN_ROLES.has(toRole.role);
  const fromIsTargetDemoted = fromRole.role === targetDemotedRole;
  if (toIsAdmin && fromIsTargetDemoted) {
    void logSecurityEvent({
      capability:      'identity.admin.assign',
      decision:        'allowed',
      actorUserId:     input.performedBy,
      principalUserId: input.toUserId,
      resourceId:      input.orgId,
      reason:          `transfer_ownership idempotent from=${input.fromUserId} to=${input.toUserId} reason=${input.reason}`,
    });
    return {
      ok: true,
      demotedFromRole: fromRole.role,
      promotedToRole: toRole.role!,
      idempotent: true,
    };
  }

  // Promote target first; if anything fails afterwards, the org never
  // becomes admin-less. Then demote the from-user.
  // Closure-015J (R-7): both writes are conditional on the role + active status
  // read above (snapshotted), so a concurrent change — e.g. a governed promotion
  // to SUPER_ADMIN in between — is never overwritten: it surfaces as CONFLICT.
  const fromRoleAtRead: string = fromRole.role;
  const toRoleAtRead: string = toRole.role ?? '';
  const promotedAt = new Date().toISOString();
  let promote = ownedDbTable('user_company_roles')
    .update({ role: 'COMPANY_ADMIN', updated_at: promotedAt })
    .eq('user_id', input.toUserId)
    .eq('company_id', input.orgId)
    .eq('status', 'active');
  promote = toRole.role === null ? promote.is('role', null) : promote.eq('role', toRoleAtRead);
  const { data: promoted, error: promoteErr } = await promote.select('user_id');

  if (promoteErr) {
    logger.error('org_recovery_transfer_promote_failed', {
      orgId: input.orgId, toUserId: input.toUserId, message: promoteErr.message,
    });
    return { ok: false, reason: 'DB_ERROR', detail: promoteErr.message };
  }
  if (!promoted || (promoted as unknown[]).length === 0) {
    return { ok: false, reason: 'CONFLICT', detail: 'target membership changed concurrently; nothing was changed' };
  }

  const { data: demoted, error: demoteErr } = await ownedDbTable('user_company_roles')
    .update({ role: targetDemotedRole, updated_at: promotedAt })
    .eq('user_id', input.fromUserId)
    .eq('company_id', input.orgId)
    .eq('status', 'active')
    .eq('role', fromRoleAtRead)
    .select('user_id');

  if (demoteErr) {
    // Promotion succeeded; demotion failed. The org now has at least
    // the new admin AND the old admin still active — safe state, not
    // headless. Surface as DB_ERROR so the operator can retry.
    logger.error('org_recovery_transfer_demote_failed', {
      orgId: input.orgId, fromUserId: input.fromUserId, message: demoteErr.message,
    });
    return { ok: false, reason: 'DB_ERROR', detail: demoteErr.message };
  }
  if (!demoted || (demoted as unknown[]).length === 0) {
    // Promotion succeeded; the from-user's row changed in between and was left
    // as is — the safe two-admin state, as with a demotion failure.
    return { ok: false, reason: 'CONFLICT', detail: 'from-user membership changed concurrently; target was promoted, from-user unchanged' };
  }

  void logSecurityEvent({
    capability:      'identity_admin.assign',
    decision:        'allowed',
    actorUserId:     input.performedBy,
    principalUserId: input.toUserId,
    resourceId:      input.orgId,
    reason:          `transfer_ownership from=${input.fromUserId}:${fromRoleAtRead} to=${input.toUserId}:COMPANY_ADMIN demoted_to=${targetDemotedRole} reason=${input.reason}`,
  });

  return {
    ok: true,
    demotedFromRole: fromRoleAtRead,
    promotedToRole: 'COMPANY_ADMIN',
    idempotent: false,
  };
}

// ── Archive: ABANDONED soft-delete ──────────────────────────────────────────

/**
 * Soft-archive an abandoned org (zero active members). Idempotent: a
 * second click against an already-archived org returns idempotent=true.
 * Pass `force=true` to override the zero-members invariant — used when
 * an operator has decided to archive a low-activity tenant regardless.
 */
export async function archiveAbandonedOrg(input: {
  orgId: string;
  performedBy: string;
  reason: string;
  force?: boolean;
}): Promise<ArchiveResult> {
  const org = await fetchOrg(input.orgId);
  if (!org) return { ok: false, reason: 'NO_ORG' };

  // Closure-015M (R-15): 'archived' is not a company lifecycle state. The schema
  // (companies_status_check: active | inactive | suspended; migrations
  // 20260640 / 20260642) defines companies.status as the reversible operational
  // flag and deleted_at as the soft-delete tombstone, so the former
  // UPDATE … status = 'archived' failed the CHECK on every call (verified on a
  // throwaway Postgres). Archiving an abandoned org is now the established,
  // reversible DISABLE: status 'inactive' through disable_company_cascade (the
  // same atomic path as PATCH /api/super-admin/companies; restore = re-enable).
  if (org.status === 'inactive') {
    void logSecurityEvent({
      capability:      'organization.delete',
      decision:        'allowed',
      actorUserId:     input.performedBy,
      principalUserId: null,
      resourceId:      input.orgId,
      reason:          `archive_abandoned_org idempotent reason=${input.reason}`,
    });
    return { ok: true, previousStatus: org.status, idempotent: true };
  }

  if (!input.force) {
    const activeCount = await countActiveMembers(input.orgId);
    if (activeCount === null) {
      return { ok: false, reason: 'DB_ERROR', detail: 'active member count unavailable' };
    }
    if (activeCount > 0) {
      return { ok: false, reason: 'NOT_ABANDONED', detail: `active_members=${activeCount}` };
    }
  }

  // Closure-015M (R-15): the disable cascade deactivates every active membership,
  // so — exactly like the disable route (Closure-015L) — an ACTIVE SUPER_ADMIN
  // membership refuses the archive (force included). Application check; the
  // database guard (proposal 01) is the concurrency boundary inside the RPC.
  const superAdmins = await countActiveSuperAdmins(input.orgId);
  if (superAdmins === null) {
    return { ok: false, reason: 'DB_ERROR', detail: 'super-admin membership lookup unavailable' };
  }
  if (superAdmins > 0) {
    return { ok: false, reason: 'SUPER_ADMIN_MEMBERSHIP', detail: 'revoke platform super-admin authority through the governed flow first' };
  }

  const statusAtRead = org.status;
  try {
    await cascadeDisableCompany(input.orgId, input.performedBy, `archive_abandoned:${input.reason}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('COMPANY_HOLDS_SUPER_ADMIN_MEMBERSHIP')) {
      return { ok: false, reason: 'SUPER_ADMIN_MEMBERSHIP', detail: 'refused by the database guard' };
    }
    logger.error('org_recovery_archive_failed', { orgId: input.orgId, message });
    return { ok: false, reason: 'DB_ERROR', detail: message };
  }

  void logSecurityEvent({
    capability:      'organization.delete',
    decision:        'allowed',
    actorUserId:     input.performedBy,
    principalUserId: null,
    resourceId:      input.orgId,
    reason:          `archive_abandoned_org from=${statusAtRead} to=inactive force=${!!input.force} reason=${input.reason}`,
  });

  return { ok: true, previousStatus: statusAtRead, idempotent: false };
}
