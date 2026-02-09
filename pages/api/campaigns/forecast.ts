import type { NextApiRequest, NextApiResponse } from 'next';
import { getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import { getLatestApprovedCampaignVersion } from '../../../backend/db/campaignApprovedVersionStore';
import { getLatestPlatformExecutionPlan } from '../../../backend/db/platformExecutionStore';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getCampaignMemory } from '../../../backend/services/campaignMemoryService';
import { getLatestAnalyticsReport } from '../../../backend/db/performanceStore';
import { generateCampaignForecast } from '../../../backend/services/campaignForecastService';
import { saveCampaignForecast } from '../../../backend/db/forecastStore';
import { supabase } from '../../../backend/db/supabaseClient';

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
    const { companyId, campaignId } = req.body || {};
    if (!companyId || !campaignId) {
      return res.status(400).json({ error: 'companyId and campaignId are required' });
    }

    const campaignVersion = await getLatestApprovedCampaignVersion(companyId, campaignId);
    if (!campaignVersion?.campaign_snapshot) {
      return res.status(404).json({ error: 'Campaign plan not found' });
    }
    console.debug('Approved strategy used for analytics', {
      campaignId,
      companyId,
      versionId: campaignVersion?.id,
      status: campaignVersion?.status,
    });
    const platformPlan = await getLatestPlatformExecutionPlan({ companyId, campaignId, weekNumber: 1 });
    const assets = await listAssetsWithLatestContent({ campaignId });
    const trends = await getTrendSnapshots(companyId, campaignId);
    const memory = await getCampaignMemory({ companyId, campaignId });
    const analytics = await getLatestAnalyticsReport(companyId, campaignId);

    const forecast = await generateCampaignForecast({
      companyId,
      campaignId,
      campaignPlan: campaignVersion.campaign_snapshot,
      platformExecutionPlan: platformPlan?.plan_json ?? null,
      contentAssets: assets,
      trendsUsed: trends.flatMap((snap) => snap.snapshot?.emerging_trends ?? []).map((t: any) => t.topic),
      campaignMemory: memory,
      analyticsHistory: analytics?.report_json ?? null,
    });

    await saveCampaignForecast({
      campaignId,
      forecast,
      confidence: forecast.confidence,
    });
    console.log('FORECAST GENERATED', { campaignId });

    const playbookReferenceId = resolvePlaybookReferenceId(campaignVersion.campaign_snapshot);
    const playbookContext = await fetchPlaybookContext(companyId, playbookReferenceId);
    return res.status(200).json({
      ...forecast,
      // Playbook fields are for interpretation/reporting only.
      // Campaign KPIs are evaluated independently.
      // No downstream system should infer execution behavior from playbook data.
      playbook_id: playbookContext?.id ?? playbookReferenceId ?? null,
      playbook_name: playbookContext?.name ?? null,
      playbook_objective: playbookContext?.objective ?? null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate forecast' });
  }
}
