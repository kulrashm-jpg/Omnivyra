/**
 * GET  /api/companies/[id]/efficiency  — full efficiency report
 * POST /api/companies/[id]/efficiency  — trigger optimization run
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { optimizeCreditEfficiency } from '../../../../backend/services/creditEfficiencyEngine';
import { getCompanyOutcomeStats } from '../../../../backend/services/outcomeTrackingService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = req.query.id as string;
  if (!companyId) return res.status(400).json({ error: 'Company ID required' });

  try {
    if (req.method === 'GET') {
      const stats = await getCompanyOutcomeStats(companyId);
      return res.status(200).json(stats);
    }

    if (req.method === 'POST') {
      const report = await optimizeCreditEfficiency(companyId);
      return res.status(200).json(report);
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error('[companies/efficiency]', err?.message);
    return res.status(500).json({ error: err?.message });
  }
}
