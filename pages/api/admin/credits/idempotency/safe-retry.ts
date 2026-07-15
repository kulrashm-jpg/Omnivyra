import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/admin/credits/idempotency/safe-retry
 *
 * Phase D — recovery-safe retry. Verifies NO completed settlement / ledger
 * mutation / active reservation exists, then supersedes the stuck row and
 * issues a fresh idempotency key + lineage. NEVER re-runs a financial
 * mutation; the operator re-submits the action under the new key.
 *
 * Body:
 *   { surface: 'billing_operations' | 'job_execution_registry', id: string, reason: string }
 *
 * Auth: SUPER_ADMIN or FINANCE_ADMIN.
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
import { safeRetryOperation, type SafeRetryArgs } from '../../../../../backend/services/billing/idempotency/idempotencyRecoveryService';
import { withIdempotency } from '../../../../../backend/middleware/withIdempotency';

const VALID_SURFACES: SafeRetryArgs['surface'][] = ['billing_operations', 'job_execution_registry'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:idempotency_safe_retry', 20, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  const isAdmin = (await isPlatformSuperAdmin(user.id))
    || (await isSuperAdmin(user.id))
    || (await isFinanceAdmin(user.id));
  if (!isAdmin) return res.status(403).json({ error: 'FINANCE_ADMIN_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { surface, id, reason } = body as {
    surface?: SafeRetryArgs['surface'];
    id?:      string;
    reason?:  string;
  };

  if (!surface || !VALID_SURFACES.includes(surface)) {
    return res.status(400).json({ error: `surface must be one of: ${VALID_SURFACES.join(', ')}` });
  }
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });
  if (!reason?.trim()) return res.status(400).json({ error: 'reason required' });

  const result = await safeRetryOperation({ surface, id, reason: reason.trim(), actorUserId: user.id });

  if (result.ok === false) {
    const status =
      result.code === 'NOT_FOUND'             ? 404 :
      result.code === 'COMPLETED_SETTLEMENT'  ? 409 :   // replay protection enforced
      result.code === 'ACTIVE_RESERVATION'    ? 409 :
      result.code === 'NOT_RECOVERABLE'       ? 409 :
                                                400;
    return res.status(status).json({ ok: false, ...result });
  }
  return res.status(200).json(result);
}

export default __createApiRoute(withIdempotency(handler, { scope: 'admin-idempotency-safe-retry', methods: ['POST'] }), { route: '/api/admin/credits/idempotency/safe-retry' });
