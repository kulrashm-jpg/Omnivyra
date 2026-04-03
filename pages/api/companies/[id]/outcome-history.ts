
/**
 * GET /api/companies/[id]/outcome-history?limit=<n>
 * Returns historical outcome snapshots for CPO trend display.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const companyId = req.query.id as string;
  const limit = Math.min(parseInt(req.query.limit as string || '10', 10), 50);

  try {
    const { data, error } = await supabase
      .from('campaign_outcomes')
      .select('campaign_id, outcome_score, credits_per_outcome, leads_generated, top_content_type, snapshot_at')
      .eq('company_id', companyId)
      .order('snapshot_at', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ?? []);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
}
