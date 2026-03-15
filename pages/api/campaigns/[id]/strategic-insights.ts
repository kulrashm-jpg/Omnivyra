/**
 * GET /api/campaigns/[id]/strategic-insights
 * Aggregates Campaign Health, Engagement Health, Trend Signals, Inbox Signals
 * to generate CMO-level strategic insights.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getTrendSnapshots } from '../../../../backend/db/campaignVersionStore';
import { getThreads } from '../../../../backend/services/engagementThreadService';
import {
  generateStrategicInsights,
  getLatestStrategicInsightReport,
  saveStrategicInsightReport,
} from '../../../../backend/services/strategicInsightService';

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
    if (!companyId) {
      return res.status(400).json({ error: 'Campaign must be linked to a company' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: false,
    });
    if (!access) return;

    const cached = await getLatestStrategicInsightReport(campaignId);
    if (cached) {
      return res.status(200).json(cached);
    }

    let campaignHealthReport: Record<string, unknown> | null = null;
    const { data: healthRow } = await supabase
      .from('campaign_health_reports')
      .select('report_json')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (healthRow?.report_json && typeof healthRow.report_json === 'object') {
      campaignHealthReport = healthRow.report_json as Record<string, unknown>;
    }

    const engagementHealthReport: Record<string, unknown> = {
      campaign_id: campaignId,
      company_id: companyId,
      engagement_status: 'unknown',
      total_posts: 0,
      engagement_rate: 0,
      reply_pending_count: 0,
      last_updated_at: new Date().toISOString(),
    };

    const trendSnapshots = await getTrendSnapshots(companyId, campaignId);
    const trendSignals = trendSnapshots.map((s: { snapshot?: unknown }) => ({
      snapshot: s?.snapshot ?? {},
    }));

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
        priority_score: t.priority_score,
        lead_detected: t.lead_detected,
        negative_feedback: t.negative_feedback,
        customer_question: t.customer_question,
      }));
    } catch {
      inboxSignals = [];
    }

    const report = await generateStrategicInsights({
      company_id: companyId,
      campaign_id: campaignId,
      campaign_health_report: campaignHealthReport,
      engagement_health_report: engagementHealthReport,
      trend_signals: trendSignals,
      inbox_signals: inboxSignals,
    });

    await saveStrategicInsightReport(report);
    return res.status(200).json(report);
  } catch (err) {
    console.error('[campaigns/strategic-insights]', err);
    return res.status(500).json({
      error: 'Failed to generate strategic insights',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
