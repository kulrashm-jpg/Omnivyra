import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/super-admin/free-credits/summary
 * KPI cards: total credits given, pending requests, manual grants, claims.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';

// 2026-11-11: platform VIEW capability; requireCapability answers 401/403 itself.
// The legacy super-admin cookie arm is gone.
async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: '/api/super-admin/free-credits/summary read',
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireSuperAdmin(req, res)) return;

  const { data: summary, error } = await supabase.rpc('free_credits_summary');
  if (error) return res.status(500).json({ error: error.message });

  // Category breakdown from free_credit_claims
  const { data: byCategory } = await supabase
    .from('free_credit_claims')
    .select('category, credits_granted')
    .order('category');

  const categoryTotals: Record<string, number> = {};
  for (const row of byCategory ?? []) {
    categoryTotals[row.category] = (categoryTotals[row.category] ?? 0) + row.credits_granted;
  }

  // Monthly trend (last 6 months) from credit_transactions
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: monthlyTx } = await supabase
    .from('credit_transactions')
    .select('created_at, credits_delta')
    .eq('reference_type', 'free_credits')
    .gte('created_at', sixMonthsAgo.toISOString())
    .order('created_at');

  const monthly: Record<string, number> = {};
  for (const tx of monthlyTx ?? []) {
    const key = tx.created_at.slice(0, 7); // 'YYYY-MM'
    monthly[key] = (monthly[key] ?? 0) + Math.abs(tx.credits_delta ?? 0);
  }

  return res.status(200).json({
    summary: summary?.[0] ?? {},
    categoryTotals,
    monthlyTrend: monthly,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/free-credits/summary' });
