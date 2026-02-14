import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion, saveCampaignVersion } from '../../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const companyId = String(campaignRow.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || role !== Role.COMPANY_ADMIN) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const { selected_improvement_ids, notes } = req.body || {};
  if (!Array.isArray(selected_improvement_ids)) {
    return res.status(400).json({ error: 'selected_improvement_ids required' });
  }

  const latestVersion = await getLatestCampaignVersion(companyId, id);
  if (!latestVersion) {
    return res.status(404).json({ error: 'Campaign version not found' });
  }

  await saveCampaignVersion({
    companyId,
    campaignId: id,
    campaignSnapshot: {
      ...(latestVersion.campaign_snapshot || {}),
      previous_version_id: latestVersion.id,
      selected_improvement_ids,
      revision_source: 'ai_suggestions',
    },
    status: 'proposed',
    version: (latestVersion.version ?? 0) + 1,
  });

  console.warn('DEPRECATED: weekly_content_refinements write path triggered (revise-strategy)');
  const { error: refinementError } = await supabase
    .from('weekly_content_refinements')
    .update({
      refinement_status: 'ai_enhanced',
      finalized: false,
      finalized_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', id);

  if (refinementError) {
    return res.status(500).json({ error: 'Failed to reset weekly refinements' });
  }

  try {
    await supabase.from('audit_logs').insert({
      action: 'REVISE_STRATEGY_FROM_AI_SUGGESTIONS',
      actor_user_id: user.id,
      company_id: companyId,
      metadata: {
        previous_version: latestVersion.id,
        new_version: (latestVersion.version ?? 0) + 1,
        selected_improvement_ids,
        notes: notes ?? null,
      },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('AUDIT_LOG_FAILED', error);
  }

  return res.status(200).json({ success: true, status: 'proposed' });
}
