/**
 * Community Insights API
 * Returns feedback intelligence from feedback_intelligence.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const companyId = (req.query.companyId as string)?.trim() || user?.defaultCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? 20), 10) || 20));
    const minImpact = parseFloat(String(req.query.minImpact ?? 0));

    let query = supabase
      .from('feedback_intelligence')
      .select('id, insight_type, insight_summary, impact_score, created_at')
      .eq('company_id', companyId)
      .order('impact_score', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (!Number.isNaN(minImpact) && minImpact > 0) {
      query = query.gte('impact_score', minImpact);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[community/insights]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const insights = (data ?? []).map((r: Record<string, unknown>) => ({
      insight_type: r.insight_type ?? 'content_performance',
      summary: r.insight_summary ?? '',
      impact_score: r.impact_score ?? 0,
    }));

    return res.status(200).json({ insights });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch insights';
    console.error('[community/insights]', message);
    return res.status(500).json({ error: message });
  }
}
