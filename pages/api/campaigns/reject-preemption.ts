
/**
 * POST /api/campaigns/reject-preemption
 * Rejects a pending preemption request.
 * Sets status = REJECTED, rejected_at = NOW(). No campaign change.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { rejectPreemptionRequest, PreemptionValidationError } from '../../../backend/services/CampaignPreemptionService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { requestId, companyId } = req.body || {};

    if (!requestId || !companyId) {
      return res.status(400).json({
        error: 'requestId and companyId are required',
      });
    }

    const { data: request, error: fetchError } = await supabase
      .from('campaign_preemption_requests')
      .select('id, initiator_campaign_id')
      .eq('id', requestId)
      .maybeSingle();

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Preemption request not found' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId: request.initiator_campaign_id,
      requireCampaignId: true,
    });
    if (!access) return;

    await rejectPreemptionRequest(requestId);

    return res.status(200).json({
      status: 'REJECTED',
      requestId,
    });
  } catch (err: unknown) {
    if (err instanceof PreemptionValidationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        rejected: true,
      });
    }
    console.error('[reject-preemption]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
