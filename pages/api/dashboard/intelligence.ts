/**
 * GET /api/dashboard/intelligence
 * Aggregates campaign_health_reports, strategic_insights, opportunities, trend_signals for CMO dashboard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getTrendSnapshots } from '../../../backend/db/campaignVersionStore';
import {
  getMarketingMemoriesByType,
} from '../../../backend/services/marketingMemoryService';
import { listDecisionObjects } from '../../../backend/services/decisionObjectService';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';

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

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const campaignIds = new Set<string>();

    const { data: healthRows } = await supabase
      .from('campaign_health_reports')
      .select('campaign_id, report_json, health_score, health_status, issues')
      .eq('company_id', companyContext.companyId)
      .order('created_at', { ascending: false });

    const seenCampaigns = new Set<string>();
    const campaignHealthReports: Array<{
      campaign_id: string;
      campaign_name: string;
      health_score: number;
      health_status: string;
      issue_count: number;
    }> = [];

    for (const row of healthRows ?? []) {
      const cid = row?.campaign_id;
      if (!cid || seenCampaigns.has(cid)) continue;
      seenCampaigns.add(cid);
      campaignIds.add(cid);

      const report = row?.report_json as Record<string, unknown> | null;
      const issues = Array.isArray(row?.issues) ? row.issues : [];
      const issueCount = report?.issue_count ?? issues.length;

      const { data: camp } = await supabase
        .from('campaigns')
        .select('name')
        .eq('id', cid)
        .maybeSingle();

      campaignHealthReports.push({
        campaign_id: cid,
        campaign_name: (camp?.name as string) ?? 'Unknown',
        health_score: typeof row?.health_score === 'number' ? row.health_score : 50,
        health_status: String(row?.health_status ?? 'unknown'),
        issue_count: typeof issueCount === 'number' ? issueCount : issues.length,
      });
    }

    campaignHealthReports.sort((a, b) => a.health_score - b.health_score);

    const campaignAttribution: Record<string, number> = {
      opportunity: 0,
      trend: 0,
      strategic_insight: 0,
      manual: 0,
    };
    const campaignOriginsList: Array<{ campaign_id: string; campaign_name: string; origin_source: string }> = [];
    for (const r of campaignHealthReports) {
      const { data: camp } = await supabase
        .from('campaigns')
        .select('origin_source')
        .eq('id', r.campaign_id)
        .maybeSingle();
      const origin = (camp?.origin_source as string)?.trim() || 'manual';
      const key = ['opportunity', 'trend', 'strategic_insight', 'manual'].includes(origin) ? origin : 'manual';
      campaignAttribution[key] = (campaignAttribution[key] ?? 0) + 1;
      campaignOriginsList.push({
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        origin_source: key,
      });
    }

    const [strategicDecisionRows, opportunityDecisionRows] = await runInApiReadContext('dashboardIntelligenceApi', async () =>
      Promise.all([
        listDecisionObjects({
          viewName: 'growth_view',
          companyId: companyContext.companyId,
          sourceService: 'strategicInsightService',
          status: ['open'],
          limit: 50,
        }),
        listDecisionObjects({
          viewName: 'growth_view',
          companyId: companyContext.companyId,
          sourceService: 'opportunityDetectionService',
          status: ['open'],
          limit: 50,
        }),
      ])
    );

    const strategicInsights = strategicDecisionRows.map((row) => ({
      title: row.title,
      summary: row.description,
      confidence: row.confidence_score,
      recommended_action: row.recommendation,
    }));

    const opportunities = opportunityDecisionRows.map((row) => ({
      title: row.title,
      description: row.description,
      opportunity_score: row.priority_score,
      confidence: row.confidence_score,
      opportunity_type: row.issue_type,
    }));

    const trendSnapshots = await getTrendSnapshots(companyContext.companyId);
    const topicMap = new Map<string, { signal_strength: number; discussion_growth: number; count: number }>();
    for (const snap of trendSnapshots) {
      const s = snap?.snapshot as Record<string, unknown> | undefined;
      const emerging = Array.isArray(s?.emerging_trends) ? s.emerging_trends : [];
      const ranked = Array.isArray(s?.ranked_trends) ? s.ranked_trends : [];
      for (const t of [...emerging, ...ranked]) {
        const topic = (t as { topic?: string; name?: string })?.topic ?? (t as { topic?: string; name?: string })?.name ?? '';
        const strength = typeof (t as { strength?: number })?.strength === 'number' ? (t as { strength?: number }).strength : 0.7;
        const growth = typeof (t as { growth?: number })?.growth === 'number' ? (t as { growth?: number }).growth : 0.5;
        if (topic) {
          const key = String(topic).toLowerCase();
          const cur = topicMap.get(key) ?? { signal_strength: 0, discussion_growth: 0, count: 0 };
          topicMap.set(key, {
            signal_strength: cur.signal_strength + strength,
            discussion_growth: cur.discussion_growth + growth,
            count: cur.count + 1,
          });
        }
      }
    }
    const trendSignals = [...topicMap.entries()].map(([topic, v]) => ({
      topic,
      signal_strength: Math.min(1, v.signal_strength / Math.max(1, v.count)),
      discussion_growth: Math.min(1, v.discussion_growth / Math.max(1, v.count)),
    })).sort((a, b) => b.signal_strength - a.signal_strength);

    const STALE_THRESHOLD_MS = 60 * 60 * 1000;
    const { data: jobRunRows } = await supabase
      .from('intelligence_job_runs')
      .select('id, job_name, started_at, status')
      .order('started_at', { ascending: false })
      .limit(50);
    const schedulerRuns = (jobRunRows ?? []).map((row) => {
      const startedAt = row?.started_at as string | null;
      const status = String(row?.status ?? '');
      const is_stale =
        status === 'running' &&
        startedAt != null &&
        new Date(startedAt).getTime() < Date.now() - STALE_THRESHOLD_MS;
      return {
        id: row?.id,
        job_name: row?.job_name,
        started_at: startedAt,
        status,
        is_stale,
      };
    });

    const [contentMemories, narrativeMemories, audienceMemories] = await Promise.all([
      getMarketingMemoriesByType(companyContext.companyId, 'content_performance', 10),
      getMarketingMemoriesByType(companyContext.companyId, 'narrative_performance', 10),
      getMarketingMemoriesByType(companyContext.companyId, 'audience_pattern', 5),
    ]);
    const top_content_formats = contentMemories
      .map((m) => (m.memory_value?.format ? { format: m.memory_value.format, avg_engagement: m.memory_value.avg_engagement } : null))
      .filter(Boolean) as Array<{ format: string; avg_engagement?: number }>;
    const top_narratives = narrativeMemories
      .map((m) => (m.memory_value?.narrative ? { narrative: m.memory_value.narrative, engagement_score: m.memory_value.engagement_score } : null))
      .filter(Boolean) as Array<{ narrative: string; engagement_score?: number }>;
    const audience_patterns = audienceMemories
      .map((m) => m.memory_value?.segments as string[] | undefined)
      .filter(Boolean)
      .flat();

    return res.status(200).json({
      campaign_health_reports: campaignHealthReports,
      campaign_attribution: campaignAttribution,
      campaign_origins: campaignOriginsList,
      strategic_insights: strategicInsights,
      opportunities,
      trend_signals: trendSignals,
      scheduler_runs: schedulerRuns,
      marketing_memory: {
        top_content_formats,
        top_narratives,
        audience_patterns: [...new Set(audience_patterns)].slice(0, 10),
      },
    });
  } catch (err) {
    console.error('[dashboard/intelligence]', err);
    return res.status(500).json({
      error: 'Failed to fetch dashboard intelligence',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
