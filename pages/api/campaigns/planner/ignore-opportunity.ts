import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/planner/ignore-opportunity
 * Marks an opportunity as ignored.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { tenantTable, tenantContextFor, ownerCompanyOfRow, TenantSeamError } from '../../../../backend/db/tenantTable';

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
    // S2 derive-then-authorize (e9 ruling): ownerCompanyOfRow answers ONLY which company owns the opportunity (null for
    // a missing, unreadable or company-less row: the same 404). It is the opportunity's OWN company that gets
    // authorized; a body companyId naming any other company answers the same 404 (never authorized for this row).
    const ownerCompanyId = await ownerCompanyOfRow('opportunity_radar', opportunityId, 'planner ignore opportunity');
    if (!ownerCompanyId) return res.status(404).json({ error: 'Opportunity not found' });
    if (companyId != null && String(companyId).toLowerCase() !== ownerCompanyId) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: ownerCompanyId,
    });
    if (!access) return;

    // S2 tenant seam: the tenant is the opportunity's own company, which enforceCompanyAccess above authorized. The
    // update is scoped to it, so a row that changed hands in between matches nothing and answers the same 404.
    let opportunities: ReturnType<typeof tenantTable>;
    try {
      opportunities = tenantTable('opportunity_radar', tenantContextFor(access, ownerCompanyId));
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
