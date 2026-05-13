/**
 * POST /api/super-admin/users/[id]/resume
 *
 * Phase 2.B — resume a suspended user.
 *
 * Effect:
 *   - users.status flips suspended → active
 *   - users.session_revoked_after is NOT cleared. Resume does not
 *     re-validate existing JWTs; the user must sign in again to mint
 *     a fresh token whose iat > session_revoked_after.
 *   - auth_sessions are NOT un-revoked — revocation is one-way; the
 *     user must establish a new session.
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:users:resume', 20, 60))) return;

  const userId = String(req.query.id || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'MISSING_USER_ID' });
  }

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: `super-admin resumes user ${userId}`,
    resourceId: userId,
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as {
    reason?: string;
  };
  const reasonRaw = String(body.reason ?? '').trim();
  const reason = reasonRaw ? reasonRaw.slice(0, 500) : 'resume (no reason provided)';

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, email, status, is_deleted, active_company_id')
    .eq('id', userId)
    .maybeSingle();
  if (userErr) {
    logger.error('super_admin_resume_user_lookup_failed', { userId, message: userErr.message });
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
      details: 'Soft-deleted accounts cannot be resumed via this endpoint.',
    });
  }
  if (u.status !== 'suspended') {
    return res.status(409).json({
      error: 'NOT_SUSPENDED',
      details: `User is currently '${u.status ?? 'active'}'. Resume only applies to suspended accounts.`,
    });
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('users')
    .update({ status: 'active', updated_at: nowIso })
    .eq('id', userId);
  if (updateErr) {
    logger.error('super_admin_resume_status_update_failed', { userId, message: updateErr.message });
    return res.status(500).json({ error: 'STATUS_UPDATE_FAILED', details: updateErr.message });
  }

  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_USER_RESUME',
    targetUserId: userId,
    companyId: u.active_company_id,
    metadata: {
      capability: IDENTITY_ADMIN_ASSIGN,
      reason,
      before: { status: 'suspended' },
      after: { status: 'active' },
      target_email: u.email,
    },
  });

  void logAuthEvent('role_changed', {
    userId,
    metadata: {
      lifecycle_event: 'resumed',
      changed_by: 'super_admin',
      reason,
    },
  });

  return res.status(200).json({
    user_id: userId,
    previous_status: 'suspended',
    current_status: 'active',
  });
}
