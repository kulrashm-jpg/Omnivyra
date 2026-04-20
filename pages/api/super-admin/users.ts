import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { Role, ALL_ROLES } from '../../../backend/services/rbacService';
import { createAndSendInvitation } from '../../../backend/services/invitationService';
import { requireAdminRateLimit, requireSuperAdminUser } from '../../../backend/services/requestAccessService';
import { withIdempotency } from '../../../backend/middleware/withIdempotency';
import { logger } from '../../../backend/services/logger';
import { logAuthEvent } from '../../../lib/auth/auditLog';

const requireSuperAdminAccess = async (
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> => {
  return !!(await requireSuperAdminUser(req, res));
};

const allowedRoles = ALL_ROLES.filter((role) => role !== Role.SUPER_ADMIN);
const isAllowedRole = (value?: string | null) => {
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
const findOrCreateUserByEmail = async (email: string): Promise<{ id: string; error: string | null }> => {
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

  // 2. Create a stub row — firebase_uid and phone will be filled on first sign-in.
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
const optionalRoleColumns = (extra: Record<string, unknown> = {}) => extra;

const upsertUserCompanyRole = async (userId: string, companyId: string, role: string) => {
  const { data: existing } = await supabase
    .from('user_company_roles')
    .select('id, role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);

  const now = new Date().toISOString();

  if (existing && existing.length > 0) {
    const row = existing[0];
    // Always reset status to 'invited' — covers re-inviting a deactivated user
    // as well as changing role on an already-active user.
    const updatePayload = optionalRoleColumns({
      role,
      status:         'invited',
      updated_at:     now,
      // Optional columns — silently absent in older schema versions
      invited_at:     now,
      deactivated_at: null,
    });

    const { error } = await supabase
      .from('user_company_roles')
      .update(updatePayload)
      .eq('id', row.id);

    if (error) {
      // PGRST204: a column in the payload doesn't exist yet — retry with minimal payload
      if (error.code === 'PGRST204' || error.message?.includes('invited_at') || error.message?.includes('deactivated_at')) {
        const { error: retryErr } = await supabase
          .from('user_company_roles')
          .update({ role, status: 'invited', updated_at: now })
          .eq('id', row.id);
        if (retryErr) return { ok: false, error: retryErr.message };
        return { ok: true };
      }
      return { ok: false, error: error.message };
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

const insertAuditLog = async (input: {
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:users', 30, 60))) return;
  if (!(await requireSuperAdminAccess(req, res))) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_company_roles')
      .select('user_id, role, company_id, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('super_admin_users_list_failed', { message: error.message });
      return res.status(500).json({
        error: 'FAILED_TO_LIST_USERS',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }

    const rows = data || [];
    const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));

    const [usersResult, companiesResult, profilesResult] = await Promise.all([
      supabase.from('users').select('id, email, created_at').eq('is_deleted', false),
      companyIds.length > 0
        ? supabase.from('companies').select('id, name').in('id', companyIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length > 0
        ? supabase.from('company_profiles').select('company_id, name').in('company_id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usersResult.error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_USERS', details: usersResult.error.message });
    }
    if (companiesResult.error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_COMPANIES', details: companiesResult.error.message });
    }

    // No Supabase auth.admin.listUsers() fallback — users table is the authoritative source
    const authFallbackUsers: Array<{ id: string; email: string; created_at?: string | null }> = [];

    const emailByUserId = [...(usersResult.data || []), ...authFallbackUsers].reduce<Record<string, string>>(
      (acc, user) => {
        acc[user.id] = user.email || '';
        return acc;
      },
      {}
    );
    const nameByCompanyId = (companiesResult.data || []).reduce<Record<string, string>>((acc, company) => {
      acc[company.id] = company.name || '';
      return acc;
    }, {});
    if (profilesResult.data) {
      profilesResult.data.forEach((profile) => {
        if (profile.company_id && !nameByCompanyId[profile.company_id]) {
          nameByCompanyId[profile.company_id] = profile.name || '';
        }
      });
    }

    const usersFromRoles = rows.map((row) => ({
      user_id: row.user_id,
      email: emailByUserId[row.user_id] || '',
      role: row.role,
      status: row.status || null,
      company_id: row.company_id,
      company_name: nameByCompanyId[row.company_id] || '',
      created_at: row.created_at,
    }));

    const roleUserIds = new Set(usersFromRoles.map((row) => row.user_id));
    const standaloneUsers = [...(usersResult.data || []), ...authFallbackUsers]
      .filter((user) => user.id && !roleUserIds.has(user.id))
      .map((user) => ({
        user_id: user.id,
        email: user.email || '',
        role: 'UNASSIGNED',
        status: null,
        company_id: null,
        company_name: '',
        created_at: user.created_at || null,
      }));

    const users = [...usersFromRoles, ...standaloneUsers].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );

    return res.status(200).json({ users });
  }

  if (req.method === 'POST') {
    try {
      const { email, companyId, role } = req.body || {};
      // Validate required parameters
      if (!email) {
        return res.status(400).json({ 
          error: 'MISSING_REQUIRED_PARAMETER',
          details: 'email is required to invite a user',
          required_fields: ['email', 'companyId']
        });
      }
      if (!companyId) {
        return res.status(400).json({ 
          error: 'MISSING_REQUIRED_PARAMETER',
          details: 'companyId is required to invite a user',
          required_fields: ['email', 'companyId']
        });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const desiredRole = String(role || Role.COMPANY_ADMIN).toUpperCase();
      if (!isAllowedRole(desiredRole)) {
        return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
      }

      // 0. Validate that the target company actually exists.
      //    A missing companies row means the company was never properly created
      //    (dangling company_profiles artefact) — assigning a role to it would
      //    create an orphaned role that breaks the user's onboarding.
      const { data: companyRow, error: companyCheckErr } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle();
      if (companyCheckErr) {
        return res.status(500).json({ error: 'FAILED_TO_VALIDATE_COMPANY', details: companyCheckErr.message });
      }
      if (!companyRow) {
        return res.status(404).json({ error: 'COMPANY_NOT_FOUND', details: `Company ${companyId} does not exist. The company must be created first before users can be assigned to it.` });
      }

      // 1. Find or create user row by email (no Supabase auth.admin)
      const { id: userId, error: userErr } = await findOrCreateUserByEmail(normalizedEmail);
      if (userErr === 'ACCOUNT_DELETED') {
        return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
      }
      if (userErr || !userId) {
        return res.status(500).json({ error: 'FAILED_TO_SAVE_USER', details: userErr });
      }
      // 2. Create/update company role
      const roleResult = await upsertUserCompanyRole(userId, companyId, desiredRole);
      if (!roleResult.ok) {
        return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: roleResult.error });
      }

      const invitation = await createAndSendInvitation({
        email: normalizedEmail,
        companyId,
        role: desiredRole,
        invitedBy: null,
        idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
      });

      await insertAuditLog({
        actorUserId: null,
        action: 'SUPER_ADMIN_INVITE',
        targetUserId: userId,
        companyId,
        metadata: { role: desiredRole, invitationId: invitation.id },
      });

      return res.status(201).json({
        user: {
          id: userId,
          email: normalizedEmail,
          company_id: companyId,
          role: desiredRole,
        },
      });
    } catch (error: any) {
      logger.error('super_admin_users_post_failed', { message: error?.message || String(error) });
      return res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        details: error?.message || String(error),
      });
    }
  }

  if (req.method === 'PATCH') {
    const { userId, companyId, status, role } = req.body || {};
    
    // Validate required parameters
    if (!userId) {
      return res.status(400).json({ 
        error: 'MISSING_REQUIRED_PARAMETER',
        details: 'userId is required to update a user',
        required_fields: ['userId', 'companyId']
      });
    }
    if (!companyId) {
      return res.status(400).json({ 
        error: 'MISSING_REQUIRED_PARAMETER',
        details: 'companyId is required to update a user',
        required_fields: ['userId', 'companyId']
      });
    }
    if (!status && !role) {
      return res.status(400).json({ 
        error: 'MISSING_UPDATE_FIELDS',
        details: 'Either status or role must be provided',
        acceptable_fields: ['status', 'role']
      });
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    let normalizedStatus: string | null = null;
    if (status) {
      normalizedStatus = String(status);
      if (!['active', 'inactive'].includes(normalizedStatus)) {
        return res.status(400).json({ error: 'INVALID_STATUS' });
      }
      updatePayload.status = normalizedStatus;
      if (normalizedStatus === 'inactive') {
        updatePayload.deactivated_at = new Date().toISOString();
      } else {
        updatePayload.deactivated_at = null;
      }
    }
    if (role) {
      const normalizedRole = String(role).toUpperCase();
      if (!isAllowedRole(normalizedRole)) {
        return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
      }
      updatePayload.role = normalizedRole;
    }

    const { data, error } = await supabase
      .from('user_company_roles')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .select('user_id, company_id, status, role')
      .maybeSingle();

    if (error) {
      logger.error('super_admin_users_patch_failed', { userId, companyId, message: error.message });
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_USER', details: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', details: `No role record found for user ${userId} in company ${companyId}` });
    }

    await insertAuditLog({
      actorUserId: null,
      action: 'SUPER_ADMIN_USER_UPDATE',
      targetUserId: userId,
      companyId,
      metadata: {
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(updatePayload.role ? { role: updatePayload.role } : {}),
      },
    });
    if (updatePayload.role) {
      void logAuthEvent('role_changed', {
        userId,
        metadata: { new_role: updatePayload.role, company_id: companyId, changed_by: 'super_admin' },
      });
    }

    return res.status(200).json({ user: data });
  }

  if (req.method === 'DELETE') {
    const { userId, companyId } = req.body || {};
    // Validate required parameter
    if (!userId) {
      return res.status(400).json({ 
        error: 'MISSING_REQUIRED_PARAMETER',
        details: 'userId is required to delete a user',
      });
    }

    // Route 1: Delete user from specific company
    if (companyId) {
      const { data, error } = await supabase
        .from('user_company_roles')
        .delete()
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .select('user_id, company_id');

      if (error) {
        logger.error('super_admin_users_delete_company_failed', { userId, companyId, message: error.message });
        return res.status(500).json({ 
          error: 'FAILED_TO_DELETE_USER',
          details: error.message
        });
      }
      
      if (!data || data.length === 0) {
        return res.status(404).json({ 
          error: 'USER_NOT_FOUND',
          details: `No user record found for userId: ${userId} in companyId: ${companyId}`,
        });
      }

      await insertAuditLog({
        actorUserId: null,
        action: 'SUPER_ADMIN_USER_DELETE',
        targetUserId: userId,
        companyId,
      });

      return res.status(200).json({ success: true, message: 'User removed from company' });
    }

    // Route 2: Delete unassigned user entirely from the system.
    // Order of operations is critical for consistency:
    //   1. Look up firebase_uid from DB
    //   2. Delete from Firebase Auth first (abort if it fails — prevents ghost sessions)
    //   3. Delete from users table
    try {
      // Step A: look up the user row to get firebase_uid
      const { data: userRecord, error: lookupError } = await supabase
        .from('users')
        .select('id, supabase_uid, firebase_uid')
        .eq('id', userId)
        .maybeSingle();

      if (lookupError) {
        logger.error('super_admin_users_delete_lookup_failed', { userId, message: lookupError.message });
        return res.status(500).json({ error: 'FAILED_TO_DELETE_USER', details: lookupError.message });
      }

      // Only use supabase_uid — firebase_uid is a legacy column and cannot be used
      // with supabase.auth.admin.deleteUser(). Using it would cause a silent 404 or error.
      const supabaseUid: string | null = (userRecord as any)?.supabase_uid ?? null;

      // Step B: delete from Supabase Auth.
      //   Removes the auth account entirely so the user cannot sign in.
      //   Tolerates user-not-found (idempotent — already gone).
      if (supabaseUid) {
        try {
          const { error: authError } = await supabase.auth.admin.deleteUser(supabaseUid);
          if (authError && !authError.message?.includes('not found')) {
            logger.error('super_admin_users_delete_auth_failed', { userId, supabaseUid, message: authError.message });
            return res.status(500).json({
              error: 'FAILED_TO_DELETE_FROM_AUTH',
              details: authError.message,
            });
          }
        } catch (authError: any) {
          logger.error('super_admin_users_delete_auth_exception', { userId, supabaseUid, message: authError.message });
          return res.status(500).json({
            error: 'FAILED_TO_DELETE_FROM_AUTH',
            details: authError.message,
          });
        }
      }

      // Step C: soft-delete the users row (preserves audit trail, blocks re-signup)
      const now = new Date().toISOString();
      const { data: userData, error: userError } = await supabase
        .from('users')
        .update({ is_deleted: true, deleted_at: now })
        .eq('id', userId)
        .select('id');

      const updatedInTable = !userError && userData && userData.length > 0;
      if (userError) {
        // CRITICAL: Supabase Auth user was deleted but the DB soft-delete failed.
        // The user cannot sign in (auth account gone), but the DB row still appears active.
        // This row must be manually soft-deleted to restore data consistency.
        logger.error('super_admin_users_delete_soft_delete_failed', {
          userId,
          supabaseUid,
          message: userError.message,
          action: `Manual fix: UPDATE users SET is_deleted=true, deleted_at=now() WHERE id='${userId}'`,
        });
        return res.status(500).json({ error: 'FAILED_TO_DELETE_USER', details: userError.message });
      }

      if (!updatedInTable && !supabaseUid) {
        return res.status(404).json({
          error: 'USER_NOT_FOUND',
          details: `User ${userId} not found in users table or Supabase Auth`,
        });
      }

      // Step D: deactivate all company roles so the user loses access to every company
      const { error: rolesError } = await supabase
        .from('user_company_roles')
        .update({ status: 'inactive', deactivated_at: now, updated_at: now })
        .eq('user_id', userId);

      if (rolesError) {
        // Non-fatal: auth + users row are already handled; log and continue.
        logger.error('super_admin_users_delete_role_deactivate_failed', { userId, message: rolesError.message });
        return res.status(500).json({ error: 'FAILED_TO_DEACTIVATE_USER_ROLES', details: rolesError.message });
      }

      await insertAuditLog({
        actorUserId: null,
        action: 'SUPER_ADMIN_USER_DELETE_UNASSIGNED',
        targetUserId: userId,
      });
      void logAuthEvent('user_deleted', {
        userId,
        metadata: { deleted_by: 'super_admin', supabase_uid: supabaseUid },
      });

      return res.status(200).json({ success: true, message: 'User deleted from system' });
    } catch (err: any) {
      logger.error('super_admin_users_delete_unassigned_failed', { userId, message: err.message });
      return res.status(500).json({
        error: 'FAILED_TO_DELETE_UNASSIGNED_USER',
        details: err.message,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withIdempotency(handler, { scope: 'super-admin-users', methods: ['POST', 'PATCH', 'DELETE'] });
