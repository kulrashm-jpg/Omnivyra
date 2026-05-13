/**
 * POST /api/super-admin/users/[id]/force-logout
 *
 * Phase 2.B — invalidate every active session for a user without
 * suspending or deleting them. Useful for compromise response: the user
 * can re-authenticate normally afterwards (their account is still active).
 *
 * Effect:
 *   - users.session_revoked_after = NOW()  (JWT epoch bump)
 *   - auth_sessions: every live row → revoked_at = NOW()
 *   - Supabase admin signOut(user, scope='global')  (refresh tokens cleared)
 *
 * users.status is NOT modified. The user can sign in again immediately.
 *
 * Extension sessions: the in-memory ExtensionAuthService validates
 * users.session_revoked_after on every validateSession call, so the
 * extension drops the stale session at the next request even though
 * we cannot reach across processes to clear its in-memory Map directly.
 *
 * Auth: requireCapability(IDENTITY_ADMIN_ASSIGN) — phishing-resistant +
 * trusted-device step-up required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { supabase } from '../../../../../backend/db/supabaseClient';
import { logger } from '../../../../../backend/services/logger';
import { requireAdminRateLimit } from '../../../../../backend/services/requestAccessService';
import { requireCapability } from '../../../../../backend/security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../../shared/contracts/security';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../../../backend/services/auditActorService';
import { logAuthEvent } from '../../../../../lib/auth/auditLog';
import { invalidateUserSessionsAndSignOut } from '../../../../../backend/services/lifecycleGovernance';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:users:force-logout', 30, 60))) return;

  const userId = String(req.query.id || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'MISSING_USER_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `super-admin force-logs-out user ${userId}`,
    resourceId: userId,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as {
    reason?: string;
  };
  const reasonRaw = String(body.reason ?? '').trim();
  const reason = reasonRaw ? reasonRaw.slice(0, 500) : 'force-logout (no reason provided)';

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, email, status, is_deleted, active_company_id')
    .eq('id', userId)
    .maybeSingle();
  if (userErr) {
    logger.error('super_admin_force_logout_user_lookup_failed', { userId, message: userErr.message });
    return res.status(500).json({ error: 'USER_LOOKUP_FAILED', details: userErr.message });
  }
  if (!userRow) {
    return res.status(404).json({ error: 'USER_NOT_FOUND' });
  }
  const u = userRow as {
    id: string;
    email: string | null;
    status: 'invited' | 'active' | 'suspended' | 'deleted' | null;
    is_deleted: boolean;
    active_company_id: string | null;
  };
  if (u.is_deleted || u.status === 'deleted') {
    return res.status(409).json({
      error: 'ACCOUNT_DELETED',
      details: 'Cannot force-logout a soft-deleted account.',
    });
  }

  let revokedAuthSessions = 0;
  let supabaseSignOutOk = false;
  let supabaseSignOutError: string | null = null;
  try {
    const result = await invalidateUserSessionsAndSignOut(userId, `force_logout:${reason}`);
    revokedAuthSessions = result.revokedAuthSessions;
    supabaseSignOutOk = result.supabaseSignOutOk;
    supabaseSignOutError = result.supabaseSignOutError;
  } catch (err: any) {
    logger.error('super_admin_force_logout_invalidate_failed', {
      userId,
      message: err?.message ?? String(err),
    });
    return res.status(500).json({
      error: 'SESSION_INVALIDATION_FAILED',
      details: err?.message ?? String(err),
    });
  }

  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_USER_FORCE_LOGOUT',
    targetUserId: userId,
    companyId: u.active_company_id,
    metadata: {
      capability: IDENTITY_ADMIN_ASSIGN,
      reason,
      revoked_auth_sessions: revokedAuthSessions,
      supabase_signout_ok: supabaseSignOutOk,
      supabase_signout_error: supabaseSignOutError,
      target_email: u.email,
      target_status_before: u.status ?? 'active',
    },
  });

  void logAuthEvent('role_changed', {
    userId,
    metadata: {
      lifecycle_event: 'force_logout',
      changed_by: 'super_admin',
      reason,
    },
  });

  return res.status(200).json({
    user_id: userId,
    revoked_sessions: revokedAuthSessions,
    supabase_signout_ok: supabaseSignOutOk,
    message:
      'Sessions revoked. JWTs issued before this point are no longer valid. The user may sign in again.',
  });
}
