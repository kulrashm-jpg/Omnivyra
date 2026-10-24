/** Part of super-admin users API (Agent-B split — backend module, not a route). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { Role, ALL_ROLES } from '../../services/rbacService';
import { createAndSendInvitation } from '../../services/invitationService';
import { requireAdminRateLimit } from '../../services/requestAccessService';
import { withIdempotency } from '../../middleware/withIdempotency';
import { logger } from '../../services/logger';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { saveDomainRecord, reassignDomain } from '../../services/domainRecordService';
import { insertAuditLogStrict, SYSTEM_USER_ID } from '../../services/auditActorService';
import { logDomainUnverifiedUsageForCompany } from '../../services/domainVerificationService';
import { requireCapability } from '../../security/requireCapability';
import {
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_DELETE,
  SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';

export const ALLOWED_OVERRIDE_TYPES = ['no_website', 'domain_exception', 'manual_assignment'] as const;
export type OverrideType = typeof ALLOWED_OVERRIDE_TYPES[number];
export const isAllowedOverrideType = (value: unknown): value is OverrideType =>
  typeof value === 'string'
  && (ALLOWED_OVERRIDE_TYPES as readonly string[]).includes(value);

// Phase: Platform Authority Legacy Facade Elimination.
// Replaces the previous `requireSuperAdminUser` (Bearer-only DB-backed)
// access helper with the canonical capability gate. SUPER_ADMIN_DASHBOARD_VIEW
// is the platform-tier read capability — bridge principals satisfy this
// (compatibility) but cannot pass the inner mutation gates (which require
// IDENTITY_ADMIN_ASSIGN / IDENTITY_ADMIN_DELETE + step-up).
export const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<{ id: string; email: string | null } | null> => {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: `super-admin users (${req.method})`,
  });
  if (guard.ok !== true) return null;
  return { id: guard.principal.userId, email: guard.principal.email ?? null };
};

export const allowedRoles = ALL_ROLES.filter((role) => role !== Role.SUPER_ADMIN);
export const isAllowedRole = (value?: string | null) => {
  if (!value) return false;
  return (allowedRoles as readonly string[]).includes(value.toUpperCase());
};

/**
 * Find or create a users row by email.
 * Never calls supabase.auth — identity is established by Firebase on first sign-in.
 * Returns the internal users.id.
 *
 * Design note — schema resilience:
 *   Columns added by later migrations (is_deleted, is_email_verified, is_phone_verified)
 *   are checked / inserted conditionally so this function works regardless of which
 *   migrations have been applied to the live database.
 */
export const findOrCreateUserByEmail = async (email: string): Promise<{ id: string; error: string | null }> => {
  // 1. Look up by email — select only the stable primary-key column so the query
  //    never fails due to a missing column from a later migration.
  const { data: existing, error: selectErr } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (selectErr) {
    logger.error('super_admin_users_find_or_create_select_failed', { message: selectErr.message, email });
    return { id: '', error: selectErr.message };
  }

  if (existing) {
    const existingId = (existing as any).id as string;

    // Check soft-delete status — column added in migration 20260323_user_soft_delete.
    // If that migration hasn't been applied the query will return an error; we treat
    // the missing column as "not deleted" (safe: no rows can be soft-deleted yet).
    const { data: softRow, error: softErr } = await supabase
      .from('users')
      .select('is_deleted')
      .eq('id', existingId)
      .maybeSingle();

    if (!softErr && (softRow as any)?.is_deleted === true) {
      return { id: '', error: 'ACCOUNT_DELETED' };
    }

    return { id: existingId, error: null };
  }

  // 2. Create a stub row — supabase_uid and phone will be filled on first sign-in.
  //    Only include columns that we know exist (email, name, created_at are always
  //    present). is_email_verified / is_phone_verified were added by migration
  //    20260331_auth_columns with NOT NULL DEFAULT false, so we include them but
  //    fall back gracefully if PostgREST rejects them.
  const basePayload = {
    email,
    name:       email.split('@')[0] || 'User',
    created_at: new Date().toISOString(),
  };

  const { data: created, error: insertErr } = await supabase
    .from('users')
    .insert({ ...basePayload, is_email_verified: false, is_phone_verified: false })
    .select('id')
    .single();

  if (insertErr) {
    // 23505 = unique_violation — race: another request created the row first
    if (insertErr.code === '23505') {
      const { data: retry } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      if (retry) return { id: (retry as any).id, error: null };
    }

    // PGRST204 = column not found — is_email_verified / is_phone_verified not in schema yet.
    // Retry without them; the columns will be back-filled when the migration runs.
    if (
      insertErr.code === 'PGRST204' ||
      insertErr.message?.includes('is_email_verified') ||
      insertErr.message?.includes('is_phone_verified')
    ) {
      const { data: fb, error: fbErr } = await supabase
        .from('users')
        .insert(basePayload)
        .select('id')
        .single();

      if (fbErr) {
        if (fbErr.code === '23505') {
          const { data: retry2 } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .maybeSingle();
          if (retry2) return { id: (retry2 as any).id, error: null };
        }
        logger.error('super_admin_users_find_or_create_insert_fallback_failed', { message: fbErr.message, email });
        return { id: '', error: fbErr.message };
      }

      return { id: (fb as any).id, error: null };
    }

    logger.error('super_admin_users_find_or_create_insert_failed', { message: insertErr.message, code: insertErr.code, email });
    return { id: '', error: insertErr.message };
  }

  return { id: (created as any).id, error: null };
};

// Columns added by later migrations — included only when they exist.
// If PostgREST rejects them (PGRST204) we retry without them.
export const optionalRoleColumns = (extra: Record<string, unknown> = {}) => extra;

/**
 * Closure-015J (R-13) — re-inviting must never reset an ACTIVE member (this used
 * to "always reset status to 'invited'", which removed an active member's access).
 * Every membership row of the user in this company is read; an active row refuses
 * the invite (ALREADY_ACTIVE_MEMBER — role changes of active members go through the
 * governed PATCH). A non-active row (invited, expired, inactive) is re-invited as
 * before, by a conditional write on id + role + status as read: a concurrent
 * activation / role change in between makes it STALE_MEMBERSHIP. A SUPER_ADMIN row
 * is never rewritten (backstop for the route-level Closure-015I R-3 check).
 */
export const upsertUserCompanyRole = async (userId: string, companyId: string, role: string) => {
  const { data: existing, error: existingError } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId);
  if (existingError) {
    return { ok: false, error: existingError.message };
  }

  const now = new Date().toISOString();
  const rows = ((existing ?? []) as Array<{ id: string; role: string | null; status: string | null }>)
    .map((r) => ({ id: r.id, role: r.role, status: r.status }));
  if (rows.some((r) => String(r.role ?? '').trim().toUpperCase() === 'SUPER_ADMIN')) {
    return { ok: false, error: 'SUPER_ADMIN_MEMBERSHIP_NOT_CHANGEABLE_HERE' };
  }
  if (rows.some((r) => r.status === 'active')) {
    return { ok: false, error: 'ALREADY_ACTIVE_MEMBER' };
  }

  if (rows.length > 0) {
    const row = rows[0];
    // Re-invite a non-active (invited / expired / inactive) membership.
    const updatePayload = optionalRoleColumns({
      role,
      status:         'invited',
      updated_at:     now,
      // Optional columns — silently absent in older schema versions
      invited_at:     now,
      deactivated_at: null,
    });
    const conditional = (payload: Record<string, unknown>) => {
      let write = supabase.from('user_company_roles').update(payload).eq('id', row.id);
      write = row.role === null ? write.is('role', null) : write.eq('role', row.role);
      write = row.status === null ? write.is('status', null) : write.eq('status', row.status);
      return write.select('id');
    };

    let { data: written, error } = await conditional(updatePayload);

    if (error) {
      // PGRST204: a column in the payload doesn't exist yet — retry with minimal payload
      if (error.code === 'PGRST204' || error.message?.includes('invited_at') || error.message?.includes('deactivated_at')) {
        ({ data: written, error } = await conditional({ role, status: 'invited', updated_at: now }));
        if (error) return { ok: false, error: error.message };
      } else {
        return { ok: false, error: error.message };
      }
    }
    if (!written || written.length === 0) {
      return { ok: false, error: 'STALE_MEMBERSHIP' };
    }
    return { ok: true };
  }

  // No existing row — insert fresh
  const insertPayload = optionalRoleColumns({
    user_id:    userId,
    company_id: companyId,
    role,
    created_at: now,
    status:     'invited',
    updated_at: now,
    // Optional columns
    invited_at: now,
  });

  const { error } = await supabase.from('user_company_roles').insert(insertPayload);

  if (error) {
    if (error.code === 'PGRST204' || error.message?.includes('invited_at')) {
      const { error: retryErr } = await supabase.from('user_company_roles').insert({
        user_id:    userId,
        company_id: companyId,
        role,
        created_at: now,
        status:     'invited',
        updated_at: now,
      });
      if (retryErr) return { ok: false, error: retryErr.message };
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
};

export const insertAuditLog = async (input: {
  actorUserId: string | null;
  action: string;
  targetUserId?: string | null;
  companyId?: string | null;
  metadata?: Record<string, any>;
}) => {
  const { error } = await supabase.from('audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_user_id: input.targetUserId || null,
    company_id: input.companyId || null,
    metadata: input.metadata || null,
    created_at: new Date().toISOString(),
  });
  if (error) {
    logger.error('super_admin_users_audit_log_failed', {
      actorUserId: input.actorUserId,
      action: input.action,
      companyId: input.companyId,
      message: error.message,
    });
    throw new Error(`AUDIT_LOG_FAILED:${error.message}`);
  }
};
