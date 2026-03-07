import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { getLearningForCompany } from '../../../backend/services/learningOrchestrationService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.query.companyId as string);
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const { learning, theme_reinforcement } = await getLearningForCompany(companyId);
    return res.status(200).json({
      learning,
      theme_reinforcement,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch learning';
    console.error('[intelligence/learning]', message);
    return res.status(500).json({ error: message });
  }
}
