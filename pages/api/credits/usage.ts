import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as sb } from '@/backend/db/supabaseClient';
import { withOrgAccess } from '../../../backend/middleware/withOrgAccess';
import { logger } from '../../../backend/services/logger';

export interface ActionBreakdown {
  action: string;
  credits: number;
  count: number;
}

export interface DailyUsage {
  date: string;
  credits: number;
}

export interface CreditUsageResponse {
  period: {
    from: string;
    to: string;
  };
  by_action: ActionBreakdown[];
  top_5: ActionBreakdown[];
  daily: DailyUsage[];
  total_credits: number;
  total_events: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  const daysParam = parseInt((req.query.days as string) ?? '30', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 30;

  try {
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400_000);

    const { data, error } = await sb
      .from('credit_usage_log')
      .select('action, credits_used, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as Array<{ action: string; credits_used: number; created_at: string }>;
    const actionMap: Record<string, ActionBreakdown> = {};
    for (const row of rows) {
      const key = row.action ?? 'unknown';
      if (!actionMap[key]) actionMap[key] = { action: key, credits: 0, count: 0 };
      actionMap[key].credits += row.credits_used ?? 0;
      actionMap[key].count += 1;
    }

    const byAction = Object.values(actionMap).sort((a, b) => b.credits - a.credits);
    const top5 = byAction.slice(0, 5);

    const dailyMap: Record<string, number> = {};
    for (const row of rows) {
      const day = row.created_at.slice(0, 10);
      dailyMap[day] = (dailyMap[day] ?? 0) + (row.credits_used ?? 0);
    }

    const daily: DailyUsage[] = [];
    for (let d = 0; d < days; d += 1) {
      const date = new Date(from.getTime() + d * 86400_000).toISOString().slice(0, 10);
      daily.push({ date, credits: dailyMap[date] ?? 0 });
    }

    const body: CreditUsageResponse = {
      period: { from: from.toISOString(), to: now.toISOString() },
      by_action: byAction,
      top_5: top5,
      daily,
      total_credits: rows.reduce((sum, row) => sum + (row.credits_used ?? 0), 0),
      total_events: rows.length,
    };

    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json(body);
  } catch (err: any) {
    logger.error('credits_usage_failed', { orgId, message: err?.message ?? 'unknown' });
    return res.status(500).json({ error: err?.message });
  }
}

export default withOrgAccess(handler);
