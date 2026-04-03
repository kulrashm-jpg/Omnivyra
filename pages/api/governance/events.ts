
/**
 * GET /api/governance/events
 * Governance Events Timeline — read-only. Stage 10 Phase 4.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.() || undefined;
  const eventType = (req.query.eventType as string)?.trim?.() || undefined;
  const limitParam = req.query.limit;
  const limit = limitParam != null ? Math.min(Math.max(1, Number(limitParam) || 50), 200) : 50;

  try {
    let query = supabase
      .from('campaign_governance_events')
      .select('id, campaign_id, event_type, event_status, metadata, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }
    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[governance/events]', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }

    const events = (data ?? []).map((row: any) => ({
      id: row.id,
      campaignId: row.campaign_id,
      eventType: row.event_type,
      eventStatus: row.event_status,
      metadata: (row.metadata as Record<string, any>) ?? {},
      createdAt: row.created_at,
    }));

    return res.status(200).json({ events });
  } catch (err) {
    console.error('[governance/events]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
