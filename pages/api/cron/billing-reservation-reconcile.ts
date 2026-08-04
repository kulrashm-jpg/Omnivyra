import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/billing-reservation-reconcile
 *
 * Phase 2 cron — scans the reservation surface for:
 *   - expired HOLDs awaiting the reaper
 *   - billing_operations claiming 'confirmed' without a ledger CONFIRM
 *   - orchestrator calls stuck in 'initiated' / 'held' beyond SLA
 *
 * Schedule: every 15 minutes recommended. The reaper itself runs hourly;
 * this job is the early-warning detector.
 *
 * Auth: CRON_SECRET bearer OR super_admin_session cookie OR SUPER_ADMIN role.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { runReservationReconciliation } from '../../../backend/services/billing/jobs/reservationReconciliationJob';
import { runJob } from '../../../backend/services/jobRunner';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  return false;
}

function numberFromQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const slaMin   = numberFromQuery(req.query.slaMinutes);
  const scanLim  = numberFromQuery(req.query.scanLimit);

  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:billing-reservation-reconcile',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      idempotencyKey: `cron:billing-reservation-reconcile:${Math.floor(Date.now() / (15 * 60 * 1000))}`,
    },
    async () => runReservationReconciliation({ stuckSlaMinutes: slaMin, scanLimit: scanLim }),
  );

  if (outcome.status === 'completed') {
    return res.status(200).json({ ok: true, result: outcome.result, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason });
  }
  console.error('billing_reservation_reconcile_failed', outcome);
  return res.status(500).json({ ok: false, error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status) });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/billing-reservation-reconcile' });
