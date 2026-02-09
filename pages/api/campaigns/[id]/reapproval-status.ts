import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';
import { getLatestApprovedCampaignVersion } from '../../../../backend/db/campaignApprovedVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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
  if (!role) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  const latestVersion = await getLatestCampaignVersion(companyId, id);
  const approvedVersion = await getLatestApprovedCampaignVersion(companyId, id);

  if (!latestVersion) {
    return res.status(404).json({ error: 'Campaign version not found' });
  }

  const reapprovalRequired =
    latestVersion?.status === 'proposed' && approvedVersion && approvedVersion.id !== latestVersion.id;

  return res.status(200).json({
    status: reapprovalRequired ? 'reapproval_required' : 'none',
    proposed_version: reapprovalRequired ? latestVersion.id : null,
    approved_version: reapprovalRequired ? approvedVersion.id : null,
    proposed_created_at: reapprovalRequired ? latestVersion.created_at ?? null : null,
  });
}
