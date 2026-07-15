import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/super-admin/observability
 *
 * HARDEN-001 — read-only performance/telemetry snapshot from the in-process
 * observability registry (API/DB/AI/queue/scheduler/system metrics + top-N
 * leaderboards). Powers future performance dashboards without any external
 * observability backend.
 *
 * This endpoint ONLY reads aggregated in-memory metrics; it never mutates state
 * and never changes application behavior. Note: metrics are per-process, so on
 * serverless (Vercel) the numbers reflect the instance that served THIS request;
 * the long-lived worker process accumulates the fuller picture (incl. system +
 * scheduler + queue metrics).
 *
 * Auth: same guard as the sibling super-admin operational endpoints
 * (requireAdminRateLimit + requireCapability(CONTENT_PUBLISH)).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { CONTENT_PUBLISH } from '../../../shared/contracts/security/SecurityCapabilities';
import { getObservabilitySnapshot } from '../../../backend/observability';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:observability', 60, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: 'operator reads observability snapshot',
  });
  if (guard.ok !== true) return;

  try {
    const snapshot = getObservabilitySnapshot();
    // Optional `?verbose=0` trims the raw histogram/counter arrays for a lighter payload.
    if (String(req.query.verbose ?? '') === '0') {
      const { histograms: _h, counters: _c, ...lean } = snapshot;
      return res.status(200).json(lean);
    }
    return res.status(200).json(snapshot);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'snapshot failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/observability' });
