import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  composePerformanceIntelligenceReport,
  type PerformanceIntelligenceReportResponse,
} from '../../../backend/services/performanceReportService';
import { resolveAnalyticsReportInput } from '../../../backend/services/analyticsInputResolver';
import { getWebsiteReportSafe } from '../../../backend/services/websiteIntelligence/websiteIntelligenceRepository';
import { getLeadReportSafe } from '../../../backend/services/leadIntelligence/leadIntelligenceSnapshotAdapter';
import { getPluginsForReport, composePluginSnapshotMemoized, createCompositionContext } from '../../../backend/services/platformIntelligence/registry';
import { resolveCompanyId } from '../../../backend/services/reportsCompanyAccessService';
import '../../../backend/services/platformIntelligence/plugins'; // auto-register every plugin

type PerformanceReportApiResponse = (PerformanceIntelligenceReportResponse & {
  // Phase 18 — additive intelligence projections (fail-open; typed from their source fns).
  website_intelligence?: Awaited<ReturnType<typeof getWebsiteReportSafe>>;
  lead_intelligence?: Awaited<ReturnType<typeof getLeadReportSafe>>;
  platform_intelligence?: Record<string, unknown>;
}) | {
  error?: string;
  code?: string;
};


async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PerformanceReportApiResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const companyId = await resolveCompanyId(
      user.id,
      req.query.company_id as string | undefined,
    );

    if (!companyId) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'ACCESS_DENIED',
      });
    }

    const sinceDaysParam = Array.isArray(req.query.since_days)
      ? req.query.since_days[0]
      : req.query.since_days;
    const sinceDays = sinceDaysParam ? Number.parseInt(sinceDaysParam, 10) : undefined;

    const resolvedInput = await resolveAnalyticsReportInput({
      companyId,
      reportCategory: 'performance',
    });
    const performanceReport = await composePerformanceIntelligenceReport(companyId, {
      sinceDays: Number.isFinite(sinceDays) && sinceDays && sinceDays > 0 ? sinceDays : undefined,
      resolvedInput,
    });
    // Phase 18 — additive Website Intelligence projection (fail-open, no existing calc touched).
    const website_intelligence = await getWebsiteReportSafe(companyId);
    const lead_intelligence = await getLeadReportSafe(companyId);
    const ctx = createCompositionContext(); const nowMs = Date.now(); // request-scoped: each plugin composes once
    const platform_intelligence = Object.fromEntries(
      await Promise.all(getPluginsForReport('performance').map(async (p) => [p.id, await composePluginSnapshotMemoized(p, companyId, nowMs, ctx).catch(() => null)] as const)),
    );
    return res.status(200).json({ ...performanceReport, website_intelligence, lead_intelligence, platform_intelligence });
  } catch (error) {
    console.error('[reports/performance] error:', error);
    return res.status(500).json({
      error: 'Failed to compose performance report',
      code: 'SERVER_ERROR',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/reports/performance' });
