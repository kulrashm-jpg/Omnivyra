
/**
 * GET /api/credits/costs
 *
 * Returns the credit cost tier structure for UI display.
 * Reads from DB config if available; falls back to hardcoded map.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getCreditCostTiers } from '../../../backend/services/creditDeductionService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  return res.status(200).json(getCreditCostTiers());
}
