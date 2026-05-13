/**
 * POST /api/super-admin/users/[id]/suspend
 *
 * Phase 2.B — suspend a user globally.
 *
 * Effect:
 *   - users.status = 'suspended'
 *   - users.session_revoked_after = NOW()       (JWT epoch bump)
 *   - auth_sessions: every live row → revoked_at = NOW()
 *   - Supabase admin signOut(user, scope='global') (best-effort)
 *
 * After this completes:
 *   - All existing JWTs for the user are rejected by the canonical resolver
 *     (`SESSION_REVOKED` once the epoch check trips, or `ACCOUNT_SUSPENDED`
 *     once the status check trips — either fires first).
 *   - Refresh tokens cannot mint new JWTs (Supabase signOut).
 *   - Extension validateSession rejects on the next hit (DB lifecycle gate).
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
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:users:suspend', 20, 60))) return;

  const userId = String(req.query.id || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'MISSING_USER_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `super-admin suspends user ${userId}`,
    resourceId: userId,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  // Disallow self-suspend — a super-admin should not be able to lock themselves
  // out via this surface. Recovery would require DB intervention.
  if (actorUserId && actorUserId === userId) {
    return res.status(409).json({
      error: 'SELF_SUSPEND_BLOCKED',
      details: 'A super-admin cannot suspend their own account through this endpoint.',
    });
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as {
    reason?: string;
  };
  const reasonRaw = String(body.reason ?? '').trim();
  if (!reasonRaw) {
    return res.status(400).json({
      error: 'MISSING_REASON',
      details: 'A non-empty reason is required for suspension (recorded in audit).',
    });
  }
  // Cap reason length to keep audit payloads bounded.
  const reason = reasonRaw.slice(0, 500);

  // Load the user — we need the previous state for the audit row + we
  // refuse the operation if the user is already deleted/suspended.
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, email, status, is_deleted, active_company_id')
    .eq('id', userId)
    .maybeSingle();
  if (userErr) {
    logger.error('super_admin_suspend_user_lookup_failed', { userId, message: userErr.message });
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
    return res.status(409).json({ error: 'ACCOUNT_ALREADY_DELETED' });
  }
  if (u.status === 'suspended') {
    return res.status(200).json({
      user_id: userId,
      previous_status: 'suspended',
      current_status: 'suspended',
      revoked_sessions: 0,
      message: 'User was already suspended; no state change.',
    });
  }

  // 1. Flip status to suspended (the resolver short-circuits ahead of the
  //    epoch check on this branch — defense-in-depth).
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('users')
    .update({ status: 'suspended', updated_at: nowIso })
    .eq('id', userId);
  if (updateErr) {
    logger.error('super_admin_suspend_status_update_failed', { userId, message: updateErr.message });
    return res.status(500).json({ error: 'STATUS_UPDATE_FAILED', details: updateErr.message });
  }

  // 2. Invalidate all sessions (epoch bump + auth_sessions revoke + Supabase signOut).
  let revokedAuthSessions = 0;
  let supabaseSignOutOk = false;
  let supabaseSignOutError: string | null = null;
  try {
    const result = await invalidateUserSessionsAndSignOut(userId, `suspend:${reason}`);
    revokedAuthSessions = result.revokedAuthSessions;
    supabaseSignOutOk = result.supabaseSignOutOk;
    supabaseSignOutError = result.supabaseSignOutError;
  } catch (err: any) {
    // Status is already 'suspended' (gate trips on next auth); log the
    // session-invalidation failure but do not roll back the status flip.
    logger.error('super_admin_suspend_invalidate_failed', {
      userId,
      message: err?.message ?? String(err),
    });
  }

  // 3. Audit.
  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_USER_SUSPEND',
    targetUserId: userId,
    companyId: u.active_company_id,
    metadata: {
      capability: IDENTITY_ADMIN_ASSIGN,
      reason,
      before: { status: u.status ?? 'active' },
      after: { status: 'suspended' },
      revoked_auth_sessions: revokedAuthSessions,
      supabase_signout_ok: supabaseSignOutOk,
      supabase_signout_error: supabaseSignOutError,
      target_email: u.email,
    },
  });

  // Secondary signal for the auth-audit stream.
  void logAuthEvent('role_changed', {
    userId,
    metadata: {
      lifecycle_event: 'suspended',
      changed_by: 'super_admin',
      reason,
    },
  });

  return res.status(200).json({
    user_id: userId,
    previous_status: u.status ?? 'active',
    current_status: 'suspended',
    revoked_sessions: revokedAuthSessions,
    supabase_signout_ok: supabaseSignOutOk,
  });
}
