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
 *   - Manual: capability + platform authority + step-up (see authorize())
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { reconcileAll } from '../../../backend/services/creditReconciliation';
import { runJob } from '../../../backend/services/jobRunner';
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
    reason: 'manual trigger cron:credit-reconciliation',
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

  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  // Wrap in the canonical jobRunner so this cron gets execution
  // attribution, deterministic idempotency (per UTC day bucket), and
  // dead-letter classification on terminal failure. The runner does not
  // execute the work itself — it composes context + replay-safety + DLQ
  // around the existing `reconcileAll` call.
  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

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
