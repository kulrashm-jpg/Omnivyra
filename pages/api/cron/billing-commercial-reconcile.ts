import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/billing-commercial-reconcile
 *
 * B2 (P1) — schedules the EXISTING commercialReconciliationService. No new
 * reconciliation engine: this route only gives the proven repair sweep a clock.
 *
 * Repairs top-up purchases stuck at `status='completed'` with
 * `fulfillment_status != 'completed'` — the "charged but not credited" state
 * that occurs when allocation fails after the status flip, or when a customer's
 * browser disappears and the verify call never lands.
 *
 * Idempotent end to end: repair re-runs `completePurchase` (deterministic
 * credit idempotency key) plus `generateTopupInvoice` (deterministic invoice
 * number + UNIQUE), so re-running this job never double-grants and never
 * duplicates an invoice.
 *
 * Defaults to dryRun=false — a scheduled sweep that only *reports* would leave
 * the very state it exists to fix. Pass ?dryRun=1 for a read-only inspection.
 *
 * Schedule: every 15 minutes, matching billing-reservation-reconcile.
 * Auth: CRON_SECRET bearer OR super_admin_session cookie OR SUPER_ADMIN role.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { reconcile } from '../../../backend/services/billing/commercialReconciliationService';
import { runJob } from '../../../backend/services/jobRunner';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';
import { logger } from '../../../backend/services/logger';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  return false;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:billing-commercial-reconcile',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:billing-commercial-reconcile:${Math.floor(Date.now() / (15 * 60 * 1000))}`,
    },
    async () => reconcile({ kind: 'global' }, dryRun),
  );

  if (outcome.status === 'completed') {
    const result = outcome.result as { found: number; repaired: number; skipped: number };
    if (result.repaired > 0) {
      logger.warn('payment_reconciliation_repaired', {
        found: result.found, repaired: result.repaired, skipped: result.skipped, dryRun,
      });
    }
    if (result.skipped > 0) {
      logger.error('payment_reconciliation_failed', { skipped: result.skipped, found: result.found });
    }
    return res.status(200).json({ ok: true, dryRun, result, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  }
  logger.error('payment_reconciliation_failed', {
    stage: 'job', status: outcome.status,
    message: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status),
  });
  return res.status(500).json({
    ok: false,
    error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/billing-commercial-reconcile' });
