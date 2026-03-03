import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { getLatestCampaignVersion } from '../../../../backend/db/campaignVersionStore';
import { resolveEffectiveCampaignRole, type CampaignAuthContext } from '../../../../backend/services/campaignRoleService';

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

  const campaignAuthResult = await resolveEffectiveCampaignRole(user.id, id, companyId);
  if (campaignAuthResult.error === 'CAMPAIGN_ROLE_REQUIRED') {
    return res.status(403).json({ error: 'CAMPAIGN_ROLE_REQUIRED' });
  }
  if (!campaignAuthResult.error) {
    const campaignAuth: CampaignAuthContext = {
      companyRole: campaignAuthResult.companyRole,
      campaignRole: campaignAuthResult.campaignRole,
      effectiveRole: campaignAuthResult.effectiveRole,
      source: campaignAuthResult.source,
    };
    (req as NextApiRequest & { campaignAuth?: CampaignAuthContext }).campaignAuth = campaignAuth;
    if (process.env.NODE_ENV !== 'test') {
      console.log('CAMPAIGN_AUTH_STRATEGY_STATUS', { campaignId: id, companyId, ...campaignAuth });
    }
  }

  const latestVersion = await getLatestCampaignVersion(companyId, id);
  if (!latestVersion) {
    return res.status(404).json({ error: 'Campaign version not found' });
  }

  let strategy_awareness: import('../../../../backend/services/strategyAwarenessService').StrategyAwareness | undefined;
  try {
    const { getStrategyAwareness } = await import('../../../../backend/services/strategyAwarenessService');
    strategy_awareness = await getStrategyAwareness(id);
  } catch (_) {
    // Optional enrichment; do not fail the request
  }

  return res.status(200).json({
    status: latestVersion.status ?? 'draft',
    ...(strategy_awareness != null && { strategy_awareness }),
  });
}
