
/**
 * GET /api/admin/railway-company-costs
 *
 * Returns Railway compute costs broken down by:
 *  - Companies (tenants)
 *  - Activities within those companies (campaign, publishing, engagement, intelligence, etc.)
 *  - Cost proportions across the hierarchy
 *
 * This allows super-admins to see compute cost attribution at the business level.
 *
 * Query params:
 *   hours=24       — Time window (default 24)
 *   companyId=...  — Optional filter to single company
 *
 * Response:
 *   period         — Time window info
 *   total_cost_usd — Total compute cost across selected companies
 *   companies      — Array of company cost breakdowns
 *   activities     — Array of activity-level breakdown
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { getComputeMetricsReport } from '../../../lib/instrumentation/railwayComputeInstrumentation';

const requireSuperAdmin = async (
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<boolean> => {
  if (req.cookies?.super_admin_session === '1') return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

interface CompanyCostRow {
  company_id: string;
  total_cost_usd: number;
  cost_pct: number;
  total_calls: number;
  avg_duration_ms: number;
  activities: Array<{
    activity_type: string;
    cost_usd: number;
    cost_pct: number;
    calls: number;
    avg_duration_ms: number;
    top_features: Array<{ feature: string; cost_usd: number; calls: number }>;
  }>;
}

interface ActivitySummaryRow {
  activity_type: string;
  total_cost_usd: number;
  cost_pct: number;
  total_calls: number;
  avg_duration_ms: number;
  top_companies: Array<{ company_id: string; cost_usd: number; cost_pct: number }>;
  top_features: Array<{ feature: string; cost_usd: number; calls: number }>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const companyIdFilter = req.query.companyId as string | undefined;

    // Get metrics report with company/activity breakdown
    const report = await getComputeMetricsReport({
      time_window_hours: hours,
    });

    // Calculate total cost
    const totalCost = Object.values(report.byCompany).reduce((sum, c) => sum + c.estimated_cost_usd, 0);

    // Transform byCompany to response format
    const companies: CompanyCostRow[] = Object.entries(report.byCompany)
      .filter(([cId]) => !companyIdFilter || cId === companyIdFilter)
      .map(([companyId, companyData]) => {
        const activitiesArray = Object.entries(companyData.activities).map(([activityType, actData]) => ({
          activity_type: activityType,
          cost_usd: actData.estimated_cost_usd,
          cost_pct: totalCost > 0 ? (actData.estimated_cost_usd / totalCost) * 100 : 0,
          calls: actData.calls_total,
          avg_duration_ms: actData.avg_time_ms,
          top_features: actData.top_features.slice(0, 3),
        }));

        return {
          company_id: companyId,
          total_cost_usd: companyData.estimated_cost_usd,
          cost_pct: totalCost > 0 ? (companyData.estimated_cost_usd / totalCost) * 100 : 0,
          total_calls: companyData.calls_total,
          avg_duration_ms: companyData.avg_time_ms,
          activities: activitiesArray.sort((a, b) => b.cost_usd - a.cost_usd),
        };
      })
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    // Transform byActivity to response format
    const activities: ActivitySummaryRow[] = Object.entries(report.byActivity)
      .map(([activityType, actData]) => {
        // Find top companies for this activity
        const topCompanies = companies
          .flatMap((c) => c.activities.filter((a) => a.activity_type === activityType).map((a) => ({
            company_id: c.company_id,
            cost_usd: a.cost_usd,
            cost_pct: totalCost > 0 ? (a.cost_usd / totalCost) * 100 : 0,
          })))
          .sort((a, b) => b.cost_usd - a.cost_usd)
          .slice(0, 5);

        return {
          activity_type: activityType,
          total_cost_usd: actData.estimated_cost_usd,
          cost_pct: totalCost > 0 ? (actData.estimated_cost_usd / totalCost) * 100 : 0,
          total_calls: actData.calls_total,
          avg_duration_ms: actData.avg_time_ms,
          top_companies: topCompanies,
          top_features: actData.top_features.slice(0, 5),
        };
      })
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    // Estimate monthly cost
    const estimatedMonthlyCost = totalCost * 30;

    const response = {
      timestamp: new Date().toISOString(),
      period: {
        hours,
        start: report.period_start,
        end: report.period_end,
      },
      summary: {
        total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
        estimated_monthly_usd: Math.round(estimatedMonthlyCost * 1_000_000) / 1_000_000,
        total_requests: report.request_count,
        avg_duration_ms: report.avg_request_duration_ms,
        company_count: companies.length,
        activity_count: activities.length,
      },
      companies,
      activities,
      insights: generateInsights(companies, activities),
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[railway-company-costs] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function generateInsights(companies: CompanyCostRow[], activities: ActivitySummaryRow[]): string[] {
  const insights: string[] = [];

  // Insight 1: Top cost driver company
  if (companies.length > 0) {
    const topCompany = companies[0];
    insights.push(
      `Top cost driver: ${topCompany.company_id} @ ${topCompany.cost_pct.toFixed(1)}% of total compute cost`,
    );
  }

  // Insight 2: Top cost driver activity
  if (activities.length > 0) {
    const topActivity = activities[0];
    insights.push(
      `Most compute-intensive activity: ${topActivity.activity_type} @ ${topActivity.cost_pct.toFixed(1)}% of total`,
    );
  }

  // Insight 3: Cost concentration
  if (companies.length > 0) {
    const top3Cost = companies.slice(0, 3).reduce((sum, c) => sum + c.cost_pct, 0);
    if (top3Cost > 70) {
      insights.push(`⚠️ High cost concentration: Top 3 companies use ${top3Cost.toFixed(1)}% of compute`);
    }
  }

  // Insight 4: Activity distribution
  if (activities.length > 1) {
    const diversityScore = 100 / activities.length;
    const topActivityPct = activities[0].cost_pct;
    if (topActivityPct > 50) {
      insights.push(`Activity cost imbalance: ${activities[0].activity_type} dominates at ${topActivityPct.toFixed(1)}%`);
    }
  }

  // Insight 5: Per-company activity patterns
  const companiesWithManyActivities = companies.filter((c) => c.activities.length >= 3);
  if (companiesWithManyActivities.length > 0) {
    insights.push(
      `${companiesWithManyActivities.length} companies use 3+ activity types (well-distributed load)`,
    );
  }

  return insights;
}
