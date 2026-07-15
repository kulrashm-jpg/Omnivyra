import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/dead-letter-queue
 *
 * Operator inspection of the worker dead-letter queue.
 *
 * Query parameters:
 *   workerName  — filter by job name
 *   tenantId    — filter to entries written by the canonical jobRunner
 *                 with this tenant lineage
 *   before      — ISO timestamp cursor for pagination
 *   limit       — page size (default 50, max 500)
 *   summary=1   — return aggregate counts by worker name instead of rows
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability).
 *
 * NOTE: this endpoint is READ-ONLY. Replay of a DLQ entry is NOT
 * supported here — it requires a worker- or cron-specific entry point
 * with `replayDLQ: true` so the operator's intent is explicit and the
 * runner re-enters with the original idempotency key. A "view this
 * entry" click must never become a "retry this job" side effect.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import {
  listDeadLetters,
  summarizeDeadLetters,
} from '../../../backend/services/jobInspection';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:dlq', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'super-admin dead-letter-queue inspection',
  });
  if (guard.ok !== true) return;

  try {
    if (req.query.summary === '1' || req.query.summary === 'true') {
      const since = typeof req.query.since === 'string' ? req.query.since : undefined;
      const counts = await summarizeDeadLetters({ since });
      return res.status(200).json({ ok: true, summary: counts });
    }

    const result = await listDeadLetters({
      workerName: typeof req.query.workerName === 'string' ? req.query.workerName : undefined,
      tenantId:   typeof req.query.tenantId   === 'string' ? req.query.tenantId   : undefined,
      before:     typeof req.query.before     === 'string' ? req.query.before     : undefined,
      limit:      typeof req.query.limit      === 'string' ? Number(req.query.limit) : undefined,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/dead-letter-queue' });
