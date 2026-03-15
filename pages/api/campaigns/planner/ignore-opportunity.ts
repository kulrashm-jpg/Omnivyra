/**
 * POST /api/campaigns/planner/ignore-opportunity
 * Marks an opportunity as ignored.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: companyId ?? opp.organization_id,
    });
    if (!access) return;

    const { error } = await supabase
      .from('opportunity_radar')
      .update({ status: 'ignored' })
      .eq('id', opportunityId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, opportunityId });
  } catch (err) {
    console.error('[planner/ignore-opportunity]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to ignore opportunity',
    });
  }
}
