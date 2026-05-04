/**
 * GET /api/admin/pricing/recommendations
 *
 * Super-admin-only read endpoint. Returns the latest pricing_intelligence
 * row per (action_key, model_name), joined with the current pending
 * pricing_adjustment_queue proposal (if any).
 *
 * Query params (optional):
 *   ?onlyDeviations=true    â€” return only rows with deviation_flag=true
 *   ?week=YYYY-MM-DD        â€” pin to a specific ISO-week Monday; default = latest
 *
 * Auth: super-admin via requireAuthenticatedInternalUser + RBAC.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../../backend/services/requestAccessService';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logger } from '../../../../backend/services/logger';

interface IntelligenceRow {
  action_key:              string;
  model_name:              string | null;
  week_start:              string;
  total_api_cost_usd:      number;
  total_credits_value_usd: number;
  margin_usd:              number;
  margin_percent:          number | null;
  current_multiplier:      number;
  recommended_multiplier:  number | null;
  deviation_flag:          boolean;
  event_count:             number;
}

interface QueueRow {
  id:                  string;
  action_key:          string;
  model_name:          string | null;
  current_multiplier:  number;
  proposed_multiplier: number;
  margin_percent:      number | null;
  reason:              string;
  status:              string;
  source_week:         string | null;
  created_at:          string;
}

async function resolveLatestWeek(): Promise<string | null> {
  const { data, error } = await supabase
    .from('pricing_intelligence')
    .select('week_start')
    .order('week_start', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return (data[0] as any).week_start as string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:pricing_recommendations', 60, 60))) return;

  const ctx = await requireAdminScope(req, res, 'pricing:recommendations');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/pricing/recommendations', 'pricing:recommendations');
  }

  const onlyDeviations = String(req.query.onlyDeviations ?? '').toLowerCase() === 'true';
  const weekParam = typeof req.query.week === 'string' && req.query.week.trim()
    ? req.query.week.trim()
    : null;

  try {
    const week = weekParam ?? (await resolveLatestWeek());
    if (!week) {
      return res.status(200).json({
        week: null,
        rows: [],
        note:  'No pricing_intelligence rows exist yet. Run runWeeklyPricingAnalysis.',
      });
    }

    let intelQuery = supabase
      .from('pricing_intelligence')
      .select('action_key, model_name, week_start, total_api_cost_usd, total_credits_value_usd, margin_usd, margin_percent, current_multiplier, recommended_multiplier, deviation_flag, event_count')
      .eq('week_start', week)
      .order('total_api_cost_usd', { ascending: false });

    if (onlyDeviations) intelQuery = intelQuery.eq('deviation_flag', true);

    const { data: intelRows, error: intelErr } = await intelQuery;
    if (intelErr) {
      logger.error('admin_pricing_recs_intel_failed', { message: intelErr.message });
      return res.status(500).json({ error: 'Failed to load pricing intelligence' });
    }
    const intel = (intelRows ?? []) as IntelligenceRow[];

    // Load ALL pending queue rows once; join in JS (small n).
    const { data: queueRows } = await supabase
      .from('pricing_adjustment_queue')
      .select('id, action_key, model_name, current_multiplier, proposed_multiplier, margin_percent, reason, status, source_week, created_at')
      .eq('status', 'pending');

    const queueByKey = new Map<string, QueueRow>();
    for (const q of ((queueRows ?? []) as QueueRow[])) {
      const key = `${q.action_key}|${q.model_name ?? '__null__'}`;
      queueByKey.set(key, q);
    }

    const response = intel.map((row) => {
      const key = `${row.action_key}|${row.model_name ?? '__null__'}`;
      const pending = queueByKey.get(key) ?? null;
      return {
        action_key:              row.action_key,
        model_name:              row.model_name,
        week_start:              row.week_start,
        total_api_cost_usd:      Number(row.total_api_cost_usd),
        total_credits_value_usd: Number(row.total_credits_value_usd),
        margin_usd:              Number(row.margin_usd),
        margin_percent:          row.margin_percent == null ? null : Number(row.margin_percent),
        current_multiplier:      Number(row.current_multiplier),
        recommended_multiplier:  row.recommended_multiplier == null ? null : Number(row.recommended_multiplier),
        deviation_flag:          row.deviation_flag,
        event_count:             row.event_count,
        pending_proposal:        pending
          ? {
              id:                  pending.id,
              proposed_multiplier: Number(pending.proposed_multiplier),
              reason:              pending.reason,
              source_week:         pending.source_week,
              created_at:          pending.created_at,
            }
          : null,
      };
    });

    return res.status(200).json({
      week,
      count: response.length,
      rows:  response,
    });
  } catch (err: any) {
    logger.error('admin_pricing_recs_failed', { message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
