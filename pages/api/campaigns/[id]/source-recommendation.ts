/**
 * PUT /api/campaigns/[id]/source-recommendation
 * Saves the selected recommendation card (source_recommendation_id + source_strategic_theme)
 * to the campaign's latest version. Used when user clicks "Build Campaign Blueprint" on a card
 * after the campaign was already created at "Generate Strategic Themes" time.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';

async function getCompanyIdForCampaign(campaignId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { company_id?: string })?.company_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id: campaignId } = req.query;
  if (!campaignId || typeof campaignId !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const companyId = await getCompanyIdForCampaign(campaignId);
  if (!companyId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    campaignId,
    requireCampaignId: true,
  });
  if (!access) return;

  const body = req.body || {};
  const source_recommendation_id =
    typeof body.source_recommendation_id === 'string' ? body.source_recommendation_id.trim() : null;
  const source_strategic_theme =
    body.source_strategic_theme && typeof body.source_strategic_theme === 'object'
      ? body.source_strategic_theme
      : null;

  if (!source_recommendation_id && !source_strategic_theme) {
    return res.status(400).json({
      error: 'Provide at least one of source_recommendation_id or source_strategic_theme',
    });
  }

  const { data: latestVersion, error: fetchError } = await supabase
    .from('campaign_versions')
    .select('id, campaign_snapshot')
    .eq('company_id', companyId)
    .eq('campaign_id', campaignId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError || !latestVersion) {
    return res.status(404).json({ error: 'Campaign version not found' });
  }

  const currentSnapshot = (latestVersion.campaign_snapshot as Record<string, unknown>) || {};
  const updatedSnapshot: Record<string, unknown> = { ...currentSnapshot };
  if (source_recommendation_id) {
    updatedSnapshot.source_recommendation_id = source_recommendation_id;
    const meta = (currentSnapshot.metadata as Record<string, unknown>) || {};
    updatedSnapshot.metadata = { ...meta, recommendation_id: source_recommendation_id };
  }
  if (source_strategic_theme) {
    updatedSnapshot.source_strategic_theme = source_strategic_theme;
  }

  const { error: updateError } = await supabase
    .from('campaign_versions')
    .update({ campaign_snapshot: updatedSnapshot })
    .eq('id', (latestVersion as { id: string }).id);

  if (updateError) {
    console.error('source-recommendation update failed:', updateError);
    return res.status(500).json({ error: 'Failed to save recommendation card to campaign' });
  }

  // Update campaign name to theme topic when we have a strategic theme (so dashboard shows topic, not "Campaign from themes")
  const theme = source_strategic_theme as { polished_title?: string; topic?: string; title?: string } | null;
  if (theme && (theme.polished_title ?? theme.topic ?? theme.title)) {
    const themeName = [theme.polished_title, theme.topic, theme.title].map((t) => (typeof t === 'string' ? t.trim() : '')).find(Boolean);
    if (themeName) {
      const { error: nameError } = await supabase
        .from('campaigns')
        .update({ name: themeName })
        .eq('id', campaignId);
      if (nameError) {
        console.warn('Failed to update campaign name from theme:', nameError.message);
      }
    }
  }

  return res.status(200).json({
    success: true,
    campaign_id: campaignId,
    message: 'Source recommendation card saved to campaign',
  });
}
