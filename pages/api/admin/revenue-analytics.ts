/**
 * GET /api/admin/revenue-analytics
 *
 * Super-admin endpoint returning aggregated revenue metrics:
 *   - Per-org monthly credit consumption vs revenue
 *   - Gross margin (revenue - estimated LLM cost)
 *   - Top action types by credit volume
 *   - Month-over-month trend (last 3 months)
 *
 * Auth: requireSuperAdmin (JWT-based, profiles.is_super_admin)
 *
 * Query params:
 *   ?year=2026&month=3        — specific month (default: current)
 *   ?org_id=<uuid>            — single org (default: all)
 *   ?limit=50                 — max orgs returned (default: 50)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireSuperAdmin } from '../../../backend/middleware/authMiddleware';

export type RevenueMetricRow = {
  organization_id: string;
  period_year: number;
  period_month: number;
  credits_consumed: number;
  credits_purchased: number;
  usd_revenue: number;
  estimated_llm_cost_usd: number;
  gross_margin_usd: number;
  top_action_type: string | null;
  top_action_credits: number;
  action_breakdown: Record<string, number>;
  computed_at: string;
};

export type RevenueAnalyticsResponse = {
  period: { year: number; month: number };
  total_credits_consumed: number;
  total_credits_purchased: number;
  total_usd_revenue: number;
  total_estimated_llm_cost: number;
  total_gross_margin: number;
  orgs_count: number;
  rows: RevenueMetricRow[];
  trend: Array<{ year: number; month: number; total_consumed: number; total_revenue: number }>;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  // ── Auth: super-admin only ────────────────────────────────────────────────
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  const now   = new Date();
  const year  = parseInt(req.query.year  as string || String(now.getFullYear()), 10);
  const month = parseInt(req.query.month as string || String(now.getMonth() + 1), 10);
  const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
  const orgId = req.query.org_id as string | undefined;

  try {
    // ── Current period rows ───────────────────────────────────────────────
    let query = supabase
      .from('revenue_metrics')
      .select('*')
      .eq('period_year', year)
      .eq('period_month', month)
      .order('credits_consumed', { ascending: false })
      .limit(limit);

    if (orgId) query = query.eq('organization_id', orgId);

    const { data: rows, error } = await query;
    if (error) throw error;

    const metrics = (rows ?? []) as RevenueMetricRow[];

    // ── Aggregates ────────────────────────────────────────────────────────
    const totals = metrics.reduce(
      (acc, r) => ({
        consumed:  acc.consumed  + (r.credits_consumed           ?? 0),
        purchased: acc.purchased + (r.credits_purchased          ?? 0),
        revenue:   acc.revenue   + (r.usd_revenue                ?? 0),
        llm_cost:  acc.llm_cost  + (r.estimated_llm_cost_usd     ?? 0),
        margin:    acc.margin    + (r.gross_margin_usd            ?? 0),
      }),
      { consumed: 0, purchased: 0, revenue: 0, llm_cost: 0, margin: 0 },
    );

    // ── 3-month trend ─────────────────────────────────────────────────────
    const trendMonths: Array<{ year: number; month: number }> = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      trendMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const uniqueYears = [...new Set(trendMonths.map(m => m.year))];
    const minMonth    = Math.min(...trendMonths.map(m => m.month));

    const { data: trendRows } = await supabase
      .from('revenue_metrics')
      .select('period_year, period_month, credits_consumed, usd_revenue')
      .in('period_year', uniqueYears)
      .gte('period_month', minMonth);

    const trend = trendMonths.map(({ year: y, month: m }) => {
      const periodRows = (trendRows ?? []) as Array<{
        period_year: number; period_month: number; credits_consumed: number; usd_revenue: number;
      }>;
      const filtered = periodRows.filter(r => r.period_year === y && r.period_month === m);
      return {
        year:           y,
        month:          m,
        total_consumed: filtered.reduce((s, r) => s + (r.credits_consumed ?? 0), 0),
        total_revenue:  filtered.reduce((s, r) => s + (r.usd_revenue       ?? 0), 0),
      };
    });

    return res.status(200).json({
      period: { year, month },
      total_credits_consumed:   totals.consumed,
      total_credits_purchased:  totals.purchased,
      total_usd_revenue:        totals.revenue,
      total_estimated_llm_cost: totals.llm_cost,
      total_gross_margin:       totals.margin,
      orgs_count:               metrics.length,
      rows:                     metrics,
      trend,
    } satisfies RevenueAnalyticsResponse);
  } catch (err: any) {
    console.error('[revenue-analytics]', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
