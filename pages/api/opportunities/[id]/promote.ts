import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { promoteToCampaign } from '../../../../backend/services/opportunityService';

/**
 * POST /api/opportunities/[id]/promote
 * Body: { companyId: string }
 * Returns { campaign_id }. Caller should redirect to campaign planning/edit.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  const companyId = typeof req.body?.companyId === 'string' ? req.body.companyId : '';

  if (!id || !companyId) {
    return res.status(400).json({ error: 'Opportunity id and companyId are required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  const userId = access.userId ?? '';
  if (!userId) {
    return res.status(401).json({ error: 'User not identified' });
  }

  try {
    const campaignId = await promoteToCampaign(id, companyId, userId);
    return res.status(200).json({ campaign_id: campaignId });
  } catch (e) {
    console.error('Opportunity promote', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}
