
/**
 * GET /api/admin/cost-accounting
 * Comprehensive cost accounting dashboard combining usage costs, infrastructure costs, and trends
 * Auth: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';

interface ActivityCost {
  activity_type: string;
  total_cost_usd: number;
  cost_pct: number;
  usage_volume: number;
  unit_cost: number;
  companies: Array<{ company_id: string; cost_usd: number; cost_pct: number; usage_volume: number }>;
  top_models?: Array<{ model_name: string; cost_usd: number; cost_pct: number; tokens: number }>;
}

interface CostAccountingResponse {
  period: { name: string; start_date: string; end_date: string; days: number };
  summary: {
    total_monthly_cost_usd: number;
    usage_pct: number;
    system_pct: number;
    daily_run_rate_usd: number;
    projected_monthly_usd: number;
    top_cost_driver: { category: string; name: string; cost_usd: number; cost_pct: number };
  };
  usage_costs: {
    total_usd: number;
    by_activity: ActivityCost[];
    by_company: Array<{
      company_id: string;
      total_cost_usd: number;
      cost_pct: number;
      activities: Array<{ activity_type: string; cost_usd: number; cost_pct: number; usage_volume: number }>;
    }>;
  };
  infrastructure_costs: {
    total_usd: number;
    services: Array<{
      service_name: string;
      monthly_cost_usd: number;
      cost_pct: number;
      details: Record<string, number>;
      notes: string[];
    }>;
  };
  cost_drivers: Array<{ rank: number; category: string; description: string; impact_usd: number; impact_pct: number }>;
  comparison?: { previous_period_total: number; period_over_period_pct: number; trend: 'up' | 'down' | 'flat' };
}

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  } catch {}
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

function getPeriodDates(period: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const start = new Date();
  let label = '';

  switch (period) {
    case 'last_month':
      start.setMonth(now.getMonth() - 1);
      start.setDate(1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      label = `${start.toLocaleDateString()} - ${lastMonthEnd.toLocaleDateString()}`;
      return { start, end: lastMonthEnd, label };
    case 'last_3mo':
      start.setMonth(now.getMonth() - 3);
      start.setDate(1);
      const threeMonthsEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      label = `${start.toLocaleDateString()} - ${threeMonthsEnd.toLocaleDateString()}`;
      return { start, end: threeMonthsEnd, label };
    case 'this_month':
    default:
      start.setDate(1);
      label = `${start.toLocaleDateString()} - ${now.toLocaleDateString()}`;
      return { start, end: now, label };
  }
}

function mapProcessTypeToActivity(processType: string): string {
  const map: Record<string, string> = {
    generateCampaignPlan: 'campaign_planning',
    generateDailyPlan: 'campaign_planning',
    generateRecommendation: 'campaign_planning',
    optimizeWeek: 'campaign_planning',
    publishPost: 'publishing',
    schedulePost: 'publishing',
    generateContentForDay: 'content_generation',
    regenerateContent: 'content_generation',
    moderateChatMessage: 'engagement',
    generateInsight: 'intelligence',
  };
  return map[processType] || 'other';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<CostAccountingResponse | { error: string }>) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    const period = (req.query.period as string) || 'this_month';
    const { start, end, label } = getPeriodDates(period);

    // Fetch usage events
    const { data: usageEvents } = await supabase
      .from('usage_events')
      .select('organization_id, process_type, model_name, total_tokens, total_cost, source_type')
      .eq('source_type', 'llm')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());

    // Aggregate by activity
    const activityMap = new Map<string, any>();
    const companyMap = new Map<string, any>();
    let totalUsageCost = 0;

    for (const evt of usageEvents || []) {
      const activity = mapProcessTypeToActivity(evt.process_type || '');
      const cost = Number(evt.total_cost) || 0;
      const tokens = Number(evt.total_tokens) || 0;
      const company = evt.organization_id;
      const model = evt.model_name || 'unknown';

      totalUsageCost += cost;

      // Activity
      if (!activityMap.has(activity)) {
        activityMap.set(activity, {
          total_cost: 0,
          tokens: 0,
          calls: 0,
          companies: new Map(),
          models: new Map(),
        });
      }
      const agg = activityMap.get(activity);
      agg.total_cost += cost;
      agg.tokens += tokens;
      agg.calls += 1;
      if (!agg.companies.has(company)) agg.companies.set(company, { cost: 0, tokens: 0 });
      const cagg = agg.companies.get(company);
      cagg.cost += cost;
      cagg.tokens += tokens;
      if (!agg.models.has(model)) agg.models.set(model, { cost: 0, tokens: 0 });
      const magg = agg.models.get(model);
      magg.cost += cost;
      magg.tokens += tokens;

      // Company
      if (!companyMap.has(company)) companyMap.set(company, { cost: 0, tokens: 0, activities: new Map() });
      const cagg2 = companyMap.get(company);
      cagg2.cost += cost;
      cagg2.tokens += tokens;
      if (!cagg2.activities.has(activity)) cagg2.activities.set(activity, { cost: 0, tokens: 0, calls: 0 });
      const act = cagg2.activities.get(activity);
      act.cost += cost;
      act.tokens += tokens;
      act.calls += 1;
    }

    const by_activity: ActivityCost[] = Array.from(activityMap.entries())
      .map(([activity, agg]) => ({
        activity_type: activity,
        total_cost_usd: Math.round(agg.total_cost * 100) / 100,
        cost_pct: totalUsageCost > 0 ? Math.round((agg.total_cost / totalUsageCost) * 10000) / 100 : 0,
        companies: Array.from(agg.companies.entries())
          .map(([cid, c]) => ({
            company_id: cid,
            cost_usd: Math.round(c.cost * 100) / 100,
            cost_pct: agg.total_cost > 0 ? Math.round((c.cost / agg.total_cost) * 10000) / 100 : 0,
            usage_volume: c.tokens,
          }))
          .sort((a, b) => b.cost_usd - a.cost_usd),
        top_models: Array.from(agg.models.entries())
          .map(([model, m]) => ({
            model_name: model,
            cost_usd: Math.round(m.cost * 100) / 100,
            cost_pct: agg.total_cost > 0 ? Math.round((m.cost / agg.total_cost) * 10000) / 100 : 0,
            tokens: m.tokens,
          }))
          .sort((a, b) => b.cost_usd - a.cost_usd)
          .slice(0, 3),
        usage_volume: agg.tokens,
        unit_cost: agg.tokens > 0 ? agg.total_cost / agg.tokens : 0,
      }))
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    const by_company = Array.from(companyMap.entries())
      .map(([cid, c]) => ({
        company_id: cid,
        total_cost_usd: Math.round(c.cost * 100) / 100,
        cost_pct: totalUsageCost > 0 ? Math.round((c.cost / totalUsageCost) * 10000) / 100 : 0,
        activities: Array.from(c.activities.entries())
          .map(([act, a]) => ({
            activity_type: act,
            cost_usd: Math.round(a.cost * 100) / 100,
            cost_pct: c.cost > 0 ? Math.round((a.cost / c.cost) * 10000) / 100 : 0,
            usage_volume: a.tokens,
          }))
          .sort((a, b) => b.cost_usd - a.cost_usd),
      }))
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    // Infrastructure costs
    const infraServices = [
      { name: 'Supabase', cost: 55, breakdown: { base: 25, compute: 30 }, notes: ['Pro plan + compute'] },
      { name: 'Redis', cost: 10, breakdown: { storage: 5, ops: 5 }, notes: ['Upstash pay-as-you-go'] },
      { name: 'Railway', cost: Math.max(0, (1 * 0.000463 + 0.5 * 0.000231) * 730 - 5), breakdown: { cpu: 0.34, memory: 0.17, hobby: -5 }, notes: ['Workers and cron'] },
      { name: 'Vercel', cost: 20, breakdown: { base: 20 }, notes: ['Pro plan'] },
    ];
    const totalSystemCost = infraServices.reduce((sum, s) => sum + s.cost, 0);

    // Cost drivers
    const costDrivers: CostAccountingResponse['cost_drivers'] = [];
    if (by_activity.length > 0) {
      costDrivers.push({
        rank: 1,
        category: 'Activity',
        description: `${by_activity[0].activity_type} drives ${by_activity[0].cost_pct}% of usage costs`,
        impact_usd: by_activity[0].total_cost_usd,
        impact_pct: by_activity[0].cost_pct,
      });
    }

    // Summary
    const totalCost = totalUsageCost + totalSystemCost;
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const dailyRunRate = daysDiff > 0 ? totalCost / daysDiff : 0;
    const monthlyProjection = dailyRunRate * 30;

    const topDriver =
      by_activity.length > 0
        ? { category: 'activity', name: by_activity[0].activity_type, cost_usd: by_activity[0].total_cost_usd, cost_pct: by_activity[0].cost_pct }
        : { category: 'infrastructure', name: 'System', cost_usd: totalSystemCost, cost_pct: totalCost > 0 ? (totalSystemCost / totalCost) * 100 : 0 };

    const response: CostAccountingResponse = {
      period: { name: label, start_date: start.toISOString(), end_date: end.toISOString(), days: daysDiff },
      summary: {
        total_monthly_cost_usd: Math.round(totalCost * 100) / 100,
        usage_pct: totalCost > 0 ? Math.round((totalUsageCost / totalCost) * 10000) / 100 : 0,
        system_pct: totalCost > 0 ? Math.round((totalSystemCost / totalCost) * 10000) / 100 : 0,
        daily_run_rate_usd: Math.round(dailyRunRate * 100) / 100,
        projected_monthly_usd: Math.round(monthlyProjection * 100) / 100,
        top_cost_driver: topDriver,
      },
      usage_costs: {
        total_usd: Math.round(totalUsageCost * 100) / 100,
        by_activity,
        by_company,
      },
      infrastructure_costs: {
        total_usd: Math.round(totalSystemCost * 100) / 100,
        services: infraServices.map((s) => ({
          service_name: s.name,
          monthly_cost_usd: Math.round(s.cost * 100) / 100,
          cost_pct: totalSystemCost > 0 ? Math.round(Math.max(0, s.cost) / totalSystemCost * 10000) / 100 : 0,
          details: s.breakdown,
          notes: s.notes,
        })),
      },
      cost_drivers: costDrivers,
    };

    res.status(200).json(response);
  } catch (error: any) {
    console.error('[cost-accounting]', error?.message ?? error);
    res.status(500).json({ error: 'Failed to calculate cost accounting' });
  }
}
