import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { mergeRecommendationsIntoPlan } from '../../../../backend/services/campaignRecommendationExtensionService';

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  return data?.company_id ? (data.company_id as string) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  let companyId = await getCompanyId(campaignId);
  if (!companyId && typeof req.body?.companyId === 'string') companyId = req.body.companyId;
  if (!companyId) {
    return res.status(400).json({ error: 'Campaign must be linked to a company. Pass companyId in body if needed.' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    campaignId,
    requireCampaignId: false,
  });
  if (!access) return;

  const { sessionId, weekNumbers } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const weeks = Array.isArray(weekNumbers) ? weekNumbers : [];
  if (weeks.length === 0) {
    return res.status(400).json({ error: 'weekNumbers array is required and must not be empty' });
  }

  try {
    const { merged } = await mergeRecommendationsIntoPlan({
      campaignId,
      sessionId,
      weekNumbers: weeks,
    });
    return res.status(200).json({ success: true, merged });
  } catch (error: any) {
    console.error('Error merging recommendations:', error);
    return res.status(500).json({ error: error?.message || 'Failed to merge recommendations' });
  }
}
