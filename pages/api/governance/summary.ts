
/**
 * GET /api/governance/summary
 * Governance observability — real-time metrics per company.
 * Stage 10. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getGovernanceSummary } from '../../../backend/services/GovernanceMetricsService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  try {
    const summary = await getGovernanceSummary(companyId);
    if (!summary) {
      return res.status(404).json({ error: 'Company not found' });
    }
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[governance/summary]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
