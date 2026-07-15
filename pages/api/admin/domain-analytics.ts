import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/admin/domain-analytics
 *
 * Returns the three core domain-events aggregations:
 *   - top_failing_domains
 *   - high_risk_companies
 *   - event_trends
 *
 * SUPER_ADMIN only. Rate-limited per user.
 *
 * Query params:
 *   - top_limit (default 10) — passed to getTopFailingDomains
 *   - risk_threshold (default 5) — passed to getHighRiskCompanies
 *   - trend_days (default 7) — passed to getEventTrend
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit, requireSuperAdminUser } from '../../../backend/services/requestAccessService';
import {
  getTopFailingDomains,
  getHighRiskCompanies,
  getEventTrend,
} from '../../../backend/services/domainAnalyticsService';
import { logger } from '../../../backend/services/logger';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:domain-analytics', 30, 60))) return;
  if (!(await requireSuperAdminUser(req, res))) return;

  const topLimit       = clampInt(req.query.top_limit as string | undefined, 10, 1, 100);
  const riskThreshold  = clampInt(req.query.risk_threshold as string | undefined, 5, 1, 1000);
  const trendDays      = clampInt(req.query.trend_days as string | undefined, 7, 1, 365);

  try {
    const [top_failing_domains, high_risk_companies, event_trends] = await Promise.all([
      getTopFailingDomains(topLimit),
      getHighRiskCompanies(riskThreshold),
      getEventTrend(trendDays),
    ]);
    return res.status(200).json({
      top_failing_domains,
      high_risk_companies,
      event_trends,
      params: {
        top_limit:      topLimit,
        risk_threshold: riskThreshold,
        trend_days:     trendDays,
      },
    });
  } catch (err: any) {
    logger.error('admin_domain_analytics_failed', { message: err?.message ?? String(err) });
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  if (!raw) return dflt;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/domain-analytics' });
