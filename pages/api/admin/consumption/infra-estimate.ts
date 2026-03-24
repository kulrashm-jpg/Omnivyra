/**
 * GET /api/admin/consumption/infra-estimate
 *
 * Returns the system-detected infrastructure cost estimate (from live metrics)
 * and the active org count — used by the Infra tab and All-Orgs table to
 * compute per-head cost allocation.
 *
 * Auth: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../../backend/services/rbacService';
import { getSystemMetrics } from '../../../../lib/instrumentation/systemMetrics';
import { estimateCost } from '../../../../lib/instrumentation/costEngine';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1') return true;
  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  } catch { /* deny */ }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

  // Active org count
  let activeOrgs = 0;
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { count } = await db.from('companies').select('id', { count: 'exact', head: true });
    activeOrgs = count ?? 0;
  } catch { /* fallback 0 */ }

  // System-estimated infra cost
  let estimate = { totalMonthlyEstimate: 0, breakdown: {} as Record<string, { estimatedMonthly: number }>, confidence: 'low' as const, warnings: [] as string[] };
  try {
    const metrics = await getSystemMetrics();
    const raw = estimateCost(metrics);
    estimate = {
      totalMonthlyEstimate: raw.totalMonthlyEstimate,
      breakdown: raw.breakdown as any,
      confidence: raw.confidence,
      warnings: raw.warnings,
    };
  } catch { /* fallback zeros */ }

  return res.status(200).json({
    totalMonthlyEstimate: estimate.totalMonthlyEstimate,
    breakdown: estimate.breakdown,
    confidence: estimate.confidence,
    warnings: estimate.warnings,
    activeOrgs,
    perHeadUsd: activeOrgs > 0 ? Math.round((estimate.totalMonthlyEstimate / activeOrgs) * 10000) / 10000 : 0,
  });
}
