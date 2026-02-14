import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { buildCompanyMissionContext } from '../../../backend/services/companyMissionContext';
import type { ContextMode } from '../../../backend/services/companyMissionContext';

const VALID_MODES: ContextMode[] = ['FULL', 'BRAND_ONLY', 'ICP_ONLY', 'BRAND_ICP', 'NONE'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string | undefined;
  const mode = (req.query.mode as string) || 'FULL';

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  const resolvedMode: ContextMode = VALID_MODES.includes(mode as ContextMode) ? (mode as ContextMode) : 'FULL';
  const context = await buildCompanyMissionContext(companyId, resolvedMode);

  return res.status(200).json({ mission_context: context });
}
