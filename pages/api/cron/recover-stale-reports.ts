import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  recoverStaleGeneratingReports,
  REPORT_GENERATION_TIMEOUT_MINUTES,
} from '@/backend/services/reportCardService';
import { config } from '@/config';
import { bearerTokenMatches, constantTimeEqual } from '../../../backend/security/constantTimeEqual';

/**
 * Phase 2 — Cron-driven recovery for reports stuck in `status='generating'`.
 *
 * Vercel serverless lambdas are frozen / killed shortly after the HTTP
 * response is flushed. The original Snapshot generation flow used a
 * fire-and-forget background closure, so any lambda suspended mid-generation
 * leaves a row pinned at `status='generating'` forever, which trips the
 * partial unique index `unique_generating_report_per_company_domain` and
 * blocks every subsequent request for that (company_id, domain).
 *
 * This endpoint reaps those rows. The worker runs the same reaper on its own
 * timer (backend/scheduler/cron.ts, label `recoverStaleReports`); this route
 * stays for manual and external triggers. It is:
 *   - Secured by EITHER secret, whichever the caller holds:
 *       * INTERNAL_METRICS_SECRET, as header `x-cron-secret` or as the
 *         authorization value (raw or `Bearer <secret>`);
 *       * CRON_SECRET, as `Authorization: Bearer <CRON_SECRET>`: the shape
 *         every other /api/cron route accepts and Vercel cron sends. Before
 *         this, that Bearer was compared against INTERNAL_METRICS_SECRET, so
 *         a scheduler holding CRON_SECRET was always refused.
 *     Fails closed (401) when neither secret is configured.
 *   - Idempotent: rerunning when there is nothing to reap is a no-op.
 *   - Safe under concurrency: the UPDATE is a single statement.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = config.INTERNAL_METRICS_SECRET;
  const cronSecret = config.CRON_SECRET;
  if (!secret && !cronSecret) {
    console.warn('[cron/recover-stale-reports] neither INTERNAL_METRICS_SECRET nor CRON_SECRET configured; rejecting request to fail closed');
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const presented = req.headers['x-cron-secret'];
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // SEC-C4: constant-time; every shape is evaluated so timing does not reveal
  // which matched. Each helper fails closed on an unset/empty secret.
  const presentedOk = constantTimeEqual(presented, secret);
  const bearerOk = constantTimeEqual(bearer, secret);
  const cronBearerOk = bearerTokenMatches(req.headers.authorization, cronSecret);
  if (!presentedOk && !bearerOk && !cronBearerOk) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const timeoutOverride = Number.parseInt(
    String(req.query.timeoutMinutes ?? ''),
    10,
  );
  const timeoutMinutes = Number.isFinite(timeoutOverride) && timeoutOverride > 0
    ? timeoutOverride
    : REPORT_GENERATION_TIMEOUT_MINUTES;

  try {
    const result = await recoverStaleGeneratingReports(timeoutMinutes);
    if (result.recovered > 0) {
      console.warn(
        `[cron/recover-stale-reports] recovered=${result.recovered} timeoutMinutes=${result.timeoutMinutes} cutoff=${result.cutoffIso} ids=${result.recoveredIds.join(',')}`,
      );
    } else {
      console.log(
        `[cron/recover-stale-reports] recovered=0 timeoutMinutes=${result.timeoutMinutes}`,
      );
    }
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[cron/recover-stale-reports] fatal error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/recover-stale-reports' });
