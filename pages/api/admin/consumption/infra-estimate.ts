import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

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
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { CONSUMPTION_VIEW_AGGREGATE } from '../../../../shared/contracts/security';
import { getSystemMetrics } from '../../../../lib/instrumentation/systemMetrics';
import { estimateCost } from '../../../../lib/instrumentation/costEngine';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const guard = await requireCapability(req, res, {
    capability: CONSUMPTION_VIEW_AGGREGATE,
    reason: 'consumption infra estimate',
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireSuperAdmin(req, res))) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/consumption/infra-estimate' });
