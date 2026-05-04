
/**
 * GET /api/super-admin/free-credits/summary
 * KPI cards: total credits given, pending requests, manual grants, claims.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isContentArchitectSession(req)) {
    const ctx = await requireAdminScope(req, res, 'credits:view');
    if (!ctx) return;
  }

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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
