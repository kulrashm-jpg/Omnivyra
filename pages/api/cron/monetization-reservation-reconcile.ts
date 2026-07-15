import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { config } from '@/config';
import {
  auditMonetizationInvariants,
  reconcileDurableMonetizationReservations,
} from '@/backend/services/monetizationReservationReconciliationService';
import { runJob } from '@/backend/services/jobRunner';

function numberFromQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isAuthorized(req: NextApiRequest): boolean {
  const secret = config.INTERNAL_METRICS_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  const presented = req.headers['x-cron-secret'];
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return presented === secret || bearer === secret;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorised' });

  const minAgeSeconds = numberFromQuery(req.query.minAgeSeconds);
  const batchLimit = numberFromQuery(req.query.batchLimit);
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined;
  const includeAudit = String(req.query.audit ?? 'true') !== 'false';

  const triggeredByCronSecret = !!process.env.CRON_SECRET
    && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  const outcome = await runJob(
    {
      jobName: 'cron:monetization-reservation-reconcile',
      triggerSource: triggeredByCronSecret ? 'cron' : 'admin',
      tenantId: orgId ?? null,
      principalKind: triggeredByCronSecret ? 'cron-secret' : 'metrics-secret',
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
