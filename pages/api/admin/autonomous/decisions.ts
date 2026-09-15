import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/admin/autonomous/decisions?company_id=&limit=&decision_type=&campaign_id=
 *
 * Returns the AI decision log for the control panel.
 * Auth: Bearer token
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getDecisionLog } from '@/backend/services/autonomousDecisionLogger';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import type { AutonomousDecisionType } from '@/backend/services/autonomousDecisionLogger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Invalid token' });

  const companyId    = req.query.company_id as string;
  const limit        = Math.min(200, parseInt(req.query.limit as string) || 50);
  const decisionType = req.query.decision_type as AutonomousDecisionType | undefined;
  const campaignId   = req.query.campaign_id as string | undefined;

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  // ROUTE-AUTH-001 (STEP 3AH-85): the query company_id went straight to
  // getDecisionLog — any signed-in user could read any company's AI decision
  // log. Caller must be a member of company_id (same bar as the sibling
  // /api/admin/autonomous settings route); an optional campaign_id filter must
  // belong to that company (404 otherwise).
  const access = await enforceCompanyAccess({ req, res, companyId, campaignId });
  if (!access) return;

  const decisions = await getDecisionLog(companyId, { limit, decision_type: decisionType, campaign_id: campaignId });

  return res.status(200).json({ success: true, data: decisions });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/autonomous/decisions' });
