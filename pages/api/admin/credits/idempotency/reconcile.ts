import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/admin/credits/idempotency/reconcile
 *
 * Operator-triggered bulk reconciliation of stuck idempotency operations.
 * Equivalent to running the cron `/api/cron/billing-idempotency-expire`
 * on-demand. Supports dry-run mode for preview.
 *
 * Body:
 *   {
 *     dryRun?: boolean,
 *     windowSecOverride?: { billing_operations?: number; job_execution_registry?: number; ... },
 *     limitPerSurface?: number,
 *   }
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
import { reconcileStuckOperations } from '../../../../../backend/services/billing/idempotency/idempotencyRecoveryService';
import { withIdempotency } from '../../../../../backend/middleware/withIdempotency';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:idempotency_reconcile', 5, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  const isAdmin = (await isPlatformSuperAdmin(user.id))
    || (await isSuperAdmin(user.id))
    || (await isFinanceAdmin(user.id));
  if (!isAdmin) return res.status(403).json({ error: 'FINANCE_ADMIN_REQUIRED' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const dryRun = Boolean(body.dryRun);
  const limitPerSurface = Number.isFinite(body.limitPerSurface) ? Number(body.limitPerSurface) : 200;
  const windowSecOverride = (body.windowSecOverride as Record<string, number> | undefined) ?? undefined;

  try {
    const summary = await reconcileStuckOperations(user.id, {
      dryRun,
      limitPerSurface,
      windowSecOverride: windowSecOverride as Parameters<typeof reconcileStuckOperations>[1] extends infer T ? T extends { windowSecOverride?: infer W } ? W : undefined : undefined,
    });
    return res.status(200).json({ ok: true, summary, dryRun });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

export default __createApiRoute(withIdempotency(handler, { scope: 'admin-idempotency-reconcile', methods: ['POST'] }), { route: '/api/admin/credits/idempotency/reconcile' });
