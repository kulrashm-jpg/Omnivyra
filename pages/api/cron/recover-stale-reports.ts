import type { NextApiRequest, NextApiResponse } from 'next';
import {
  recoverStaleGeneratingReports,
  REPORT_GENERATION_TIMEOUT_MINUTES,
} from '@/backend/services/reportCardService';
import { config } from '@/config';

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
 * This endpoint reaps those rows. It is:
 *   - Secured by INTERNAL_METRICS_SECRET (header `x-cron-secret`) and/or
 *     Vercel's signed cron header.
 *   - Idempotent: rerunning when there is nothing to reap is a no-op.
 *   - Safe under concurrency: the UPDATE is a single statement.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = config.INTERNAL_METRICS_SECRET;
  if (!secret) {
    console.warn('[cron/recover-stale-reports] INTERNAL_METRICS_SECRET not configured; rejecting request to fail closed');
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const presented = req.headers['x-cron-secret'];
  // Vercel's platform cron also injects an Authorization: Bearer <CRON_SECRET>
  // header. Accept either to keep platform + manual triggers working.
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (presented !== secret && bearer !== secret) {
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
