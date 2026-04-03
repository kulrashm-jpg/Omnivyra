import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from './userContextService';

export async function requireCompanyContext(input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  campaignId?: string | null;
  requireCampaignId?: boolean;
}): Promise<{ companyId: string } | null> {
  const companyId = input.companyId?.trim();
  if (!companyId) {
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }

  const access = await enforceCompanyAccess({
    req: input.req,
    res: input.res,
    companyId,
    campaignId: input.campaignId ?? null,
    requireCampaignId: input.requireCampaignId ?? false,
  });
  if (!access) return null;

  return { companyId };
}
