
/**
 * GET /api/companies/[id]/learnings?limit=<n>
 * Returns campaign learnings with decay-adjusted ranking for a company.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getEffectiveLearnings } from '../../../../backend/services/learningDecayService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const companyId = req.query.id as string;
  const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);

  try {
    const learnings = await getEffectiveLearnings(companyId, { limit });
    return res.status(200).json(learnings);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}
