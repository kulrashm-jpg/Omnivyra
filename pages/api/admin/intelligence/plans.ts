/**
 * Admin Intelligence Plans API
 * Phase-2: Super Admin Governance
 * GET: list plans with limits (plan_limits)
 * PUT/PATCH: update limit value
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireSuperAdmin } from '../../../../backend/middleware/requireSuperAdmin';
import {
  listPlansWithLimits,
  setPlanLimit,
} from '../../../../backend/services/intelligenceGovernanceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireSuperAdmin(req, res))) return;

  try {
    switch (req.method) {
      case 'GET': {
        const plans = await listPlansWithLimits();
        return res.status(200).json({ plans });
      }
      case 'PUT':
      case 'PATCH': {
        const { plan_id, resource_key, limit_value } = req.body as {
          plan_id: string;
          resource_key: string;
          limit_value: number | null;
        };
        if (!plan_id || !resource_key?.trim()) {
          return res.status(400).json({
            error: 'plan_id and resource_key are required',
          });
        }
        const value =
          limit_value !== undefined && limit_value !== null
            ? Number(limit_value)
            : null;
        const planLimit = await setPlanLimit(plan_id, resource_key, value);
        return res.status(200).json({ planLimit });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
