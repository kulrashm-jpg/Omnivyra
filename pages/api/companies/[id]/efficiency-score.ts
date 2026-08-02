import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/companies/[id]/efficiency-score
 * Returns the current efficiency tier and discount for a company.
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
      .select('efficiency_tier, discount_multiplier, credits_per_outcome_avg, credits_saved_total, total_outcomes, computed_at')
      .eq('organization_id', companyId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(200).json({
      efficiency_tier: 'standard',
      discount_multiplier: 1.0,
      credits_per_outcome_avg: 0,
      credits_saved_total: 0,
      total_outcomes: 0,
    });

    return res.status(200).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/companies/:id/efficiency-score' });
