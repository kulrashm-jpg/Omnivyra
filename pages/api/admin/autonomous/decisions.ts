
/**
 * GET /api/admin/autonomous/decisions?company_id=&limit=&decision_type=&campaign_id=
 *
 * Returns the AI decision log for the control panel.
 * Auth: Bearer token
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDecisionLog } from '@/backend/services/autonomousDecisionLogger';
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import type { AutonomousDecisionType } from '@/backend/services/autonomousDecisionLogger';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId    = req.query.company_id as string;
  const limit        = Math.min(200, parseInt(req.query.limit as string) || 50);
  const decisionType = req.query.decision_type as AutonomousDecisionType | undefined;
  const campaignId   = req.query.campaign_id as string | undefined;

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const ctx = await requireAdminScope(req, res, 'autonomous:decisions', { companyId });
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/autonomous/decisions', 'autonomous:decisions');
  }

  const decisions = await getDecisionLog(companyId, { limit, decision_type: decisionType, campaign_id: campaignId });

  return res.status(200).json({ success: true, data: decisions });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
