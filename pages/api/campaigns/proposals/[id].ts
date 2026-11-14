import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/campaigns/proposals/[id]
 * Fetch full proposal detail
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { tenantTable, tenantContextFor, ownerCompanyOfRow, TenantSeamError, type TenantContext } from '../../../../backend/db/tenantTable';
import { seamDenial } from '../../../../backend/db/seamDenial';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Proposal id required' });
  }

  // S2 derive-then-authorize (e9 ruling, as proposals/convert): ownerCompanyOfRow answers ONLY which company owns the
  // proposal (null for a missing, unreadable or company-less row: the 404; an unreadable row used to answer 500
  // before the access check). enforceCompanyAccess authorizes the caller for exactly that company, and only then is
  // the proposal read, through the seam.
  const organizationId = await ownerCompanyOfRow('campaign_proposals', id, 'proposal detail');
  if (!organizationId) {
    return res.status(404).json({ error: 'Proposal not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: organizationId,
  });
  if (!access) return;

  let tenant: TenantContext;
  try {
    tenant = tenantContextFor(access, organizationId);
  } catch (err) {
    if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Proposal not found' });
    throw err;
  }

  const { data: proposal, error } = await tenantTable('campaign_proposals', tenant)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[campaigns/proposals/[id]]', error);
    return res.status(500).json({ error: 'Failed to fetch proposal' });
  }
  if (!proposal) {
    return res.status(404).json({ error: 'Proposal not found' });
  }

  const pd = (proposal.proposal_data as Record<string, unknown>) || {};
  return res.status(200).json({
    campaign_title: pd.campaign_title ?? proposal.proposal_title,
    objective: pd.campaign_objective,
    duration: pd.recommended_duration_weeks,
    platforms: pd.recommended_platforms ?? [],
    weekly_structure: pd.weekly_structure ?? [],
    topics_to_cover: pd.topics_to_cover ?? [],
    opportunity_id: proposal.opportunity_id,
    proposal_strength: proposal.proposal_strength,
    status: proposal.status,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/proposals/:id' });
