import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  auditMonetizationInvariants,
  reconcileDurableMonetizationReservations,
} from '@/backend/services/monetizationReservationReconciliationService';
import { runJob } from '@/backend/services/jobRunner';
import { bearerTokenMatches, constantTimeEqual } from '../../../backend/security/constantTimeEqual';
import { isHoldReleaseEnabled, HOLD_RELEASE_DISABLED_REASON } from '../../../backend/services/billing/holdReleaseGate';

function numberFromQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

// e9 2026-11-13: CRON_SECRET ONLY. INTERNAL_METRICS_SECRET is a READ credential and must not release holds; and with
// `INTERNAL_METRICS_SECRET || CRON_SECRET` a set metrics secret made the Vercel cron's own Bearer CRON_SECRET a 401.
function isAuthorized(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const presented = req.headers['x-cron-secret'];
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // SEC-C4: constant-time; both shapes are evaluated so timing does not reveal which matched.
  const presentedOk = constantTimeEqual(presented, secret);
  const bearerOk = constantTimeEqual(bearer, secret);
  return presentedOk || bearerOk;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorised' });
  if (!isHoldReleaseEnabled()) {
    return res.status(409).json({ ok: false, code: 'HOLD_RELEASE_DISABLED', reason: HOLD_RELEASE_DISABLED_REASON });
  }

  const minAgeSeconds = numberFromQuery(req.query.minAgeSeconds);
  const batchLimit = numberFromQuery(req.query.batchLimit);
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const includeAudit = String(req.query.audit ?? 'true') !== 'false';

  const triggeredByCronSecret = bearerTokenMatches(req.headers.authorization, process.env.CRON_SECRET);

  const outcome = await runJob(
    {
      jobName: 'cron:monetization-reservation-reconcile',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId: orgId ?? null,
      principalKind: 'cron-secret',
      idempotencyKey: orgId
        ? `cron:monetization-reservation-reconcile:${orgId}:${Math.floor(Date.now() / 900_000)}`
        : `cron:monetization-reservation-reconcile:${Math.floor(Date.now() / 900_000)}`,
    },
    async () => {
      const reconciliation = await reconcileDurableMonetizationReservations({
        minAgeSeconds,
        batchLimit,
        orgId,
        reconciledBy: triggeredByCronSecret ? 'cron:monetization-reservation-reconcile' : 'admin:monetization-reservation-reconcile',
      });
      const audit = includeAudit ? await auditMonetizationInvariants({ staleHoldSeconds: minAgeSeconds }) : null;
      return { reconciliation, audit };
    },
  );

  if (outcome.status === 'completed') {
    return res.status(200).json({ ok: true, ...outcome.result, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'tenant_invalid') {
    return res.status(400).json({ ok: false, code: 'TENANT_INVALID', reason: outcome.reason, executionId: outcome.ctx.executionId });
  }
  if (outcome.status === 'dead_letter_skip') {
    return res.status(202).json({ ok: false, code: 'DEAD_LETTER_SKIP', reason: outcome.reason, executionId: outcome.ctx.executionId });
  }

  return res.status(500).json({
    ok: false,
    error: outcome.status === 'failed' && outcome.error instanceof Error ? outcome.error.message : String(outcome.status),
    executionId: outcome.ctx.executionId,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/cron/monetization-reservation-reconcile' });
