import type { NextApiRequest, NextApiResponse } from 'next';
import { getLatestApprovedCampaignVersion } from '../../../backend/db/campaignApprovedVersionStore';
import { supabase } from '../../../backend/db/supabaseClient';
import { computeAnalytics } from '../../../backend/services/analyticsService';

const resolvePlaybookReferenceId = (snapshot: any): string | null =>
  snapshot?.virality_playbook_id ?? snapshot?.campaign?.virality_playbook_id ?? null;

const fetchPlaybookContext = async (companyId: string, playbookId: string | null) => {
  if (!playbookId) return null;
  const { data, error } = await supabase
    .from('virality_playbooks')
    .select('id, name, objective, company_id')
    .eq('id', playbookId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name, objective: data.objective };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, timeframe } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const report = await computeAnalytics({ companyId, campaignId, timeframe });
    const campaignVersion = campaignId
      ? await getLatestApprovedCampaignVersion(companyId, campaignId)
      : null;
    if (campaignId) {
      console.debug('Approved strategy used for analytics', {
        campaignId,
        companyId,
        versionId: campaignVersion?.id,
        status: campaignVersion?.status,
      });
    }
    const playbookReferenceId = resolvePlaybookReferenceId(campaignVersion?.campaign_snapshot);
    const playbookContext = await fetchPlaybookContext(companyId, playbookReferenceId);
    return res.status(200).json({
      ...report,
      // Playbook fields are for interpretation/reporting only.
      // Campaign KPIs are evaluated independently.
      // No downstream system should infer execution behavior from playbook data.
      playbook_id: playbookContext?.id ?? playbookReferenceId ?? null,
      playbook_name: playbookContext?.name ?? null,
      playbook_objective: playbookContext?.objective ?? null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to compute analytics' });
  }
}
