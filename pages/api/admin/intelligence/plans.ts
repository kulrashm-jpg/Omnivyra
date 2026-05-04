
/**
 * Admin Intelligence Plans API
 * Phase-2: Super Admin Governance
 * GET: list plans with limits (plan_limits)
 * PUT/PATCH: update limit value
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import {
  listPlansWithLimits,
  setPlanLimit,
} from '../../../../backend/services/intelligenceGovernanceService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ctx = await requireAdminScope(req, res, 'intelligence:plans');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/intelligence/plans', 'intelligence:plans');
  }

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

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
