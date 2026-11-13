import { seamDenial } from '../../../../backend/db/seamDenial';
import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/proposals/reject
 * Reject a campaign proposal (status = rejected)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { tenantTable, tenantContextFor, TenantSeamError, type TenantContext } from '../../../../backend/db/tenantTable';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { proposalId } = req.body || {};
  if (!proposalId || typeof proposalId !== 'string') {
    return res.status(400).json({ error: 'proposalId required' });
  }

  const { data: proposal, error: fetchError } = await supabase
    .from('campaign_proposals')
    .select('id, organization_id, status')
    .eq('id', proposalId.trim())
    .maybeSingle();

  if (fetchError || !proposal) {
    return res.status(404).json({ error: 'Proposal not found' });
  }
  if (proposal.status === 'accepted') {
    return res.status(400).json({ error: 'Proposal already converted' });
  }
  if (proposal.status === 'rejected') {
    return res.status(200).json({ success: true, message: 'Proposal already rejected' });
  }

  const organizationId = proposal.organization_id as string;
  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  // S2 tenant seam: the tenant is the proposal's company, which enforceCompanyAccess just authorized for
  // access.userId; never a request value. A company that cannot form a context answers the route's existing
  // not-found, and nothing is written.
  let tenant: TenantContext;
  try {
    tenant = tenantContextFor(access, organizationId);
  } catch (err) {
    if (err instanceof TenantSeamError) return seamDenial(res, err, 404, { error: 'Proposal not found' });
    throw err;
  }

  const { error: updateError } = await tenantTable('campaign_proposals', tenant)
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', proposalId);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to reject proposal' });
  }

  return res.status(200).json({ success: true, message: 'Proposal rejected' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/proposals/reject' });
