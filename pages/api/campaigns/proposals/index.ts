/**
 * GET /api/campaigns/proposals
 * List campaign proposals with filters: organizationId, status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId = (req.query.organizationId ?? req.query.organization_id) as string | undefined;
  const status = req.query.status as string | undefined;

  if (!organizationId) {
    return res.status(400).json({ error: 'organizationId required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  let q = supabase
    .from('campaign_proposals')
    .select('id, proposal_title, proposal_strength, opportunity_id, created_at, status')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (status && ['draft', 'accepted', 'rejected'].includes(status)) {
    q = q.eq('status', status);
  }

  const { data, error } = await q;

  if (error) {
    console.error('[campaigns/proposals]', error);
    return res.status(500).json({ error: 'Failed to fetch proposals' });
  }

  return res.status(200).json({
    proposals: (data || []).map((p: Record<string, unknown>) => ({
      id: p.id,
      proposal_title: p.proposal_title,
      proposal_strength: p.proposal_strength,
      opportunity_id: p.opportunity_id,
      created_at: p.created_at,
      status: p.status,
    })),
  });
}
