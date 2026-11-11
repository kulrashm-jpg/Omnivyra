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
 * Auth: CRON_SECRET bearer, OR BILLING_PLATFORM_MANAGE + platform authority + step-up (manual trigger).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { reconcile } from '../../../backend/services/billing/commercialReconciliationService';
import { runJob } from '../../../backend/services/jobRunner';
import { logger } from '../../../backend/services/logger';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import { requireCapability } from '../../../backend/security/requireCapability';
import { BILLING_PLATFORM_MANAGE } from '../../../shared/contracts/security';

/**
 * Scheduler: the CRON_SECRET bearer. A person triggering it manually: the
 * BILLING_PLATFORM_MANAGE capability on a platform SUPER_ADMIN principal, with step-up
 * (requireCapability writes the 401/403 itself). 2026-11-11: the legacy
 * super-admin cookie and the bare platform-role check
 * (no step-up) are gone.
 */
async function authorize(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearerTokenMatches(req.headers.authorization, cronSecret)) return true;
  const guard = await requireCapability(req, res, {
    capability: BILLING_PLATFORM_MANAGE,
    reason: 'manual trigger cron:billing-commercial-reconcile',
    requirePlatformAuthority: true,
    requireStepUp: true,
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await authorize(req, res))) return;

  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

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
