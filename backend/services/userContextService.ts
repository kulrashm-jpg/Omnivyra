import { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext as resolveFromLib, UserContext } from '../lib/userContext';

export type { UserContext };

export const resolveUserContext = async (_req?: NextApiRequest): Promise<UserContext> => resolveFromLib();

export const enforceCompanyAccess = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  campaignId?: string | null;
  requireCampaignId?: boolean;
}): Promise<UserContext | null> => {
  const user = await resolveUserContext(input.req);

  if (!input.companyId) {
    console.warn('MISSING_COMPANY_ID', { path: input.req.url });
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }

  if (!user.companyIds.includes(input.companyId)) {
    console.warn('ACCESS_DENIED', {
      path: input.req.url,
      companyId: input.companyId,
      userId: user.userId,
      role: user.role,
    });
    input.res.status(403).json({ error: 'Access denied to company' });
    return null;
  }

  if (input.requireCampaignId && !input.campaignId) {
    console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
    input.res.status(400).json({ error: 'campaignId required' });
    return null;
  }

  return user;
};
