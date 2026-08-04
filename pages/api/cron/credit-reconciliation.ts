import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/credit-reconciliation
 *
 * Verifies that every wallet (`organization_credits`) matches the sum of
 * its ledger transactions. Drift is the primary financial-trust signal.
 *
 * Schedule: daily recommended.
 * Can also be triggered manually by a super admin to confirm a fix.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     summary: {
 *       orgsScanned: N,
 *       orgsInSync:  M,
 *       orgsDrifted: K,
 *       drifted: [{ orgId, observed, expected, delta, inSync }]   // first K only
 *     }
 *   }
 *
 * Drifted entries are returned in full so an operator can inspect the
 * delta without a second round-trip. In-sync orgs are NOT returned.
 *
 * Auth:
 *   - Cron host: CRON_SECRET bearer
 *   - Manual: super_admin_session cookie OR canonical SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { reconcileAll } from '../../../backend/services/creditReconciliation';
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  // Wrap in the canonical jobRunner so this cron gets execution
  // attribution, deterministic idempotency (per UTC day bucket), and
  // dead-letter classification on terminal failure. The runner does not
  // execute the work itself — it composes context + replay-safety + DLQ
  // around the existing `reconcileAll` call.
  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName:       'cron:credit-reconciliation',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      null, // platform-wide
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      // Deterministic per-day idempotency. Two cron ticks in the same UTC
      // day collapse to one canonical execution from the runner's view —
      // the inner reconcileAll is read-only and safe to actually run on
      // each tick, but the audit lineage records one execution per day.
      idempotencyKey: `cron:credit-reconciliation:${new Date().toISOString().slice(0, 10)}`,
    },
    async () => reconcileAll({ limit }),
  );

  if (outcome.status === 'completed') {
    const summary = outcome.result;
    console.log(JSON.stringify({
      level: summary.orgsDrifted > 0 ? 'ERROR' : 'INFO',
      event: 'credit_reconciliation_complete',
      orgsScanned: summary.orgsScanned,
      orgsInSync:  summary.orgsInSync,
      orgsDrifted: summary.orgsDrifted,
      executionId: outcome.ctx.executionId,
      ts:          new Date().toISOString(),
    }));
    return res.status(200).json({ ok: true, summary, executionId: outcome.ctx.executionId });
  }

  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({
      ok: false,
      code: 'DEAD_LETTER_SKIP',
      reason: outcome.reason,
      executionId: outcome.ctx.executionId,
    });
  }

  console.error('credit_reconciliation_failed', outcome);
  return res.status(500).json({
    ok:    false,
    error: outcome.status === 'failed' && outcome.error instanceof Error
      ? outcome.error.message
      : String(outcome.status),
    executionId: outcome.ctx.executionId,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/credit-reconciliation' });
