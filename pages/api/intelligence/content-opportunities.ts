/**
 * Content Opportunities API
 * Returns structured content opportunities from content_opportunities table.
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
    const companyId =
      (req.query.companyId as string)?.trim() || user?.defaultCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const limit = Math.min(
      50,
      Math.max(1, parseInt(String(req.query.limit ?? 20), 10) || 20)
    );
    const priorityThreshold = parseFloat(
      String(req.query.priority_threshold ?? 0)
    );
    const isValidThreshold =
      !Number.isNaN(priorityThreshold) && priorityThreshold >= 0;

    let query = supabase
      .from('content_opportunities')
      .select('opportunity_title, opportunity_description, opportunity_type, priority_score, momentum_score, created_at')
      .eq('company_id', companyId)
      .order('priority_score', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (isValidThreshold) {
      query = query.gte('priority_score', priorityThreshold);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[intelligence/content-opportunities]', error.message);
      return res.status(500).json({ error: error.message });
    }

    const opportunities = (data ?? []).map((r: Record<string, unknown>) => ({
      title: r.opportunity_title ?? '',
      description: r.opportunity_description ?? '',
      type: r.opportunity_type ?? '',
      priority_score: r.priority_score ?? 0,
      momentum_score: r.momentum_score ?? 0,
    }));

    return res.status(200).json({ opportunities });
  } catch (err) {
    const message = (err as Error)?.message ?? 'Failed to fetch content opportunities';
    console.error('[intelligence/content-opportunities]', message);
    return res.status(500).json({ error: message });
  }
}
