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
 *   - Manual: legacy super_admin_session cookie OR canonical SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { reapOrphanHolds } from '../../../backend/services/creditOrphanHoldReaper';
import { runJob } from '../../../backend/services/jobRunner';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;
  if (req.cookies?.super_admin_session === '1') return true;
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

  // Optional knobs via query string for ops triage. Defaults match the service.
  const minAgeSeconds = numberFromQuery(req.query.minAgeSeconds);
  const maxAgeSeconds = numberFromQuery(req.query.maxAgeSeconds);
  const batchLimit    = numberFromQuery(req.query.batchLimit);
  const orgId         = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;

  // Run through the canonical jobRunner so this cron gets execution
  // attribution + deterministic idempotency (per hour bucket) + DLQ on
  // terminal failure. The reaper itself remains the canonical worker —
  // the runner is a thin attribution + replay-safety wrapper.
  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

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
