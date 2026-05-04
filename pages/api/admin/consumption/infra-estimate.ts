
/**
 * GET /api/admin/consumption/infra-estimate
 *
 * Returns the system-detected infrastructure cost estimate (from live metrics)
 * and the active org count â€” used by the Infra tab and All-Orgs table to
 * compute per-head cost allocation.
 *
 * Auth: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { getSystemMetrics } from '../../../../lib/instrumentation/systemMetrics';
import { estimateCost } from '../../../../lib/instrumentation/costEngine';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireAdminScope(req, res, 'consumption:infra-estimate');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/consumption/infra-estimate', 'consumption:infra-estimate');
  }

  // Active org count
  let activeOrgs = 0;
  try {
    const { count } = await supabase.from('companies').select('id', { count: 'exact', head: true });
    activeOrgs = count ?? 0;
  } catch { /* fallback 0 */ }

  // System-estimated infra cost
  let estimate = { totalMonthlyEstimate: 0, breakdown: {} as Record<string, { estimatedMonthly: number }>, confidence: 'low' as 'low' | 'medium' | 'high', warnings: [] as string[] };
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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
