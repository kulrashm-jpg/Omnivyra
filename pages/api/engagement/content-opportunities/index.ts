/**
 * GET /api/engagement/content-opportunities
 * Returns content opportunities from engagement signals.
 * ?stored=true returns stored opportunities with lifecycle data (campaign_id, content_id, impact_metrics).
 * ?id=xxx returns single stored opportunity by id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { generateContentOpportunities } from '../../../../backend/services/contentOpportunityService';
import { getStoredContentOpportunity } from '../../../../backend/services/contentOpportunityStorageService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const organizationId = (req.query.organization_id ?? req.query.organizationId) as string | undefined;
    const stored = req.query.stored === 'true' || req.query.stored === '1';
    const id = (req.query.id ?? req.query.opportunity_id) as string | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    if (id) {
      const opp = await getStoredContentOpportunity(id, organizationId);
      if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
      return res.status(200).json(opp);
    }

    if (stored) {
      const { data, error } = await supabase
        .from('engagement_content_opportunities')
        .select('id, organization_id, topic, opportunity_type, suggested_title, confidence_score, signal_summary, source_topic, status, assigned_to, campaign_id, content_id, impact_metrics, created_at, updated_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ opportunities: data ?? [] });
    }

    const windowHours = Math.min(
      168,
      Math.max(1, parseInt(String(req.query.window_hours ?? 72), 10) || 72)
    );
    const opportunities = await generateContentOpportunities(organizationId, windowHours);
    return res.status(200).json({ opportunities });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to fetch content opportunities';
    console.error('[engagement/content-opportunities]', msg);
    return res.status(500).json({ error: msg });
  }
}
