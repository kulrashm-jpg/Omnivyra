/**
 * POST /api/admin/credits/idempotency/recover
 *
 * Operator-initiated recovery of a stuck idempotency operation.
 *
 * Body:
 *   {
 *     surface:    'billing_operations' | 'job_execution_registry' | 'credit_action_approvals',
 *     id:         string,
 *     action:     'expire' | 'cancel' | 'mark_failed',
 *     reason:     string,
 *   }
 *
 * Auth: SUPER_ADMIN or FINANCE_ADMIN.
 *
 * The recovery service performs a financial drift check BEFORE applying the
 * status transition. If drift is detected, the request is REFUSED with a
 * critical anomaly so the reaper can clean up the underlying HOLD first.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../../backend/services/requestAccessService';
import {
  isPlatformSuperAdmin,
  isSuperAdmin,
} from '../../../../../backend/services/rbacService';
import { isFinanceAdmin } from '../../../../../backend/services/billing/financeRbacService';
import { recoverOperation, type RecoveryArgs } from '../../../../../backend/services/billing/idempotency/idempotencyRecoveryService';
import { withIdempotency } from '../../../../../backend/middleware/withIdempotency';

const VALID_SURFACES: RecoveryArgs['surface'][] = [
  'billing_operations',
  'job_execution_registry',
  'credit_action_approvals',
];

const VALID_ACTIONS: RecoveryArgs['action'][] = ['expire', 'cancel', 'mark_failed'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:idempotency_recover', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;

  // Either SUPER_ADMIN or FINANCE_ADMIN can recover stuck operations.
  const isAdmin = (await isPlatformSuperAdmin(user.id))
    || (await isSuperAdmin(user.id))
    || (await isFinanceAdmin(user.id));
  if (!isAdmin) return res.status(403).json({ error: 'FINANCE_ADMIN_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { surface, id, action, reason } = body as {
    surface?: RecoveryArgs['surface'];
    id?:      string;
    action?:  RecoveryArgs['action'];
    reason?:  string;
  };

  if (!surface || !VALID_SURFACES.includes(surface)) {
    return res.status(400).json({ error: `surface must be one of: ${VALID_SURFACES.join(', ')}` });
  }
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });
  if (!action || !VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
  }
  if (!reason?.trim()) return res.status(400).json({ error: 'reason required' });

  const result = await recoverOperation({
    surface, id, action,
    actorUserId: user.id,
    reason:      reason.trim(),
  });

  if (!result.ok) {
    const status = result.error === 'NOT_FOUND'        ? 404 :
                   result.error === 'DRIFT_DETECTED'   ? 409 :
                                                         400;
    return res.status(status).json({ ok: false, ...result });
  }
  return res.status(200).json(result);
}

export default withIdempotency(handler, { scope: 'admin-idempotency-recover', methods: ['POST'] });
