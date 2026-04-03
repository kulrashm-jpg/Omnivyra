
/**
 * PATCH /api/engagement/signal/status
 * Update signal_status for a campaign engagement signal.
 * Body: { signalId, status } — status: new | reviewed | actioned | ignored
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

const ALLOWED_STATUSES = ['new', 'reviewed', 'actioned', 'ignored'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { signalId, status } = req.body as { signalId?: string; status?: string };
  const companyId = (req.body?.companyId as string) || '';

  if (!signalId || !status) {
    return res.status(400).json({ error: 'signalId and status are required' });
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      requireCampaignId: false,
    });
    if (!access) return;

    const { data: signal } = await supabase
      .from('campaign_activity_engagement_signals')
      .select('id, campaign_id')
      .eq('id', signalId)
      .maybeSingle();

    if (!signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    const { data: cv } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId)
      .eq('campaign_id', (signal as { campaign_id: string }).campaign_id)
      .limit(1)
      .maybeSingle();

    if (!cv && (signal as { campaign_id: string }).campaign_id) {
      return res.status(403).json({ error: 'Campaign not accessible' });
    }

    const { error } = await supabase
      .from('campaign_activity_engagement_signals')
      .update({ signal_status: status })
      .eq('id', signalId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, status });
  } catch (err) {
    console.error('[engagement/signal/status]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
