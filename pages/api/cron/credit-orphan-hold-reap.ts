import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET/POST /api/cron/credit-orphan-hold-reap
 *
 * Releases credit_transactions HOLDs that have no CONFIRM or RELEASE
 * sibling and are older than the configured threshold. Without this
 * sweep, server crashes between HOLD and CONFIRM/RELEASE leave the
 * reserved_* balance permanently stuck.
 *
 * Schedule: hourly recommended (configure in your cron host).
 * Can also be triggered manually by a super admin for ops triage.
 *
 * Auth:
 *   - Cron host: validated via CRON_SECRET header (Bearer)
 *   - Manual: capability + platform authority + step-up (see authorize())
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { reapOrphanHolds } from '../../../backend/services/creditOrphanHoldReaper';
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
    reason: 'manual trigger cron:credit-orphan-hold-reap',
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

  // Optional knobs via query string for ops triage. Defaults match the service.
  const minAgeSeconds = numberFromQuery(req.query.minAgeSeconds);
  const maxAgeSeconds = numberFromQuery(req.query.maxAgeSeconds);
  const batchLimit    = numberFromQuery(req.query.batchLimit);
  const orgId         = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;

  // Run through the canonical jobRunner so this cron gets execution
  // attribution + deterministic idempotency (per hour bucket) + DLQ on
  // terminal failure. The reaper itself remains the canonical worker —
  // the runner is a thin attribution + replay-safety wrapper.
  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

  const outcome = await runJob(
    {
      jobName:       'cron:credit-orphan-hold-reap',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId:      typeof orgId === 'string' ? orgId : null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'super-admin',
      // Hourly bucket idempotency for platform-wide runs; per-org for triage.
      idempotencyKey: orgId
        ? `cron:credit-orphan-hold-reap:${orgId}:${Math.floor(Date.now() / 3_600_000)}`
        : `cron:credit-orphan-hold-reap:${Math.floor(Date.now() / 3_600_000)}`,
    },
    async () => reapOrphanHolds({
      minAgeSeconds: minAgeSeconds ?? undefined,
      maxAgeSeconds: maxAgeSeconds ?? undefined,
      batchLimit:    batchLimit    ?? undefined,
      orgId,
    }),
  );

  if (outcome.status === 'completed') {
    const result = outcome.result;
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'credit_orphan_hold_reap_complete',
      ...result,
      executionId: outcome.ctx.executionId,
      ts:    new Date().toISOString(),
    }));
    return res.status(200).json({ ok: true, ...result, executionId: outcome.ctx.executionId });
  }

  if (outcome.status === 'tenant_invalid') {
    return res.status(400).json({
      ok: false,
      code: 'TENANT_INVALID',
      reason: outcome.reason,
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

  console.error('credit_orphan_hold_reap_failed', outcome);
  return res.status(500).json({
    ok:    false,
    error: outcome.status === 'failed' && outcome.error instanceof Error
      ? outcome.error.message
      : String(outcome.status),
    executionId: outcome.ctx.executionId,
  });
}

function numberFromQuery(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/credit-orphan-hold-reap' });
