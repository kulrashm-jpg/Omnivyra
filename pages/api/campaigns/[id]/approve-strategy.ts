import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole, Role } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion, saveCampaignVersion } from '../../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
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

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', id)
    .single();

  if (campaignError || !campaign?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const companyId = String(campaign.company_id);
  const { role, error: roleError } = await getUserRole(user.id, companyId);
  if (roleError === 'COMPANY_ACCESS_DENIED') {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED' });
  }
  if (!role || role !== Role.COMPANY_ADMIN) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const latestVersion = await getLatestCampaignVersion(companyId, id);
  if (!latestVersion) {
    return res.status(404).json({ error: 'Campaign version not found' });
  }

  await saveCampaignVersion({
    companyId,
    campaignId: id,
    campaignSnapshot: latestVersion.campaign_snapshot,
    status: 'approved',
    version: (latestVersion.version ?? 0) + 1,
  });

  try {
    await supabase.from('audit_logs').insert({
      action: 'CAMPAIGN_STRATEGY_APPROVED',
      actor_user_id: user.id,
      company_id: companyId,
      metadata: {
        previous_version: latestVersion.version ?? null,
      },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('AUDIT_LOG_FAILED', error);
  }

  return res.status(200).json({ success: true, status: 'approved' });
}
