import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/timeline
 *
 * Cross-domain operational timeline reconstruction. Merges events from
 * capability_audit_log + worker_dead_letter_queue + credit_transactions
 * into one chronological stream. Read-only.
 *
 * Query parameters (at least ONE of userId / orgId / correlationId is
 * required so the query is scoped):
 *   userId         — user whose events to surface (matches actor + principal)
 *   orgId          — organization whose events to surface
 *   correlationId  — correlationId to trace across domains
 *   since          — ISO-8601 lower bound (default: 7 days ago)
 *   until          — ISO-8601 upper bound (default: now)
 *   limitPerSource — per-source row cap (default 200, max 1000)
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { queryTimeline } from '../../../backend/services/operationalTimeline';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:timeline', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason:     'super-admin operational timeline reconstruction',
  });
  if (guard.ok !== true) return;

  const userId        = typeof req.query.userId        === 'string' ? req.query.userId        : undefined;
  const orgId         = typeof req.query.orgId         === 'string' ? req.query.orgId         : undefined;
  const correlationId = typeof req.query.correlationId === 'string' ? req.query.correlationId : undefined;
  const since         = typeof req.query.since         === 'string' ? req.query.since         : undefined;
  const until         = typeof req.query.until         === 'string' ? req.query.until         : undefined;
  const limitParam    = typeof req.query.limitPerSource === 'string' ? Number(req.query.limitPerSource) : NaN;
  const limitPerSource = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  if (!userId && !orgId && !correlationId) {
    return res.status(400).json({
      error: 'At least one of userId, orgId, correlationId is required',
      code:  'UNSCOPED_QUERY',
    });
  }

  try {
    const events = await queryTimeline({
      userId,
      orgId,
      correlationId,
      since,
      until,
      limitPerSource,
    });
    return res.status(200).json({
      ok: true,
      total: events.length,
      events,
    });
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/timeline' });
