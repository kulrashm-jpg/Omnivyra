import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import {
  runOptimizationForCompany,
  getOptimizationData,
  canRunOptimization,
} from '../../../backend/services/optimizationOrchestrationService';

/**
 * GET: Return optimization data (strategy performance, weights, recommendation params, quality history).
 * POST: Run full optimization (subject to 6-hour frequency guard).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await resolveUserContext(req);
    const companyId = user?.defaultCompanyId ?? (req.query.companyId ?? req.body?.companyId) as string;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    if (req.method === 'GET') {
      const data = await getOptimizationData(companyId);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      if (!(await canRunOptimization(companyId))) {
        return res.status(429).json({
          error: 'Optimization limit exceeded: max 4 per day',
          retry_after_seconds: 6 * 60 * 60,
        });
      }
      const result = await runOptimizationForCompany(companyId);
      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Optimization failed';
    console.error('[intelligence/optimization]', message);
    return res.status(500).json({ error: message });
  }
}
