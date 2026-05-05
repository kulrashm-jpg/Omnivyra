export interface PatternSignal {
  type: string;
  pattern: string;
  recommendation: string;
  evidence_count: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface CampaignRow {
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
}

export interface NextAction {
  campaign_id: string;
  campaign_name: string;
  action: 'continue' | 'optimize' | 'pivot';
  next_topic: string | null;
  decision_confidence_level: string | null;
  stability_signal: string | null;
  evaluation_score: number | null;
  priority: 'high' | 'medium' | 'low';
}

export interface Snapshot {
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
    patterns: PatternSignal[];
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
    metric_rankings: Array<{ metric: string; label: string; avg_ratio: number; avg_pct_of_target: number; campaigns_tracked: number }>;
    strongest_metric: string | null;
    weakest_metric: string | null;
    engagement_trend: string | null;
  };
  strategic_memory: {
    patterns: PatternSignal[];
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
  next_actions: NextAction[];
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
}

export type DerivedInsight = {
  title: string;
  detail: string;
  tone: 'strong' | 'moderate' | 'watch';
};

export type RoutedSystemAction = {
  text: string;
  href: string;
  label: string;
};
