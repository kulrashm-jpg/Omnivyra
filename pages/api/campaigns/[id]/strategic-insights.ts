
/**
 * GET /api/campaigns/[id]/strategic-insights
 * Aggregates Campaign Health, Engagement Health, Trend Signals, Inbox Signals
 * to generate CMO-level strategic insights.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { getTrendSnapshots } from '../../../../backend/db/campaignVersionStore';
import { getDecisionReportView } from '../../../../backend/services/decisionReportService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import { runInApiReadContext } from '../../../../backend/services/intelligenceExecutionContext';

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data: ver } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (ver?.company_id) return ver.company_id as string;
  const { data: camp } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  return camp?.company_id ? (camp.company_id as string) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID required' });
  }
  const campaignId = id;

  try {
    const companyId =
      (await getCompanyId(campaignId)) ??
      (typeof req.query.companyId === 'string' ? req.query.companyId : null);
    const companyContext = await requireCompanyContext({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!companyContext) return;

    const reportView = await runInApiReadContext('campaignStrategicInsightsApi', async () =>
      getDecisionReportView({
        companyId: companyContext.companyId,
        reportTier: 'growth',
        entityType: 'campaign',
        entityId: campaignId,
        sourceService: 'strategicInsightService',
      })
    );

    return res.status(200).json(reportView);
  } catch (err) {
    console.error('[campaigns/strategic-insights]', err);
    return res.status(500).json({
      error: 'Failed to generate strategic insights',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
