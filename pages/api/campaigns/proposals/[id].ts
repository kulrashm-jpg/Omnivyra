/**
 * GET /api/campaigns/proposals/[id]
 * Fetch full proposal detail
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Proposal id required' });
  }

  const { data: proposal, error } = await supabase
    .from('campaign_proposals')
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

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: proposal.organization_id as string,
  });
  if (!access) return;

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
