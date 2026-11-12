import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/planner/ignore-opportunity
 * Marks an opportunity as ignored.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { tenantTable, tenantContextFor, TenantSeamError } from '../../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { opportunityId, companyId } = req.body as { opportunityId?: string; companyId?: string };
  if (!opportunityId) {
    return res.status(400).json({ error: 'opportunityId is required' });
  }

  try {
    const { data: opp } = await supabase
      .from('opportunity_radar')
      .select('organization_id')
      .eq('id', opportunityId)
      .maybeSingle();

    if (!opp?.organization_id) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const authorizedCompanyId = companyId ?? opp.organization_id;
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: authorizedCompanyId,
    });
    if (!access) return;

    // S2 tenant seam: the tenant is the company enforceCompanyAccess above authorized (the body companyId, else the
    // opportunity's own organization_id). An opportunity of another company matches no row: nothing is written and
    // the caller gets the same 404 as an unknown id.
    let opportunities: ReturnType<typeof tenantTable>;
    try {
      opportunities = tenantTable('opportunity_radar', tenantContextFor(access, String(authorizedCompanyId)));
    } catch (err) {
      if (err instanceof TenantSeamError) return res.status(404).json({ error: 'Opportunity not found' });
      throw err;
    }

    const { data: updated, error } = await opportunities
      .update({ status: 'ignored' })
      .eq('id', opportunityId)
      .select('id');

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!Array.isArray(updated) || updated.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    return res.status(200).json({ success: true, opportunityId });
  } catch (err) {
    console.error('[planner/ignore-opportunity]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to ignore opportunity',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/planner/ignore-opportunity' });
