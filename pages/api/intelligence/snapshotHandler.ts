/** Part 2/2 of snapshot.ts — verbatim split (barrel preserved; importers unchanged). */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { recognizePatterns, type CampaignRecord } from '../../../backend/lib/campaigns/patternRecognitionEngine';
import { getReportReadinessSummary } from '../../../backend/services/reportReadinessService';

import { type CampaignRow, type SnapshotResponse, parseDays, deriveFallbackAction, deriveFallbackStability, deriveFallbackConfidence, derivePriority, buildAudienceMetricRankings, buildTopicClusters, type CampaignVersionRow, type CompanyIntegrationRow, classifyCampaignPath, integrationMatches, deriveReportMaturityStage, deriveTimingThresholds, mapContentTypeToStage } from './snapshotBuild';

function deriveKnowledgeGraphStatus(input: {
  topicClusterCount: number;
  formatDiversity: number;
  stageCoverage: { awareness: number; consideration: number; decision: number };
}): 'shallow' | 'emerging' | 'imbalanced' | 'maturing' {
  const coveredStages = Object.values(input.stageCoverage).filter((value) => value > 0).length;
  const weakestStageValue = Math.min(...Object.values(input.stageCoverage));
  const strongestStageValue = Math.max(...Object.values(input.stageCoverage));

  if (input.topicClusterCount <= 1 && input.formatDiversity <= 1) return 'shallow';
  if (coveredStages < 3 || (strongestStageValue > 0 && weakestStageValue === 0)) return 'imbalanced';
  if (input.topicClusterCount >= 3 && input.formatDiversity >= 3 && coveredStages === 3) return 'maturing';
  return 'emerging';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SnapshotResponse | { error: string }>) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId as string | undefined)?.trim();
  const days = parseDays(req.query.days);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId });
    if (!companyContext) return;

    const [
      campaignsResult,
      performanceResult,
      blogsResult,
      campaignVersionsResult,
      companyIntegrationsResult,
      reportsResult,
      analyticsReportsResult,
      socialAccountsResult,
      threadsCountResult,
      messagesCountResult,
      opportunitiesCountResult,
      engagementLeadSignalsResult,
      activeLeadsResult,
      marketPulseRunsResult,
      companyProfileResult,
    ] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, name, goal_type, topic_seed, source_blog_id, created_at')
        .eq('company_id', companyContext.companyId),
      supabase
        .from('campaign_performance')
        .select('campaign_id, evaluation_status, evaluation_score, recorded_at, total_reach, engagement_rate, total_comments, total_clicks, total_shares, total_leads, recommended_action, next_topic, decision_confidence_level, stability_signal, confidence_level')
        .eq('company_id', companyContext.companyId)
        .gte('recorded_at', sinceIso)
        .order('recorded_at', { ascending: false }),
      supabase
        .from('blogs')
        .select('id, created_at, content_type')
        .eq('company_id', companyContext.companyId),
      supabase
        .from('campaign_versions')
        .select('campaign_id, build_mode, campaign_types, campaign_snapshot, created_at')
        .eq('company_id', companyContext.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('company_integrations')
        .select('type, name, status, config')
        .eq('company_id', companyContext.companyId),
      supabase
        .from('reports')
        .select('id, created_at, report_type')
        .eq('company_id', companyContext.companyId),
      supabase
        .from('analytics_reports')
        .select('id, created_at')
        .eq('company_id', companyContext.companyId),
      supabase
        .from('social_accounts')
        .select('id', { count: 'exact' })
        .eq('company_id', companyContext.companyId)
        .eq('is_active', true),
      supabase
        .from('engagement_threads')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', companyContext.companyId),
      supabase
        .from('engagement_messages')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', companyContext.companyId),
      supabase
        .from('engagement_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', companyContext.companyId),
      supabase
        .from('lead_signals')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', companyContext.companyId)
        .eq('source_type', 'engagement'),
      supabase
        .from('active_leads')
        .select('id, bucket, created_at')
        .eq('company_id', companyContext.companyId),
      supabase
        .from('market_pulse_runs')
        .select('id, status, completed_at, created_at')
        .eq('company_id', companyContext.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('company_profiles')
        .select('campaign_purpose_intent, goals, report_settings, sales_motion, avg_deal_size, target_customer_segment')
        .eq('company_id', companyContext.companyId)
        .maybeSingle(),
    ]);

    const campaigns = (campaignsResult.data ?? []) as Array<{
      id: string;
      name: string | null;
      goal_type: string | null;
      topic_seed: string | null;
      source_blog_id: string | null;
      created_at?: string | null;
    }>;
    const campaignIds = campaigns.map((campaign) => campaign.id).filter(Boolean);
    const performanceRows = (performanceResult.data ?? []) as Array<Record<string, unknown>>;
    const latestByCampaign = new Map<string, Record<string, unknown>>();
    const historyByCampaign = new Map<string, Array<number | null>>();

    for (const row of performanceRows) {
      const campaignIdValue = typeof row.campaign_id === 'string' ? row.campaign_id : null;
      if (!campaignIdValue) continue;
      if (!latestByCampaign.has(campaignIdValue)) latestByCampaign.set(campaignIdValue, row);
      if (!historyByCampaign.has(campaignIdValue)) historyByCampaign.set(campaignIdValue, []);
      historyByCampaign.get(campaignIdValue)!.push(typeof row.evaluation_score === 'number' ? row.evaluation_score : null);
    }

    const campaignRows: CampaignRow[] = campaigns.map((campaign) => {
      const latest = latestByCampaign.get(campaign.id);
      const score = typeof latest?.evaluation_score === 'number' ? latest.evaluation_score : null;
      const history = historyByCampaign.get(campaign.id) ?? [];
      const recommendedAction = (latest?.recommended_action as CampaignRow['recommended_action']) ?? deriveFallbackAction(score);
      const confidenceLevel = (latest?.decision_confidence_level as string | null) ?? deriveFallbackConfidence(history.length, score);
      const stabilitySignal = (latest?.stability_signal as CampaignRow['stability_signal']) ?? deriveFallbackStability(history);

      return {
        id: campaign.id,
        name: campaign.name ?? 'Untitled campaign',
        goal_type: campaign.goal_type ?? null,
        topic_seed: campaign.topic_seed ?? null,
        evaluation_status: (latest?.evaluation_status as CampaignRow['evaluation_status']) ?? null,
        evaluation_score: score,
        recommended_action: recommendedAction,
        stability_signal: stabilitySignal,
        decision_confidence_level: confidenceLevel,
        data_confidence_level: (latest?.confidence_level as string | null) ?? confidenceLevel,
        next_topic: (latest?.next_topic as string | null) ?? campaign.topic_seed ?? null,
        recorded_at: (latest?.recorded_at as string | null) ?? campaign.created_at ?? null,
      };
    });

    const evaluatedCampaigns = campaignRows.filter((row) => row.evaluation_score != null);
    const evaluatedScores = evaluatedCampaigns
      .map((row) => row.evaluation_score)
      .filter((value): value is number => typeof value === 'number');
    const avgScore = evaluatedScores.length > 0
      ? Math.round(evaluatedScores.reduce((sum, value) => sum + value, 0) / evaluatedScores.length)
      : 0;

    const patternInput: CampaignRecord[] = evaluatedCampaigns.map((row) => ({
      campaign_id: row.id,
      campaign_name: row.name,
      topic: row.topic_seed,
      goal_type: row.goal_type,
      evaluation_status: row.evaluation_status,
      evaluation_score: row.evaluation_score,
      recorded_at: row.recorded_at ?? new Date().toISOString(),
      source_blog_type: null,
    }));

    const memory = recognizePatterns(patternInput);
    const trendPattern = memory.patterns.find((pattern) => pattern.type === 'momentum');
    const trendSignal = trendPattern
      ? trendPattern.pattern.toLowerCase().includes('upward')
        ? 'improving'
        : trendPattern.pattern.toLowerCase().includes('downward')
          ? 'declining'
          : 'stable'
      : null;

    const actionDistribution = { continue: 0, optimize: 0, pivot: 0 };
    const statusDistribution = { exceeded: 0, met: 0, underperformed: 0 };

    campaignRows.forEach((row) => {
      if (row.recommended_action) actionDistribution[row.recommended_action] += 1;
      if (row.evaluation_status) statusDistribution[row.evaluation_status] += 1;
    });

    const nextActions = campaignRows
      .filter((row) => row.recommended_action)
      .map((row) => ({
        campaign_id: row.id,
        campaign_name: row.name,
        action: row.recommended_action as 'continue' | 'optimize' | 'pivot',
        next_topic: row.next_topic,
        decision_confidence_level: row.decision_confidence_level,
        stability_signal: row.stability_signal,
        evaluation_score: row.evaluation_score,
        priority: derivePriority(
          row.recommended_action as 'continue' | 'optimize' | 'pivot',
          row.evaluation_score,
          row.stability_signal,
          row.decision_confidence_level,
        ),
      }))
      .sort((left, right) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[left.priority] - order[right.priority];
      });

    const topAction = nextActions[0]?.action ?? null;
    const campaignsReadyToScale = campaignRows.filter((row) => row.evaluation_status === 'exceeded' || row.recommended_action === 'continue').length;
    const health = avgScore >= 70 ? 'strong' : avgScore >= 50 ? 'moderate' : 'weak';

    const rankedCampaigns = [...evaluatedCampaigns].sort((left, right) => (right.evaluation_score ?? 0) - (left.evaluation_score ?? 0));
    const topicClusters = buildTopicClusters(patternInput);
    const goalDistribution = campaignRows.reduce<Record<string, number>>((acc, row) => {
      if (!row.goal_type) return acc;
      acc[row.goal_type] = (acc[row.goal_type] ?? 0) + 1;
      return acc;
    }, {});
    const stabilityDistribution = campaignRows.reduce(
      (acc, row) => {
        if (!row.stability_signal) return acc;
        acc[row.stability_signal] += 1;
        return acc;
      },
      { stable: 0, sensitive: 0, volatile: 0 },
    );
    const dominantGoal = Object.entries(goalDistribution).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
    const dominantAction = Object.entries(actionDistribution).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

    const audienceMetricRankings = buildAudienceMetricRankings(performanceRows);
    const strongestMetric = audienceMetricRankings[0]?.metric ?? null;
    const weakestMetric = audienceMetricRankings[audienceMetricRankings.length - 1]?.metric ?? null;

    const campaignVersions = (campaignVersionsResult.data ?? []) as CampaignVersionRow[];
    const activeCompanyIntegrations = ((companyIntegrationsResult.data ?? []) as CompanyIntegrationRow[])
      .filter((row) => (row.status ?? '').toLowerCase() === 'connected');
    const growthIntegrationSummary: SnapshotResponse['report_readiness_summary']['growth_integration_summary'] = {
      crm_connected: activeCompanyIntegrations.some((row) => integrationMatches(row, ['hubspot', 'salesforce', 'pipedrive', 'zoho crm', 'crm'])),
      email_connected: activeCompanyIntegrations.some((row) => integrationMatches(row, ['mailchimp', 'sendgrid', 'convertkit', 'klaviyo', 'mailerlite', 'email'])),
      outreach_connected: activeCompanyIntegrations.some((row) => integrationMatches(row, ['apollo', 'outreach', 'salesloft', 'cold email', 'sequence'])),
      commerce_connected: activeCompanyIntegrations.some((row) => integrationMatches(row, ['shopify', 'woocommerce', 'stripe'])),
      event_signal_connected: activeCompanyIntegrations.some((row) => integrationMatches(row, ['eventbrite', 'zoom', 'webinar', 'podcast', 'airmeet', 'hopin'])),
    };
    const latestVersionByCampaign = new Map<string, CampaignVersionRow>();
    const orphanVersions: CampaignVersionRow[] = [];
    for (const row of campaignVersions) {
      const campaignIdValue = typeof row.campaign_id === 'string' ? row.campaign_id : null;
      if (!campaignIdValue) {
        orphanVersions.push(row);
        continue;
      }
      if (!latestVersionByCampaign.has(campaignIdValue)) {
        latestVersionByCampaign.set(campaignIdValue, row);
      }
    }
    const campaignPathRows = [...latestVersionByCampaign.values(), ...orphanVersions];
    const campaignMixSummary = campaignPathRows.reduce<SnapshotResponse['campaign_mix_summary']>(
      (acc, row) => {
        const path = classifyCampaignPath(row);
        acc[path] += 1;
        acc.total_versions += 1;
        return acc;
      },
      {
        bolt_text: 0,
        bolt_creator: 0,
        intelligent_mix: 0,
        strategy_mix: 0,
        unknown: 0,
        dominant_path: null,
        total_versions: 0,
      },
    );
    const dominantCampaignPath = (Object.entries({
      bolt_text: campaignMixSummary.bolt_text,
      bolt_creator: campaignMixSummary.bolt_creator,
      intelligent_mix: campaignMixSummary.intelligent_mix,
      strategy_mix: campaignMixSummary.strategy_mix,
      unknown: campaignMixSummary.unknown,
    }).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null) as SnapshotResponse['campaign_mix_summary']['dominant_path'];
    campaignMixSummary.dominant_path =
      campaignMixSummary.total_versions > 0 && dominantCampaignPath ? dominantCampaignPath : null;

    let distributionSummary: SnapshotResponse['distribution_summary'] = {
      connected_platforms: socialAccountsResult.count ?? 0,
      published_posts: 0,
      failed_posts: 0,
      scheduled_posts: 0,
      active_platforms: 0,
      dominant_platform: null,
      publish_success_rate: 0,
      platform_mix: [],
    };
    let timingSummary: SnapshotResponse['timing_summary'] = {
      active_days: 0,
      recent_content_events: 0,
      recent_distribution_events: 0,
      avg_gap_days: null,
      latest_activity_at: null,
      rhythm_state: 'thin',
    };
    let scheduledPostRows: Array<{ status?: string | null; platform?: string | null; created_at?: string | null }> = [];
    if (campaignIds.length > 0) {
      const { data: scheduledPosts } = await supabase
        .from('scheduled_posts')
        .select('status, platform, created_at')
        .in('campaign_id', campaignIds)
        .gte('created_at', sinceIso);

      const platformCounts = new Map<string, { total_posts: number; published_posts: number; failed_posts: number }>();
      const rows = (scheduledPosts ?? []) as Array<{ status?: string | null; platform?: string | null; created_at?: string | null }>;
      scheduledPostRows = rows;
      let publishedPosts = 0;
      let failedPosts = 0;
      let scheduledPostsCount = 0;

      for (const row of rows) {
        const status = String(row.status || '').toLowerCase();
        if (status === 'published') publishedPosts += 1;
        else if (status === 'failed') failedPosts += 1;
        else if (status === 'scheduled') scheduledPostsCount += 1;

        const platform = String(row.platform || '').trim().toLowerCase();
        if (platform) {
          const stats = platformCounts.get(platform) ?? { total_posts: 0, published_posts: 0, failed_posts: 0 };
          stats.total_posts += 1;
          if (status === 'published') stats.published_posts += 1;
          if (status === 'failed') stats.failed_posts += 1;
          platformCounts.set(platform, stats);
        }
      }

      const denominator = publishedPosts + failedPosts;
      const platformMix = [...platformCounts.entries()]
        .map(([platform, stats]) => ({
          platform,
          total_posts: stats.total_posts,
          published_posts: stats.published_posts,
          failed_posts: stats.failed_posts,
          share_pct: rows.length > 0 ? Math.round((stats.total_posts / rows.length) * 100) : 0,
          success_rate:
            stats.published_posts + stats.failed_posts > 0
              ? Math.round((stats.published_posts / (stats.published_posts + stats.failed_posts)) * 100)
              : 0,
        }))
        .sort((left, right) => right.total_posts - left.total_posts);
      distributionSummary = {
        connected_platforms: socialAccountsResult.count ?? 0,
        published_posts: publishedPosts,
        failed_posts: failedPosts,
        scheduled_posts: scheduledPostsCount,
        active_platforms: platformCounts.size,
        dominant_platform: platformMix[0]?.platform ?? null,
        publish_success_rate: denominator > 0 ? Math.round((publishedPosts / denominator) * 100) : 0,
        platform_mix: platformMix,
      };
    }

    const reports = (reportsResult.data ?? []) as Array<{ id: string; created_at?: string | null; report_type?: string | null }>;
    const analyticsReports = analyticsReportsResult.data ?? [];
    const reportTypeMixMap = new Map<string, number>();
    for (const report of reports) {
      const type = String(report.report_type || 'snapshot').trim().toLowerCase() || 'snapshot';
      reportTypeMixMap.set(type, (reportTypeMixMap.get(type) ?? 0) + 1);
    }
    const reportTypeMix = [...reportTypeMixMap.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count);
    const allReportDates = [...reports, ...analyticsReports]
      .map((row) => ('created_at' in row ? row.created_at : null))
      .filter((value): value is string => typeof value === 'string')
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
    const latestStructuredReport = [...reports]
      .filter((row) => typeof row.created_at === 'string')
      .sort((left, right) => new Date(right.created_at as string).getTime() - new Date(left.created_at as string).getTime())[0] ?? null;

    const blogs = (blogsResult.data ?? []) as Array<{ id: string; created_at?: string | null; content_type?: string | null }>;
    const recentBlogs = blogs.filter((row) => typeof row.created_at === 'string' && row.created_at >= sinceIso).length;
    const contentTypeMixMap = new Map<string, { count: number; recent_count: number }>();
    for (const blog of blogs) {
      const type = String(blog.content_type || 'blog').trim().toLowerCase() || 'blog';
      const current = contentTypeMixMap.get(type) ?? { count: 0, recent_count: 0 };
      current.count += 1;
      if (typeof blog.created_at === 'string' && blog.created_at >= sinceIso) {
        current.recent_count += 1;
      }
      contentTypeMixMap.set(type, current);
    }
    const contentTypeMix = [...contentTypeMixMap.entries()]
      .map(([type, stats]) => ({ type, count: stats.count, recent_count: stats.recent_count }))
      .sort((left, right) => right.count - left.count);
    const stageCoverage = contentTypeMix.reduce(
      (acc, item) => {
        const stage = mapContentTypeToStage(item.type);
        acc[stage] += item.count;
        return acc;
      },
      { awareness: 0, consideration: 0, decision: 0 },
    );
    const weakestStage = (Object.entries(stageCoverage).sort((left, right) => left[1] - right[1])[0]?.[0] ?? null) as SnapshotResponse['knowledge_graph_summary']['weakest_stage'];
    const reportDepth: SnapshotResponse['knowledge_graph_summary']['report_depth'] =
      reportTypeMix.some((item) => item.type === 'growth')
        ? 'growth'
        : reportTypeMix.some((item) => item.type === 'performance')
          ? 'operational'
          : 'baseline';
    const knowledgeGraphSummary: SnapshotResponse['knowledge_graph_summary'] = {
      status: deriveKnowledgeGraphStatus({
        topicClusterCount: topicClusters.length,
        formatDiversity: contentTypeMix.length,
        stageCoverage,
      }),
      topic_cluster_count: topicClusters.length,
      dominant_cluster: memory.dominant_topic_cluster,
      supporting_cluster_count: Math.max(topicClusters.length - (memory.dominant_topic_cluster ? 1 : 0), 0),
      format_diversity: contentTypeMix.length,
      stage_coverage: stageCoverage,
      weakest_stage: weakestStage,
      report_depth: reportDepth,
    };
    const contentActivityDates = blogs
      .map((row) => row.created_at)
      .filter((value): value is string => typeof value === 'string' && value >= sinceIso);
    const distributionActivityDates = scheduledPostRows
      .map((row) => row.created_at)
      .filter((value): value is string => typeof value === 'string');
    const activityDates = [...contentActivityDates, ...distributionActivityDates]
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());
    const uniqueActivityDays = [...new Set(activityDates.map((value) => value.toISOString().slice(0, 10)))];
    const avgGapDays =
      activityDates.length >= 2
        ? Number(
            (
              activityDates.slice(1).reduce((sum, value, index) => {
                const previous = activityDates[index];
                return sum + (value.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);
              }, 0) /
              (activityDates.length - 1)
            ).toFixed(1),
          )
        : null;
    const thresholds = deriveTimingThresholds(days);
    const rhythmState: SnapshotResponse['timing_summary']['rhythm_state'] =
      uniqueActivityDays.length >= thresholds.strong
        ? 'strong'
        : uniqueActivityDays.length >= thresholds.steady
          ? 'steady'
          : 'thin';
    timingSummary = {
      active_days: uniqueActivityDays.length,
      recent_content_events: contentActivityDates.length,
      recent_distribution_events: distributionActivityDates.length,
      avg_gap_days: avgGapDays,
      latest_activity_at: activityDates[activityDates.length - 1]?.toISOString() ?? null,
      rhythm_state: rhythmState,
    };

    const marketPulseRuns = (marketPulseRunsResult.data ?? []) as Array<{ id: string; status: string; completed_at: string | null; created_at: string | null }>;
    const completedMarketPulseRuns = marketPulseRuns.filter((row) => row.status === 'completed' || row.status === 'completed_with_warnings');
    const latestCompletedMarketPulseRun = completedMarketPulseRuns[0] ?? null;
    let latestFindings = 0;
    if (latestCompletedMarketPulseRun?.id) {
      const { count } = await supabase
        .from('market_pulse_findings')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', latestCompletedMarketPulseRun.id);
      latestFindings = count ?? 0;
    }

    const activeLeads = (activeLeadsResult.data ?? []) as Array<{ id: string; bucket: string | null; created_at?: string | null }>;
    const reportReadiness = await getReportReadinessSummary({ companyId: companyContext.companyId });
    const qualifiedActiveLeads = activeLeads.filter((row) => row.bucket === 'qualified').length;
    const growthCommercialSignalsCount = Object.values(growthIntegrationSummary).filter(Boolean).length;
    const maturityStage = deriveReportMaturityStage({
      performanceReady: reportReadiness.reports.performance.ready,
      growthReady: reportReadiness.reports.growth.ready && growthCommercialSignalsCount >= 2,
      recentBlogs,
      evaluatedCampaigns: evaluatedCampaigns.length,
      connectedSocialAccounts: socialAccountsResult.count ?? 0,
      threads: threadsCountResult.count ?? 0,
      activeLeads: activeLeads.length,
      qualifiedLeads: qualifiedActiveLeads,
    });
    const performanceState: SnapshotResponse['report_readiness_summary']['performance']['state'] =
      reportReadiness.reports.performance.ready
        ? recentBlogs > 0 || evaluatedCampaigns.length > 0 || (threadsCountResult.count ?? 0) > 0
          ? 'ready_now'
          : 'collecting_baseline'
        : reportReadiness.reports.performance.missing_requirements.length <= 2
          ? 'ready_soon'
          : 'partially_ready';
    const growthState: SnapshotResponse['report_readiness_summary']['growth']['state'] =
      reportReadiness.reports.growth.ready && growthCommercialSignalsCount >= 2
        ? (activeLeads.length > 0 || evaluatedCampaigns.length >= 2 || completedMarketPulseRuns.length > 0)
          ? 'ready_now'
          : 'collecting_baseline'
        : reportReadiness.reports.growth.ready
          ? 'partially_ready'
        : reportReadiness.reports.growth.missing_requirements.length <= 2
          ? 'ready_soon'
          : 'partially_ready';
    const companyProfile = (companyProfileResult.data ?? null) as {
      campaign_purpose_intent?: { primary_objective?: string | null } | null;
      goals?: string | null;
      sales_motion?: string | null;
      avg_deal_size?: string | null;
      target_customer_segment?: string | null;
      report_settings?: {
        intelligence?: {
          primary_objective?: string | null;
          primary_target_metric?: string | null;
          target_value?: string | null;
          time_horizon?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
          target_note?: string | null;
        } | null;
      } | null;
    };
    const intelligenceSettings = companyProfile?.report_settings?.intelligence ?? null;
    const intelligenceObjective =
      intelligenceSettings?.primary_objective ??
      companyProfile?.campaign_purpose_intent?.primary_objective ??
      null;

    const latestReportAt = allReportDates[0] ?? null;
    const latestReportAgeDays = latestReportAt
      ? Math.max(0, Math.floor((Date.now() - new Date(latestReportAt).getTime()) / (24 * 60 * 60 * 1000)))
      : null;

    const response: SnapshotResponse = {
      company_id: companyContext.companyId,
      generated_at: new Date().toISOString(),
      time_range_days: days,
      system_snapshot: {
        total_campaigns: campaignRows.length,
        evaluated_campaigns: evaluatedCampaigns.length,
        avg_score: avgScore,
        health,
        trend_signal: trendSignal,
        top_action: topAction,
        action_distribution: actionDistribution,
        status_distribution: statusDistribution,
        campaigns_ready_to_scale: campaignsReadyToScale,
      },
      campaign_status: [...campaignRows].sort((left, right) => (right.evaluation_score ?? -1) - (left.evaluation_score ?? -1)),
      content_performance: {
        top: rankedCampaigns.slice(0, 3),
        bottom: [...rankedCampaigns].reverse().slice(0, Math.min(3, rankedCampaigns.length)),
        all: rankedCampaigns,
      },
      strategic_intelligence: {
        patterns: memory.patterns,
        dominant_topic_cluster: memory.dominant_topic_cluster,
        best_performing_goal: memory.best_performing_goal,
        campaigns_analyzed: memory.campaigns_analyzed,
        portfolio_avg_score: memory.portfolio_avg_score,
      },
      campaign_dna: {
        goal_distribution: goalDistribution,
        dominant_goal: dominantGoal,
        topic_clusters: topicClusters,
        dominant_topic_cluster: memory.dominant_topic_cluster,
        dominant_action: dominantAction,
        stability_distribution: stabilityDistribution,
      },
      audience_response: {
        metric_rankings: audienceMetricRankings,
        strongest_metric: strongestMetric,
        weakest_metric: weakestMetric,
        engagement_trend: trendSignal === 'improving'
          ? 'Audience response is strengthening across recent campaign activity.'
          : trendSignal === 'declining'
            ? 'Audience response is softening and needs attention before scaling.'
            : 'Audience response is steady, without a strong upward or downward shift.',
      },
      strategic_memory: {
        patterns: memory.patterns,
        dominant_topic_cluster: memory.dominant_topic_cluster,
        best_performing_goal: memory.best_performing_goal,
        campaigns_analyzed: memory.campaigns_analyzed,
        portfolio_avg_score: memory.portfolio_avg_score,
        decision_summary: actionDistribution,
      },
      knowledge_graph_summary: knowledgeGraphSummary,
      next_actions: nextActions,
      reports_summary: {
        total_reports: reports.length + analyticsReports.length,
        analytics_reports: analyticsReports.length,
        structured_reports: reports.length,
        latest_report_at: latestReportAt,
        latest_report_type: latestStructuredReport?.report_type ?? null,
        latest_report_age_days: latestReportAgeDays,
        report_type_mix: reportTypeMix,
      },
      content_summary: {
        total_blogs: blogs.length,
        recent_blogs: recentBlogs,
        content_type_mix: contentTypeMix,
      },
      campaign_mix_summary: campaignMixSummary,
      distribution_summary: distributionSummary,
      timing_summary: timingSummary,
      engagement_summary: {
        connected_social_accounts: socialAccountsResult.count ?? 0,
        threads: threadsCountResult.count ?? 0,
        messages: messagesCountResult.count ?? 0,
        opportunities: opportunitiesCountResult.count ?? 0,
      },
      lead_summary: {
        engagement_signals: engagementLeadSignalsResult.count ?? 0,
        active_leads: activeLeads.length,
        suspect_active_leads: activeLeads.filter((row) => row.bucket === 'suspect').length,
        prospect_active_leads: activeLeads.filter((row) => row.bucket === 'prospect').length,
        qualified_active_leads: qualifiedActiveLeads,
      },
      market_pulse_summary: {
        completed_runs: completedMarketPulseRuns.length,
        latest_run_at: latestCompletedMarketPulseRun?.completed_at ?? latestCompletedMarketPulseRun?.created_at ?? null,
        latest_findings: latestFindings,
      },
      report_readiness_summary: {
        maturity_stage: maturityStage,
        growth_integration_summary: growthIntegrationSummary,
        snapshot: {
          ready: reportReadiness.reports.snapshot.ready,
          state: reportReadiness.reports.snapshot.ready ? 'ready_now' : 'not_ready',
          missing_requirements: reportReadiness.reports.snapshot.missing_requirements,
          reason: reportReadiness.reports.snapshot.ready
            ? 'The company has enough foundational context for a baseline diagnostic.'
            : 'The foundational profile and website context are still incomplete for a reliable baseline report.',
        },
        performance: {
          ready: reportReadiness.reports.performance.ready,
          state: performanceState,
          missing_requirements: reportReadiness.reports.performance.missing_requirements,
          reason: reportReadiness.reports.performance.ready
            ? performanceState === 'collecting_baseline'
              ? 'Core performance inputs are connected, but the system still needs more live operating signal before the report becomes fully useful.'
              : 'The company has the integration coverage and operating signal needed for a meaningful Performance Intelligence report.'
            : 'Performance Intelligence still needs stronger instrumentation before it can produce trustworthy optimization guidance.',
        },
        growth: {
          ready: reportReadiness.reports.growth.ready && growthCommercialSignalsCount >= 2,
          state: growthState,
          missing_requirements: reportReadiness.reports.growth.ready && growthCommercialSignalsCount < 2
            ? [
                ...reportReadiness.reports.growth.missing_requirements,
                'Connect at least two broader growth systems such as CRM, email/outreach, commerce, or event/webinar platforms',
              ]
            : reportReadiness.reports.growth.missing_requirements,
          reason: reportReadiness.reports.growth.ready && growthCommercialSignalsCount >= 2
            ? growthState === 'collecting_baseline'
              ? 'Growth inputs are connected, but the company still needs more accumulated commercial signal before this report becomes decision-grade.'
              : 'The company has enough growth instrumentation, commercial-system coverage, and operating maturity for a meaningful Market & Growth Intelligence report.'
            : reportReadiness.reports.growth.ready
              ? 'Core growth inputs are present, but broader commercial-system coverage is still too thin for a truly mature Market & Growth Intelligence report.'
            : 'Market & Growth Intelligence still needs broader growth instrumentation and commercial context before it will create real value.',
        },
      },
      intelligence_settings: {
        objective: intelligenceObjective,
        target_metric: intelligenceSettings?.primary_target_metric ?? null,
        target_value: intelligenceSettings?.target_value ?? null,
        time_horizon: intelligenceSettings?.time_horizon ?? 'monthly',
        target_note: intelligenceSettings?.target_note ?? null,
        sales_motion: companyProfile?.sales_motion ?? null,
        avg_deal_size: companyProfile?.avg_deal_size ?? null,
        target_customer_segment: companyProfile?.target_customer_segment ?? null,
      },
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[intelligence/snapshot]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build intelligence snapshot' });
  }
}

