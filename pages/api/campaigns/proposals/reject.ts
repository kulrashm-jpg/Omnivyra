import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/campaigns/proposals/reject
 * Reject a campaign proposal (status = rejected)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

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

  const { error: updateError } = await supabase
    .from('campaign_proposals')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', proposalId);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to reject proposal' });
  }

  return res.status(200).json({ success: true, message: 'Proposal rejected' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/proposals/reject' });
