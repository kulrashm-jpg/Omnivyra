/**
 * Campaign Narratives API
 * Returns story-driven campaign angles from campaign_narratives table.
 * Parameters: companyId, opportunityId, platform
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
    const opportunityId = (req.query.opportunityId as string)?.trim();
    const platform = (req.query.platform as string)?.trim();

    let query = supabase
      .from('campaign_narratives')
      .select('narrative_angle, narrative_summary, target_audience, platform, created_at');

    if (opportunityId) {
      query = query.eq('opportunity_id', opportunityId);
    }

    if (platform) {
      query = query.eq('platform', platform);
    }

    if (companyId) {
      const { data: oppIds } = await supabase
        .from('content_opportunities')
        .select('id')
        .eq('company_id', companyId);
      const ids = (oppIds ?? []).map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        query = query.in('opportunity_id', ids);
      } else {
        return res.status(200).json({ narratives: [] });
      }
    } else if (!opportunityId) {
      return res.status(400).json({ error: 'companyId or opportunityId required' });
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(50);

    if (error) {
      console.error('[intelligence/narratives]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const narratives = (data ?? []).map((r: Record<string, unknown>) => ({
      angle: r.narrative_angle ?? '',
      summary: r.narrative_summary ?? '',
      target_audience: r.target_audience ?? '',
      platform: r.platform ?? '',
    }));

    return res.status(200).json({ narratives });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch narratives';
    console.error('[intelligence/narratives]', message);
    return res.status(500).json({ error: message });
  }
}
