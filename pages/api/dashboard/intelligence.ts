import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { composePerformanceIntelligenceReport } from '../../../backend/services/performanceReportService';
import { getEngagementSignalsDashboardData } from '../../../backend/services/engagementSignalIntelligenceService';
import { generateEngagementSignalInsights } from '../../../backend/services/behaviorInsightService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_PLANNER,
];

type IntelligenceDashboardResponse =
  | {
      status: 'no_data' | 'low_data' | 'partial';
      message: string;
    }
  | {
      status: 'ready';
      key_decisions: Array<{
        type: string;
        severity: string;
        message: string;
        impact: number;
        context?: Record<string, string | number | null>;
      }>;
      focus_actions: Array<{
        type: string;
        priority: string;
        message: string;
        reasoning: string;
        impact_estimate: string;
        effort_level: string;
        context?: Record<string, string | number | null>;
      }>;
      engagement_signals: {
        label: 'Social Engagement (Not Traffic Data)';
        confidence: 'high' | 'low_confidence';
        warnings: string[];
        insights: Array<{
          type: string;
          severity: string;
          message: string;
          impact: number;
          confidence: string;
          context?: Record<string, string | number | null>;
        }>;
        top_performing_posts: Array<{
          content_id: string;
          campaign_id: string | null;
          platform: string;
          title: string;
          timestamp: string;
          engagement_total: number;
          impressions: number;
          clicks: number;
        }>;
        engagement_trends: Array<{
          date: string;
          total_engagement: number;
          impressions: number;
          clicks: number;
        }>;
        platform_comparison: Array<{
          platform: string;
          engagement_total: number;
          impressions: number;
          clicks: number;
          posts: number;
        }>;
      };
    };

const PRIORITY_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

async function handler(req: NextApiRequest, res: NextApiResponse<IntelligenceDashboardResponse | { error: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim();

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const [report, engagementSignals] = await Promise.all([
      composePerformanceIntelligenceReport(companyContext.companyId),
      getEngagementSignalsDashboardData(companyContext.companyId),
    ]);
    if (report.status !== 'ready') {
      return res.status(200).json({
        status: report.status,
        message: 'message' in report ? report.message : 'Performance report is not ready',
      });
    }

    const keyDecisions = [...report.source_data.insights]
      .slice(0, 5)
      .map((insight) => ({
        type: insight.type,
        severity: insight.severity,
        message: insight.message,
        impact: insight.metric,
        context: insight.context,
      }));

    const focusActions = [...report.source_data.recommendations]
      .sort((a, b) => {
        const priorityDelta = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (priorityDelta !== 0) return priorityDelta;
        return 0;
      })
      .slice(0, 5)
      .map((recommendation) => ({
        type: recommendation.type,
        priority: recommendation.priority,
        message: recommendation.message,
        reasoning: recommendation.reasoning,
        impact_estimate: recommendation.impact_estimate,
        effort_level: recommendation.effort_level,
        context: recommendation.context,
      }));

    const engagementInsights = generateEngagementSignalInsights({
      engagement_signals: engagementSignals,
    }).map((insight) => ({
      type: insight.type,
      severity: insight.severity,
      message: insight.message,
      impact: insight.metric,
      confidence: insight.confidence ?? 'medium',
      context: insight.context,
    }));

    return res.status(200).json({
      status: 'ready',
      key_decisions: keyDecisions,
      focus_actions: focusActions,
      engagement_signals: {
        label: engagementSignals.label,
        confidence: engagementSignals.confidence,
        warnings: engagementSignals.warnings,
        insights: engagementInsights,
        top_performing_posts: engagementSignals.top_performing_posts,
        engagement_trends: engagementSignals.engagement_trends,
        platform_comparison: engagementSignals.platform_comparison,
      },
    });
  } catch (err) {
    console.error('[dashboard/intelligence]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch dashboard intelligence',
    });
  }
}

export default __createApiRoute(withRBAC(handler, ALLOWED_ROLES), { route: '/api/dashboard/intelligence' });
