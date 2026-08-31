import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { composeGrowthReport } from '../../../backend/services/growthReportService';
import { resolveAnalyticsReportInput } from '../../../backend/services/analyticsInputResolver';
import { getWebsiteReportSafe } from '../../../backend/services/websiteIntelligence/websiteIntelligenceRepository';
import { getLeadReportSafe } from '../../../backend/services/leadIntelligence/leadIntelligenceSnapshotAdapter';
import { getPluginsForReport, composePluginSnapshotMemoized, createCompositionContext } from '../../../backend/services/platformIntelligence/registry';
import { resolveCompanyId } from '../../../backend/services/reportsCompanyAccessService';
import '../../../backend/services/platformIntelligence/plugins'; // auto-register every plugin

type GrowthReportApiResponse = {
  report_type?: 'growth';
  score?: {
    available: true;
    value: null;
    label: null;
  };
  market_analytics?: unknown;
  search_analytics?: unknown;
  analytics_health?: unknown;
  enterprise_snapshot?: unknown;
  competitive_strategy_map?: unknown;
  strategic_position?: unknown;
  sections?: Array<{
    section_name: string;
    IU_ids: string[];
    insights: unknown[];
    opportunities: unknown[];
    actions: unknown[];
  }>;
  // Phase 18 — additive intelligence projections (fail-open; typed from their source fns).
  website_intelligence?: Awaited<ReturnType<typeof getWebsiteReportSafe>>;
  lead_intelligence?: Awaited<ReturnType<typeof getLeadReportSafe>>;
  platform_intelligence?: Record<string, unknown>;
  error?: string;
  code?: string;
};


async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GrowthReportApiResponse>,
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

    const resolvedInput = await resolveAnalyticsReportInput({
      companyId,
      reportCategory: 'growth',
    });
    // W2-9 (audit B-17): the three projections are independent of each other
    // (only composeGrowthReport consumes resolvedInput) — run them in
    // parallel instead of a serial waterfall. Same calls, same fail-open
    // semantics (getWebsiteReportSafe/getLeadReportSafe are *Safe wrappers),
    // report latency drops from sum(services) to max(services).
    const [growthReport, website_intelligence, lead_intelligence] = await Promise.all([
      composeGrowthReport(companyId, { resolvedInput }),
      getWebsiteReportSafe(companyId),
      getLeadReportSafe(companyId),
    ]);
    const ctx = createCompositionContext(); const nowMs = Date.now(); // request-scoped: each plugin composes once
    const platform_intelligence = Object.fromEntries(
      await Promise.all(getPluginsForReport('growth').map(async (p) => [p.id, await composePluginSnapshotMemoized(p, companyId, nowMs, ctx).catch(() => null)] as const)),
    );
    return res.status(200).json({ ...growthReport, website_intelligence, lead_intelligence, platform_intelligence });
  } catch (error) {
    console.error('[reports/growth] error:', error);
    return res.status(500).json({
      error: 'Failed to compose growth report',
      code: 'SERVER_ERROR',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/reports/growth' });
