/**
 * GET /api/admin/railway-efficiency
 *
 * Returns Railway compute cost intelligence for the Super Admin dashboard.
 *
 * Query params:
 *   hours=24       — Time window (default 24)
 *   feature=...    — Filter by feature
 *
 * Response:
 *   overview       — Total cost, avg request time, request count
 *   topExpensive   — Feature costs breakdown
 *   bySourceType   — API vs Queue vs Cron breakdown
 *   apiEndpoints   — Drill-down into slowest/most-called endpoints
 *   queueJobs      — Drill-down into queue job costs
 *   cronJobs       — Drill-down into cron job costs
 *   insights       — Generated optimization recommendations
 *   controls       — Available optimization actions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const feature = req.query.feature as string | undefined;

    // Get main report
    const report = await getComputeMetricsReport({
      time_window_hours: hours,
      feature: feature,
    });

    // Drill-down data: extract endpoint details
    
    // For API endpoints: query from system_health_metrics if tracking is in place
    // Otherwise, construct from report
    const apiEndpoints = Object.entries(report.byFeature)
      .map(([featureName, data]) => ({
        feature: featureName,
        endpoint: featureName, // Real impl would track actual routes
        avg_time_ms: data.avg_time_ms,
        calls: data.calls_total,
        cost: data.estimated_cost_usd,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    // Queue and cron jobs come from bySourceType
    const queueData = report.bySourceType.queue || { examples: [], calls: 0 };
    const cronData = report.bySourceType.cron || { examples: [], calls: 0 };

    // Generate control actions
    const controls: any[] = [];

    // If any feature > 30% cost, suggest caching
    const topFeature = report.topExpensive[0];
    if (topFeature && topFeature.cost_pct > 30) {
      controls.push({
        id: 'cache_feature',
        title: `Cache ${topFeature.feature}`,
        description: `${topFeature.feature} is ${Math.round(topFeature.cost_pct)}% of compute cost. Add caching to reduce calls.`,
        estimated_savings_pct: 20,
        difficulty: 'medium',
      });
    }

    // If avg duration > 1s, suggest optimization
    if (report.avg_request_duration_ms > 1000) {
      controls.push({
        id: 'optimize_slow_requests',
        title: 'Optimize Slow Requests',
        description: `Average request duration is ${Math.round(report.avg_request_duration_ms)}ms. Check for N+1 queries or inefficient algorithms.`,
        estimated_savings_pct: 15,
        difficulty: 'hard',
      });
    }

    // Cron job frequency control
    if (cronData.calls && cronData.calls > 100) {
      controls.push({
        id: 'reduce_cron_frequency',
        title: 'Reduce Cron Job Frequency',
        description: `Running ${cronData.calls} cron executions in this period. Consider increasing intervals.`,
        estimated_savings_pct: 25,
        difficulty: 'easy',
      });
    }

    // Estimate total monthly cost (simplistic)
    const estimatedMonthlyCost = (report.topExpensive.reduce((sum, f) => {
      const featureData = report.byFeature[f.feature];
      if (!featureData) return sum;
      // Extrapolate from 24h to 30 days
      return sum + (featureData.estimated_cost_usd * 30);
    }, 0));

    const response = {
      timestamp: new Date().toISOString(),
      period_hours: hours,
      period_start: report.period_start,
      period_end: report.period_end,

      // Overview
      overview: {
        total_cost_usd: report.topExpensive.reduce((sum, f) => {
          const featureData = report.byFeature[f.feature];
          return sum + (featureData?.estimated_cost_usd || 0);
        }, 0),
        estimated_monthly_cost_usd: estimatedMonthlyCost,
        total_compute_time_hours: (report.total_time_ms / 1000 / 3600).toFixed(2),
        avg_request_duration_ms: report.avg_request_duration_ms,
        total_requests: report.request_count,
      },

      // Top expensive features
      topExpensive: report.topExpensive.map((item) => ({
        ...item,
        cost_usd: report.byFeature[item.feature]?.estimated_cost_usd ?? 0,
      })),

      // Breakdown by source type
      bySourceType: {
        api: report.bySourceType.api || { cost_pct: 0, cost_usd: 0, calls: 0 },
        queue: report.bySourceType.queue || { cost_pct: 0, cost_usd: 0, calls: 0 },
        cron: report.bySourceType.cron || { cost_pct: 0, cost_usd: 0, calls: 0 },
      },

      // Drill-down sections
      apiEndpoints: apiEndpoints.slice(0, 10),
      queueJobs: queueData.examples || [],
      cronJobs: cronData.examples || [],

      // Insights
      insights: report.insights,

      // Control actions
      controls: controls,

      // Features ref (for UI)
      allFeatures: Object.keys(report.byFeature),
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('[railway-efficiency] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
