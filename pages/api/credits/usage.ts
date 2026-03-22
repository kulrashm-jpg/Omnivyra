/**
 * GET /api/credits/usage?org_id=<uuid>[&days=30]
 *
 * Credit usage insights for dashboard charts.
 *
 * Returns:
 *   period        — ISO date range covered
 *   by_action     — credits + event count per action_type, sorted by credits desc
 *   top_5         — top 5 actions by credits consumed
 *   daily         — day-by-day credit consumption (for time-series charts)
 *   total_credits — sum of all credits used in the period
 *   total_events  — number of usage events in the period
 *
 * Source: credit_usage_log (confirm-phase events only — no holds/releases)
 *
 * Auth: Bearer token (Supabase user session) OR super_admin_session cookie.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// ── Response type ─────────────────────────────────────────────────────────────

export interface ActionBreakdown {
  action:  string;
  credits: number;
  count:   number;
}

export interface DailyUsage {
  date:    string;  // YYYY-MM-DD
  credits: number;
}

export interface CreditUsageResponse {
  period: {
    from: string;  // ISO
    to:   string;  // ISO
  };
  by_action:     ActionBreakdown[];   // all actions, sorted by credits desc
  top_5:         ActionBreakdown[];   // top 5 subset
  daily:         DailyUsage[];        // one entry per calendar day in range
  total_credits: number;
  total_events:  number;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const orgId = req.query.org_id as string;
  if (!orgId) return res.status(400).json({ error: 'org_id required' });

  // days param — default 30, max 90
  const daysParam = parseInt((req.query.days as string) ?? '30', 10);
  const days      = Number.isFinite(daysParam) && daysParam > 0
    ? Math.min(daysParam, 90)
    : 30;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const isSuperAdminCookie = req.cookies?.super_admin_session === '1';
  if (!isSuperAdminCookie) {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const now  = new Date();
    const from = new Date(now.getTime() - days * 86400_000);

    // ── Single query — only columns needed for aggregation ─────────────────
    // Pulls all rows for the org in the window; aggregation in JS.
    // Row count per org is bounded (one per credit spend) — safe to hydrate.
    const { data, error } = await sb
      .from('credit_usage_log')
      .select('action, credits_used, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      action:      string;
      credits_used: number;
      created_at:  string;
    }>;

    // ── Aggregate by action ────────────────────────────────────────────────
    const actionMap: Record<string, ActionBreakdown> = {};
    for (const row of rows) {
      const key = row.action ?? 'unknown';
      if (!actionMap[key]) actionMap[key] = { action: key, credits: 0, count: 0 };
      actionMap[key].credits += row.credits_used ?? 0;
      actionMap[key].count   += 1;
    }

    const byAction = Object.values(actionMap).sort((a, b) => b.credits - a.credits);
    const top5     = byAction.slice(0, 5);

    // ── Aggregate by calendar day (UTC) ───────────────────────────────────
    const dailyMap: Record<string, number> = {};
    for (const row of rows) {
      const day = row.created_at.slice(0, 10); // YYYY-MM-DD
      dailyMap[day] = (dailyMap[day] ?? 0) + (row.credits_used ?? 0);
    }

    // Fill every day in the window with 0 if no usage — gives charts clean x-axis
    const daily: DailyUsage[] = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(from.getTime() + d * 86400_000)
        .toISOString()
        .slice(0, 10);
      daily.push({ date, credits: dailyMap[date] ?? 0 });
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    const totalCredits = rows.reduce((s, r) => s + (r.credits_used ?? 0), 0);
    const totalEvents  = rows.length;

    const body: CreditUsageResponse = {
      period:        { from: from.toISOString(), to: now.toISOString() },
      by_action:     byAction,
      top_5:         top5,
      daily,
      total_credits: totalCredits,
      total_events:  totalEvents,
    };

    res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json(body);

  } catch (err: any) {
    console.error('[credits/usage]', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
