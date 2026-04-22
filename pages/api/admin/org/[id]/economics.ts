/**
 * GET /api/admin/org/:id/economics
 *
 * Super-admin-only. Returns 28-day cost/credit/margin summary for one org,
 * with breakdown by action / model / source_type.
 *
 * Query params:
 *   ?days=N  — override the window (default 28, max 90)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../../../backend/services/rbacService';
import {
  requireAdminRateLimit,
  requireAuthenticatedInternalUser,
} from '../../../../../backend/services/requestAccessService';
import { getOrgCostSummary } from '../../../../../backend/services/orgCostSummaryService';
import { supabase } from '../../../../../backend/db/supabaseClient';
import { logger } from '../../../../../backend/services/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireAdminRateLimit(req, res, 'rl:admin:org_econ', 60, 60))) return;

  const user = await requireAuthenticatedInternalUser(req, res);
  if (!user) return;
  if (!(await isPlatformSuperAdmin(user.id)) && !(await isSuperAdmin(user.id))) {
    return res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED' });
  }

  const orgId = String(req.query.id ?? '').trim();
  if (!orgId) return res.status(400).json({ error: 'org id required' });

  const daysParam = Number(req.query.days);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 28;

  const end   = new Date();
  const start = new Date(end.getTime() - days * 86400 * 1000);

  try {
    const [summary, controlsRes] = await Promise.all([
      getOrgCostSummary(orgId, start.toISOString(), end.toISOString()),
      supabase
        .from('org_controls')
        .select('is_blocked, blocked_reason, is_high_risk, high_risk_reason, daily_credit_limit, updated_at')
        .eq('organization_id', orgId)
        .maybeSingle(),
    ]);

    return res.status(200).json({
      organization_id:    orgId,
      window_days:        days,
      total_cost:         summary.total_api_cost_usd,
      total_credits:      summary.total_credits_used,
      credits_value_usd:  summary.credits_value_usd,
      margin:             summary.margin_usd,
      is_negative_margin: summary.is_negative_margin,
      top_actions:        summary.breakdown.by_action.slice(0, 10),
      top_models:         summary.breakdown.by_model.slice(0, 10),
      by_source:          summary.breakdown.by_source,
      controls:           controlsRes.data ?? null,
    });
  } catch (err: any) {
    logger.error('admin_org_econ_failed', { orgId, message: err?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
