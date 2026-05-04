/**
 * GET /api/admin/system/health
 *
 * Super-admin-only operator dashboard. One round-trip snapshot of:
 *   - total_cost_today        (UTC day)
 *   - total_credits_today
 *   - global_margin
 *   - active_anomalies_count  (unacknowledged alerts)
 *   - high_risk_orgs          (is_high_risk=true)
 *   - blocked_orgs            (is_blocked=true)
 *
 * All reads hit unified_transactions + alerts + org_controls â€” the Phase 5
 * single source of truth. No legacy ledger queries here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  requireAdminRateLimit,
  requireAdminScope,
} from '../../../../backend/services/requestAccessService';
import { runWithServiceRole } from '../../../../backend/db/supabaseClient';
import { logger } from '../../../../backend/services/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:sys_health', 60, 60))) return;

  const ctx = await requireAdminScope(req, res, 'health:system');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/system/health', 'health:system');
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const startIso = dayStart.toISOString();

  try {
    const [today, alertsRes, highRiskRes, blockedRes] = await runWithServiceRole(
      'Read admin system health snapshot',
      (supabase) => Promise.all([
        supabase
          .from('unified_transactions')
          .select('api_cost_usd, credits_charged, credits_value_usd, margin_usd')
          .eq('final_attempt', true)
          .gte('created_at', startIso)
          .limit(50_000),
        supabase
          .from('alerts')
          .select('id', { count: 'exact', head: true })
          .eq('acknowledged', false),
        supabase
          .from('org_controls')
          .select('organization_id', { count: 'exact', head: true })
          .eq('is_high_risk', true),
        supabase
          .from('org_controls')
          .select('organization_id', { count: 'exact', head: true })
          .eq('is_blocked', true),
      ]),
    );

    let totalCost    = 0;
    let totalCredits = 0;
    let totalCreditsValue = 0;
    let marginSum    = 0;
    for (const row of ((today.data ?? []) as Array<{
      api_cost_usd: number | null;
      credits_charged: number | null;
      credits_value_usd: number | null;
      margin_usd: number | null;
    }>)) {
      totalCost         += Number(row.api_cost_usd      ?? 0);
      totalCredits      += Number(row.credits_charged   ?? 0);
      totalCreditsValue += Number(row.credits_value_usd ?? 0);
      marginSum         += Number(row.margin_usd        ?? 0);
    }

    return res.status(200).json({
      as_of:                 new Date().toISOString(),
      day_start_utc:         startIso,
      total_cost_today:      Number(totalCost.toFixed(6)),
      total_credits_today:   totalCredits,
      credits_value_today:   Number(totalCreditsValue.toFixed(6)),
      global_margin:         Number(marginSum.toFixed(6)),
      active_anomalies_count: alertsRes.count ?? 0,
      high_risk_orgs:        highRiskRes.count ?? 0,
      blocked_orgs:          blockedRes.count ?? 0,
    });
  } catch (err: any) {
    logger.error('admin_sys_health_failed', { message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
