/**
 * GET /api/user/subscription?company_id=xxx
 * Returns the subscription tier for the authenticated user's company.
 * Used by Command Center to gate features based on plan.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { resolveOrganizationPlanLimits } from '../../../backend/services/planResolutionService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;

  try {
    // Resolve org UUID from company_id
    let organizationId = companyId;
    if (companyId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('id')
        .eq('company_id', companyId)
        .maybeSingle();
      if (org?.id) organizationId = org.id;
    }

    const plan = organizationId
      ? await resolveOrganizationPlanLimits(organizationId)
      : null;

    const tier = plan?.plan_key ?? 'free';

    return res.status(200).json({
      ok: true,
      data: { tier, plan_key: tier, limits: plan?.limits ?? null },
    });
  } catch (err) {
    console.error('[api/user/subscription]', (err as Error)?.message);
    // Fail gracefully — return free tier so UI doesn't break
    return res.status(200).json({ ok: true, data: { tier: 'free', plan_key: 'free', limits: null } });
  }
}
