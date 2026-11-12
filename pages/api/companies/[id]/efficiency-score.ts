import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/companies/[id]/efficiency-score
 * Returns the company's efficiency tier, INFORMATIONAL ONLY (e9 ruling, 2026-11-12).
 *
 * The tier's discount_multiplier is NOT applied to any charge: its only reader,
 * creditPriorityEngine, has no callers. So this route does not return it, and
 * says so with `applied_to_pricing: false`. Do not re-add the multiplier here
 * until a charge path actually applies it (go-live gate: determineTier fixed first).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { resolveCompanyAccess } from '../../../../backend/services/contentArchitectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const companyId = req.query.id as string;

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const { data, error } = await supabase
      .from('credit_efficiency_scores')
      .select('efficiency_tier, credits_per_outcome_avg, credits_saved_total, total_outcomes, computed_at')
      .eq('organization_id', companyId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(200).json({
      efficiency_tier: 'standard',
      credits_per_outcome_avg: 0,
      credits_saved_total: 0,
      total_outcomes: 0,
      applied_to_pricing: false,
    });

    // Built field by field (not the row as read), so a discount column can never leak through.
    const row = data as Record<string, unknown>;
    return res.status(200).json({
      efficiency_tier: row.efficiency_tier,
      credits_per_outcome_avg: row.credits_per_outcome_avg,
      credits_saved_total: row.credits_saved_total,
      total_outcomes: row.total_outcomes,
      computed_at: row.computed_at,
      applied_to_pricing: false,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
// AUTH-ENFORCEMENT Phase 1 (Task 3b Batch 1): declarative policy, observation-only.
// Enforcement remains resolveCompanyAccess in the handler; the declaration mirrors it.
export default __createApiRoute(handler, {
  route: '/api/companies/:id/efficiency-score',
  policy: { v: 1, category: 'company-scoped', companyIdFrom: 'path.id' },
});
