import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/scheduler-lock-sweep
 *
 * Proactive cleanup of stale rows in `scheduler_locks`. Each
 * long-running job's `acquireLock` already reactively overrides locks
 * older than 30 minutes, so this sweeper does not affect liveness;
 * it only deletes the abandoned rows that accumulate after worker
 * crashes.
 *
 * Recommended schedule: every 15 minutes.
 *
 * Auth:
 *   - Cron host: CRON_SECRET bearer
 *   - Manual: capability + platform authority + step-up (see authorize())
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sweepStaleSchedulerLocks } from '../../../backend/services/schedulerLockSweeper';
import { runJob } from '../../../backend/services/jobRunner';
import { bearerTokenMatches } from '../../../backend/security/constantTimeEqual';
import { requireCapability } from '../../../backend/security/requireCapability';
import { CRON_CONFIG_MANAGE } from '../../../shared/contracts/security';

/**
 * Scheduler: the CRON_SECRET bearer. A person triggering it manually: the
 * CRON_CONFIG_MANAGE capability on a platform SUPER_ADMIN principal, with step-up
 * (requireCapability writes the 401/403 itself). 2026-11-11: the legacy
 * super-admin cookie and the bare platform-role check
 * (no step-up) are gone.
 */
async function authorize(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearerTokenMatches(req.headers.authorization, cronSecret)) return true;
  const guard = await requireCapability(req, res, {
    capability: CRON_CONFIG_MANAGE,
    reason: 'manual trigger cron:scheduler-lock-sweep',
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

  const staleAgeMsParam = typeof req.query.staleAgeMs === 'string' ? Number(req.query.staleAgeMs) : NaN;
  const limitParam      = typeof req.query.limit      === 'string' ? Number(req.query.limit)      : NaN;
  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

  const outcome = await runJob(
    {
      jobName:        'cron:scheduler-lock-sweep',
      triggerSource:  triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:       null, // platform-wide cleanup
      principalKind:  triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      // Per-15-minute idempotency bucket so concurrent triggers collapse.
      idempotencyKey: `cron:scheduler-lock-sweep:${Math.floor(Date.now() / (15 * 60_000))}`,
    },
    async () => sweepStaleSchedulerLocks({
      staleAgeMs: Number.isFinite(staleAgeMsParam) && staleAgeMsParam > 0 ? staleAgeMsParam : undefined,
      limit:      Number.isFinite(limitParam)      && limitParam      > 0 ? limitParam      : undefined,
    }),
  );

  if (outcome.status === 'completed') {
    return res.status(200).json({
      ok: true,
      ...outcome.result,
      executionId: outcome.ctx.executionId,
    });
  }

  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({
      ok: false,
      code: 'DEAD_LETTER_SKIP',
      reason: outcome.reason,
      executionId: outcome.ctx.executionId,
    });
  }

  return res.status(500).json({
    ok: false,
    error: outcome.status === 'failed' && outcome.error instanceof Error
      ? outcome.error.message
      : String(outcome.status),
    executionId: outcome.ctx.executionId,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/scheduler-lock-sweep' });
