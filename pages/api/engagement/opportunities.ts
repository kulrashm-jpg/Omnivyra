
/**
 * GET /api/engagement/opportunities
 * Returns opportunities for a thread. Params: thread_id, organization_id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;
    const threadId = (req.query.thread_id ?? req.query.threadId) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!threadId) {
      return res.status(400).json({ error: 'thread_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data, error } = await supabase
      .from('engagement_opportunities')
      .select('id, opportunity_type, confidence_score, priority_score')
      .eq('organization_id', organizationId)
      .eq('source_thread_id', threadId)
      .eq('resolved', false)
      .order('priority_score', { ascending: false })
      .limit(10);

    if (error) {
      console.warn('[engagement/opportunities]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const opportunities = (data ?? []).map((o: { id: string; opportunity_type: string; confidence_score: number; priority_score: number }) => ({
      id: o.id,
      opportunity_type: o.opportunity_type,
      confidence_score: Number(o.confidence_score ?? 0),
      priority_score: Number(o.priority_score ?? 0),
    }));

    return res.status(200).json({ opportunities });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch opportunities';
    console.error('[engagement/opportunities]', message);
    return res.status(500).json({ error: message });
  }
}
