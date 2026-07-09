
/**
 * GET /api/campaigns/content-stats?companyId=...
 *
 * Returns total and published scheduled_post counts for a company.
 * Used by the dashboard to populate the Total Content and Published tiles.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { withApiObservability } from '../../../backend/observability';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Get all campaign IDs for this company
  const { data: campaignRows, error: campErr } = await supabase
    .from('campaigns')
    .select('id')
    .eq('company_id', companyId);

  if (campErr) return res.status(500).json({ error: 'Failed to load campaigns' });

  const campaignIds = (campaignRows ?? []).map((c: { id: string }) => c.id).filter(Boolean);

  if (campaignIds.length === 0) {
    return res.status(200).json({ total: 0, published: 0 });
  }

  const [{ count: total }, { count: published }] = await Promise.all([
    supabase
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .in('campaign_id', campaignIds),
    supabase
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .in('campaign_id', campaignIds)
      .eq('status', 'published'),
  ]);

  // HARDEN-002: short-lived private cache — the dashboard re-requests these
  // tiles on every remount; in-page mutations bust via the client `_v` param.
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Authorization');
  return res.status(200).json({ total: total ?? 0, published: published ?? 0 });
}

// HARDEN-002: measurement only (HARDEN-001 API metrics).
export default withApiObservability(handler, '/api/campaigns/content-stats');
