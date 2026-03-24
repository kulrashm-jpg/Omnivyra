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
import type { AutonomousDecisionType } from '@/backend/services/autonomousDecisionLogger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user } = await getSupabaseUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Invalid token' });

  const companyId    = req.query.company_id as string;
  const limit        = Math.min(200, parseInt(req.query.limit as string) || 50);
  const decisionType = req.query.decision_type as AutonomousDecisionType | undefined;
  const campaignId   = req.query.campaign_id as string | undefined;

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const decisions = await getDecisionLog(companyId, { limit, decision_type: decisionType, campaign_id: campaignId });

  return res.status(200).json({ success: true, data: decisions });
}
