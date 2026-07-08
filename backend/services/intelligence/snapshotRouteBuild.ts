/** Part 1/2 of snapshot.ts — verbatim split (barrel preserved; importers unchanged). */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCompanyContext } from '../../../backend/services/companyContextGuardService';
import { recognizePatterns, type CampaignRecord } from '../../../backend/lib/campaigns/patternRecognitionEngine';
import { getReportReadinessSummary } from '../../../backend/services/reportReadinessService';


export type CampaignRow = {
  id: string;
  name: string;
  goal_type: string | null;
  topic_seed: string | null;
  evaluation_status: 'exceeded' | 'met' | 'underperformed' | null;
  evaluation_score: number | null;
  recommended_action: 'continue' | 'optimize' | 'pivot' | null;
  stability_signal: 'stable' | 'sensitive' | 'volatile' | null;
  decision_confidence_level: string | null;
  data_confidence_level: string | null;
  next_topic: string | null;
  recorded_at: string | null;
};

export type SnapshotResponse = {
  company_id: string;
  generated_at: string;
  time_range_days: number;
  system_snapshot: {
    total_campaigns: number;
    evaluated_campaigns: number;
    avg_score: number;
    health: 'strong' | 'moderate' | 'weak';
    trend_signal: string | null;
    top_action: string | null;
    action_distribution: { continue: number; optimize: number; pivot: number };
    status_distribution: { exceeded: number; met: number; underperformed: number };
    campaigns_ready_to_scale: number;
  };
  campaign_status: CampaignRow[];
  content_performance: { top: CampaignRow[]; bottom: CampaignRow[]; all: CampaignRow[] };
  strategic_intelligence: {
    patterns: Array<{
      type: string;
      pattern: string;
      recommendation: string;
      evidence_count: number;
      confidence: 'high' | 'medium' | 'low';
    }>;
    dominant_topic_cluster: string | null;
    best_performing_goal: string | null;
    campaigns_analyzed: number;
    portfolio_avg_score: number;
  };
  campaign_dna: {
    goal_distribution: Record<string, number>;
    dominant_goal: string | null;
    topic_clusters: Array<{ cluster: string; count: number; avg_score: number }>;
    dominant_topic_cluster: string | null;
    dominant_action: string | null;
    stability_distribution: { stable: number; sensitive: number; volatile: number };
  };
  audience_response: {
    metric_rankings: Array<{
      metric: string;
      label: string;
      avg_ratio: number;
      avg_pct_of_target: number;
      campaigns_tracked: number;
    }>;
    strongest_metric: string | null;
    weakest_metric: string | null;
    engagement_trend: string | null;
  };
  strategic_memory: {
    patterns: Array<{
      type: string;
      pattern: string;
      recommendation: string;
      evidence_count: number;
      confidence: 'high' | 'medium' | 'low';
    }>;
    dominant_topic_cluster: string | null;
    best_performing_goal: string | null;
    campaigns_analyzed: number;
    portfolio_avg_score: number;
    decision_summary: { continue: number; optimize: number; pivot: number };
  };
  knowledge_graph_summary: {
    status: 'shallow' | 'emerging' | 'imbalanced' | 'maturing';
    topic_cluster_count: number;
    dominant_cluster: string | null;
    supporting_cluster_count: number;
    format_diversity: number;
    stage_coverage: {
      awareness: number;
      consideration: number;
      decision: number;
    };
    weakest_stage: 'awareness' | 'consideration' | 'decision' | null;
    report_depth: 'baseline' | 'operational' | 'growth';
  };
  next_actions: Array<{
    campaign_id: string;
    campaign_name: string;
    action: 'continue' | 'optimize' | 'pivot';
    next_topic: string | null;
    decision_confidence_level: string | null;
    stability_signal: string | null;
    evaluation_score: number | null;
    priority: 'high' | 'medium' | 'low';
  }>;
  reports_summary: {
    total_reports: number;
    analytics_reports: number;
    structured_reports: number;
    latest_report_at: string | null;
    latest_report_type: string | null;
    latest_report_age_days: number | null;
    report_type_mix: Array<{ type: string; count: number }>;
  };
  report_readiness_summary: {
    maturity_stage: 'foundational' | 'instrumented' | 'operational' | 'growth_mature';
    growth_integration_summary: {
      crm_connected: boolean;
      email_connected: boolean;
      outreach_connected: boolean;
      commerce_connected: boolean;
      event_signal_connected: boolean;
    };
    snapshot: {
      ready: boolean;
      state: 'not_ready' | 'partially_ready' | 'ready_now';
      missing_requirements: string[];
      reason: string;
    };
    performance: {
      ready: boolean;
      state: 'not_ready' | 'partially_ready' | 'collecting_baseline' | 'ready_soon' | 'ready_now';
      missing_requirements: string[];
      reason: string;
    };
    growth: {
      ready: boolean;
      state: 'not_ready' | 'partially_ready' | 'collecting_baseline' | 'ready_soon' | 'ready_now';
      missing_requirements: string[];
      reason: string;
    };
  };
  content_summary: {
    total_blogs: number;
    recent_blogs: number;
    content_type_mix: Array<{ type: string; count: number; recent_count: number }>;
  };
  campaign_mix_summary: {
    bolt_text: number;
    bolt_creator: number;
    intelligent_mix: number;
    strategy_mix: number;
    unknown: number;
    dominant_path: 'bolt_text' | 'bolt_creator' | 'intelligent_mix' | 'strategy_mix' | 'unknown' | null;
    total_versions: number;
  };
  distribution_summary: {
    connected_platforms: number;
    published_posts: number;
    failed_posts: number;
    scheduled_posts: number;
    active_platforms: number;
    dominant_platform: string | null;
    publish_success_rate: number;
    platform_mix: Array<{
      platform: string;
      total_posts: number;
      published_posts: number;
      failed_posts: number;
      share_pct: number;
      success_rate: number;
    }>;
  };
  timing_summary: {
    active_days: number;
    recent_content_events: number;
    recent_distribution_events: number;
    avg_gap_days: number | null;
    latest_activity_at: string | null;
    rhythm_state: 'thin' | 'steady' | 'strong';
  };
  engagement_summary: {
    connected_social_accounts: number;
    threads: number;
    messages: number;
    opportunities: number;
  };
  lead_summary: {
    engagement_signals: number;
    active_leads: number;
    suspect_active_leads: number;
    prospect_active_leads: number;
    qualified_active_leads: number;
  };
  market_pulse_summary: {
    completed_runs: number;
    latest_run_at: string | null;
    latest_findings: number;
  };
  intelligence_settings: {
    objective: string | null;
    target_metric: string | null;
    target_value: string | null;
    time_horizon: 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
    target_note: string | null;
    sales_motion: string | null;
    avg_deal_size: string | null;
    target_customer_segment: string | null;
  };
};

export function parseDays(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '30', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(parsed, 365);
}

export function deriveFallbackAction(score: number | null): 'continue' | 'optimize' | 'pivot' | null {
  if (score == null) return null;
  if (score >= 75) return 'continue';
  if (score >= 55) return 'optimize';
  return 'pivot';
}

export function deriveFallbackStability(history: Array<number | null>): 'stable' | 'sensitive' | 'volatile' | null {
  const values = history.filter((value): value is number => typeof value === 'number');
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  if (deviation >= 18) return 'volatile';
  if (deviation >= 9) return 'sensitive';
  return 'stable';
}

export function deriveFallbackConfidence(historyLength: number, score: number | null): string | null {
  if (historyLength >= 4 && score != null) return score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';
  if (historyLength >= 2) return 'medium';
  return historyLength > 0 ? 'low' : null;
}

export function derivePriority(action: 'continue' | 'optimize' | 'pivot', score: number | null, stability: string | null, confidence: string | null): 'high' | 'medium' | 'low' {
  let urgency = action === 'pivot' ? 3 : action === 'optimize' ? 2 : 1;
  if (stability === 'volatile') urgency += 2;
  else if (stability === 'sensitive') urgency += 1;
  if (confidence === 'low') urgency += 1;
  if (score != null && score < 45) urgency += 2;
  else if (score != null && score < 60) urgency += 1;
  if (urgency >= 6) return 'high';
  if (urgency >= 3) return 'medium';
  return 'low';
}

function clusterTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 2)
    .join(' ') || topic.toLowerCase().slice(0, 20);
}

export function buildAudienceMetricRankings(rows: Array<Record<string, unknown>>) {
  const metrics = [
    { metric: 'engagement_rate', label: 'Engagement Rate', target: 3 },
    { metric: 'total_comments', label: 'Comments', target: 8 },
    { metric: 'total_clicks', label: 'Clicks', target: 25 },
    { metric: 'total_shares', label: 'Shares', target: 5 },
    { metric: 'total_leads', label: 'Lead Signals', target: 3 },
  ];

  const rankings = metrics
    .map((definition) => {
      const values = rows
        .map((row) => row[definition.metric])
        .filter((value): value is number => typeof value === 'number');
      if (values.length === 0) return null;
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        metric: definition.metric,
        label: definition.label,
        avg_ratio: Number(avg.toFixed(2)),
        avg_pct_of_target: Math.round((avg / definition.target) * 100),
        campaigns_tracked: values.length,
      };
    })
    .filter(Boolean) as SnapshotResponse['audience_response']['metric_rankings'];

  rankings.sort((left, right) => right.avg_pct_of_target - left.avg_pct_of_target);
  return rankings;
}

export function buildTopicClusters(records: CampaignRecord[]) {
  const clusterMap = new Map<string, number[]>();
  for (const record of records) {
    if (!record.topic || record.evaluation_score == null) continue;
    const key = clusterTopic(record.topic);
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key)!.push(record.evaluation_score);
  }

  return [...clusterMap.entries()]
    .map(([cluster, scores]) => ({
      cluster,
      count: scores.length,
      avg_score: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    }))
    .sort((left, right) => right.avg_score - left.avg_score)
    .slice(0, 6);
}

export type CampaignVersionRow = {
  campaign_id?: string | null;
  build_mode?: string | null;
  campaign_types?: string[] | null;
  campaign_snapshot?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type CompanyIntegrationRow = {
  type?: string | null;
  name?: string | null;
  status?: string | null;
  config?: Record<string, unknown> | null;
};

export function classifyCampaignPath(row: CampaignVersionRow): 'bolt_text' | 'bolt_creator' | 'intelligent_mix' | 'strategy_mix' | 'unknown' {
  const snapshot =
    row.campaign_snapshot && typeof row.campaign_snapshot === 'object' && !Array.isArray(row.campaign_snapshot)
      ? row.campaign_snapshot
      : {};
  const executionConfig =
    snapshot.execution_config && typeof snapshot.execution_config === 'object' && !Array.isArray(snapshot.execution_config)
      ? (snapshot.execution_config as Record<string, unknown>)
      : {};
  const campaignMode = typeof executionConfig.campaign_mode === 'string' ? executionConfig.campaign_mode.toLowerCase() : null;
  const plannerMode = typeof snapshot.mode === 'string' ? snapshot.mode.toLowerCase() : null;
  const rawTypes = Array.isArray(row.campaign_types)
    ? row.campaign_types.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
    : [];

  if (campaignMode === 'combined') return 'intelligent_mix';
  if (plannerMode === 'direct') return 'strategy_mix';
  if (campaignMode === 'creator_dependent') return 'bolt_creator';
  if (rawTypes.includes('creator') || rawTypes.includes('video') || rawTypes.includes('reels')) return 'bolt_creator';
  if (rawTypes.includes('hybrid')) return 'intelligent_mix';
  if (rawTypes.includes('text')) return 'bolt_text';
  if ((row.build_mode ?? '').toLowerCase() === 'no_context') return 'bolt_text';
  return 'unknown';
}

export function integrationMatches(row: CompanyIntegrationRow, patterns: string[]): boolean {
  const haystack = [
    row.type,
    row.name,
    row.config && typeof row.config === 'object' ? JSON.stringify(row.config) : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function deriveReportMaturityStage(input: {
  performanceReady: boolean;
  growthReady: boolean;
  recentBlogs: number;
  evaluatedCampaigns: number;
  connectedSocialAccounts: number;
  threads: number;
  activeLeads: number;
  qualifiedLeads: number;
}): 'foundational' | 'instrumented' | 'operational' | 'growth_mature' {
  if (input.growthReady && (input.qualifiedLeads > 0 || input.activeLeads > 2) && input.evaluatedCampaigns >= 2) {
    return 'growth_mature';
  }
  if (input.performanceReady && (input.recentBlogs > 0 || input.evaluatedCampaigns > 0 || input.threads > 0)) {
    return 'operational';
  }
  if (input.performanceReady || input.connectedSocialAccounts > 0) {
    return 'instrumented';
  }
  return 'foundational';
}

export function deriveTimingThresholds(days: number): { strong: number; steady: number } {
  if (days <= 7) {
    return { strong: 3, steady: 2 };
  }
  if (days <= 30) {
    return { strong: 8, steady: 4 };
  }
  if (days <= 90) {
    return { strong: 20, steady: 10 };
  }
  return { strong: 32, steady: 16 };
}

export function mapContentTypeToStage(type: string): 'awareness' | 'consideration' | 'decision' {
  const normalized = type.toLowerCase();
  if (['post', 'story', 'thread', 'reel', 'video', 'social_post', 'tweet'].includes(normalized)) {
    return 'awareness';
  }
  if (['case_study', 'case-study', 'whitepaper', 'ebook', 'comparison', 'demo'].includes(normalized)) {
    return 'decision';
  }
  return 'consideration';
}

