/**
 * GET /api/company/opportunities
 * Fetches trend signals, engagement health, strategic insights, inbox signals
 * and returns OpportunityReport from Opportunity Detection Engine.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import { getThreads } from '../../../backend/services/engagementThreadService';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  detectOpportunities,
  getLatestOpportunityReport,
  saveOpportunityReport,
} from '../../../backend/services/opportunityDetectionService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_PLANNER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string)?.trim();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    const cached = await getLatestOpportunityReport(companyId);
    if (cached) {
      return res.status(200).json(cached);
    }

    const trendSnapshots = await getTrendSnapshots(companyId);
    const trendSignals = trendSnapshots.map((s: { snapshot?: unknown }) => ({
      snapshot: s?.snapshot ?? {},
    }));

    const engagementHealthReport: Record<string, unknown> = {
      engagement_rate: 0,
      reply_pending_count: 0,
      last_updated_at: new Date().toISOString(),
    };

    let strategicInsightReport: Record<string, unknown> | null = null;
    const { data: insightRow } = await supabase
      .from('campaign_strategic_insights')
      .select('report_json')
      .eq('company_id', companyId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (insightRow?.report_json && typeof insightRow.report_json === 'object') {
      strategicInsightReport = insightRow.report_json as Record<string, unknown>;
    }

    let inboxSignals: Record<string, unknown>[] = [];
    try {
      const threads = await getThreads({
        organization_id: companyId,
        limit: 50,
        exclude_ignored: true,
      });
      inboxSignals = threads.map((t) => ({
        thread_id: t.thread_id,
        platform: t.platform,
        message_count: t.message_count,
        latest_message: t.latest_message,
        dominant_intent: t.dominant_intent,
        customer_question: t.customer_question,
      }));
    } catch {
      inboxSignals = [];
    }

    const report = await detectOpportunities({
      company_id: companyId,
      trend_signals: trendSignals,
      engagement_health_report: engagementHealthReport,
      strategic_insight_report: strategicInsightReport,
      inbox_signals: inboxSignals,
    });

    await saveOpportunityReport(report);
    return res.status(200).json(report);
  } catch (err) {
    console.error('[company/opportunities]', err);
    return res.status(500).json({
      error: 'Failed to detect opportunities',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
