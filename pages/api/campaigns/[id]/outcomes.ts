
/**
 * GET  /api/campaigns/[id]/outcomes  — fetch or compute outcome score
 * POST /api/campaigns/[id]/outcomes  — trigger re-measurement
 *
 * Auth: requireAuth + requireCompanyAccess
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { measureOutcomeScore, getOutcomeSnapshot } from '../../../../backend/services/outcomeTrackingService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireAuth, requireCompanyAccess } from '../../../../backend/middleware/authMiddleware';

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  return (data as any)?.company_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const campaignId = req.query.id as string;
  if (!campaignId) return res.status(400).json({ error: 'Campaign ID required' });

  // ── Auth ────────────────────────────────────────────────────────────────
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // Look up company ownership before checking access
  const companyId = await getCompanyId(campaignId);
  if (!companyId) return res.status(404).json({ error: 'Campaign not found' });

  const allowed = await requireCompanyAccess(auth.user.id, companyId, res);
  if (!allowed) return;

  try {
    if (req.method === 'GET') {
      const snapshot = await getOutcomeSnapshot(campaignId);
      if (snapshot) return res.status(200).json(snapshot);

      const result = await measureOutcomeScore(campaignId, companyId);
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const result = await measureOutcomeScore(campaignId, companyId);
      return res.status(200).json(result);
    }

    return res.status(405).end();
  } catch (err: any) {
    console.error('[campaigns/outcomes]', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
