/**
 * GET /api/super-admin/free-credits/summary
 * KPI cards: total credits given, pending requests, manual grants, claims.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1' || isContentArchitectSession(req)) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
