import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { getExecutionEligibility } from '../../../../backend/services/intelligenceExecutionController';

/**
 * GET /api/intelligence/execution/status
 * Check execution eligibility for a company.
 * Query: ?companyId
 */
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

    const eligibility = await getExecutionEligibility(companyId);
    return res.status(200).json(eligibility);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get execution status';
    console.error('[intelligence/execution/status]', message);
    return res.status(500).json({ error: message });
  }
}
