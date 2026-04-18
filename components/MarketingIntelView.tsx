/**
 * Marketing Intelligence Command Center  — /marketing-intelligence
 *
 * Executive polish layer:
 *   Part 1 — Executive summary narrative (dynamic, in-memory)
 *   Part 2 — Enhanced priority signals (stability + confidence + impact)
 *   Part 3 — Global time-range filter (7 / 30 / 90 days, persisted)
 *   Part 4 — Section microcopy (clarity layer under every header)
 *   Part 5 — Contextual action CTAs (insight → execution)
 *   Part 6 — Zero extra API calls; all derived values in-memory
 *   Part 7 — Graceful fallbacks throughout
 *
 * Access: COMPANY_ADMIN and above only.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, ArrowRight,
  AlertCircle, Brain, Activity, Settings, Eye, EyeOff, Loader2,
  Clock,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PatternSignal {
  type: string;
  pattern: string;
  recommendation: string;
  evidence_count: number;
  confidence: 'high' | 'medium' | 'low';
}

interface CampaignRow {
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

interface NextAction {
  campaign_id: string;
  campaign_name: string;
  action: 'continue' | 'optimize' | 'pivot';
  next_topic: string | null;
  decision_confidence_level: string | null;
  stability_signal: string | null;
  evaluation_score: number | null;
  priority: 'high' | 'medium' | 'low';
}

interface Snapshot {
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

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Executive summary generation (pure, in-memory)
// ─────────────────────────────────────────────────────────────────────────────

function generateExecutiveSummary(snapshot: Snapshot): string | null {
  const { system_snapshot: ss, strategic_intelligence, next_actions, audience_response } = snapshot;
  if (ss.evaluated_campaigns === 0) return null;

  const sentences: string[] = [];

  // Sentence 1: Portfolio state + trend + score
  const trendPhrase =
    ss.trend_signal === 'improving' ? 'trending upward' :
    ss.trend_signal === 'declining' ? 'showing a downward trend' : 'holding steady';
  const healthPhrase =
    ss.health === 'strong'   ? 'performing strongly' :
    ss.health === 'moderate' ? 'performing at a moderate level' : 'underperforming against targets';
  sentences.push(
    `Marketing performance is ${trendPhrase}, with the portfolio ${healthPhrase} at an average score of ${ss.avg_score}/100 across ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns !== 1 ? 's' : ''}.`
  );

  // Sentence 2: Strongest performing area
  const topicStrength = strategic_intelligence.patterns.find((p) => p.type === 'topic_strength' && p.confidence !== 'low');
  const goalAffinity  = strategic_intelligence.patterns.find((p) => p.type === 'goal_affinity'  && p.confidence !== 'low');
  const topMetric     = audience_response.metric_rankings[0];

  if (topicStrength) {
    sentences.push(topicStrength.pattern);
  } else if (goalAffinity) {
    sentences.push(goalAffinity.pattern);
  } else if (topMetric && topMetric.avg_pct_of_target >= 90) {
    sentences.push(
      `Audience response is strongest in ${topMetric.label.toLowerCase()} at ${topMetric.avg_pct_of_target}% of benchmark, indicating strong content-to-audience fit in this area.`
    );
  } else if (ss.campaigns_ready_to_scale > 0) {
    sentences.push(
      `${ss.campaigns_ready_to_scale} campaign${ss.campaigns_ready_to_scale !== 1 ? 's are' : ' is'} exceeding targets and ready to scale.`
    );
  }

  // Sentence 3: Weak signal or gap
  const volatility    = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const bottomMetric  = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const underperformed = ss.status_distribution.underperformed;

  if (volatility) {
    sentences.push(
      'Strategy consistency is flagged — high variance across campaigns suggests execution is outpacing strategic clarity.'
    );
  } else if (bottomMetric && bottomMetric.avg_pct_of_target < 85 && audience_response.metric_rankings.length > 1) {
    sentences.push(
      `${bottomMetric.label} consistently sits below benchmark at ${bottomMetric.avg_pct_of_target}% — a focused effort here could lift overall portfolio performance.`
    );
  } else if (underperformed > 0) {
    sentences.push(
      `${underperformed} campaign${underperformed !== 1 ? 's' : ''} ${underperformed !== 1 ? 'are' : 'is'} underperforming and warrant strategic review before the next planning cycle.`
    );
  }

  // Sentence 4: Directional recommendation
  const highPriority = next_actions.filter((a) => computeEnhancedPriority(a).priority === 'high');
  const pivots       = next_actions.filter((a) => a.action === 'pivot');
  const scales       = next_actions.filter((a) => a.action === 'continue');

  if (highPriority.length > 0) {
    sentences.push(
      `Immediate priority: ${highPriority.length} action${highPriority.length !== 1 ? 's' : ''} require${highPriority.length === 1 ? 's' : ''} urgent attention — ${pivots.length > 0 ? 'direction changes cannot be delayed without further performance loss' : 'low-confidence decisions should be validated with additional data before committing resources'}.`
    );
  } else if (scales.length > 0 && scales.length >= pivots.length) {
    sentences.push(
      'Strategic direction is clear: scale what is working while making incremental refinements to campaigns in optimisation mode.'
    );
  } else if (pivots.length > 0) {
    sentences.push(
      `Direction changes are recommended for ${pivots.length} campaign${pivots.length !== 1 ? 's' : ''} — fresh topic angles should be explored before the next content cycle.`
    );
  } else {
    sentences.push(
      'Record additional performance data to sharpen these signals and unlock campaign-specific recommendations.'
    );
  }

  return sentences.join(' ');
}

function generateExecutiveSummaryV2(snapshot: Snapshot): string | null {
  const { system_snapshot: ss, strategic_intelligence, next_actions, audience_response, intelligence_settings, lead_summary } = snapshot;
  if (ss.evaluated_campaigns === 0) return null;

  const sentences: string[] = [];
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const tracking = deriveTargetTracking(snapshot);
  const topMetric = audience_response.metric_rankings[0];
  const bottomMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const volatility = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const highPriority = next_actions.filter((a) => computeEnhancedPriority(a).priority === 'high');
  const pivots = next_actions.filter((a) => a.action === 'pivot');
  const scales = next_actions.filter((a) => a.action === 'continue');

  if (tracking.progressRatio != null && tracking.currentValue != null && tracking.metricLabel && intelligence_settings.target_value) {
    const pacePhrase =
      tracking.progressRatio >= 1 ? 'already ahead of target' :
      tracking.progressRatio >= 0.6 ? 'currently on track' :
      'currently behind target';
    sentences.push(
      `${objectiveLabel} is ${pacePhrase}, with ${tracking.currentValue} of ${intelligence_settings.target_value} ${tracking.metricLabel} achieved${tracking.horizonLabel ? ` in the current ${tracking.horizonLabel} window` : ''}.`
    );
  } else {
    const trendPhrase =
      ss.trend_signal === 'improving' ? 'trending upward' :
      ss.trend_signal === 'declining' ? 'showing a downward trend' : 'holding steady';
    const healthPhrase =
      ss.health === 'strong' ? 'performing strongly' :
      ss.health === 'moderate' ? 'performing at a moderate level' : 'underperforming against targets';
    sentences.push(
      `${objectiveLabel} is ${trendPhrase}, with the portfolio ${healthPhrase} at an average score of ${ss.avg_score}/100 across ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns !== 1 ? 's' : ''}.`
    );
  }

  if (lead_summary.qualified_active_leads > 0 && tracking.metricLabel?.includes('lead')) {
    sentences.push(
      `${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} already give the system real commercial proof, not just engagement noise.`
    );
  } else if (topMetric && topMetric.avg_pct_of_target >= 90) {
    sentences.push(
      `Audience response is strongest in ${topMetric.label.toLowerCase()} at ${topMetric.avg_pct_of_target}% of benchmark, indicating strong content-to-audience fit in this area.`
    );
  } else if (ss.campaigns_ready_to_scale > 0) {
    sentences.push(
      `${ss.campaigns_ready_to_scale} campaign${ss.campaigns_ready_to_scale !== 1 ? 's are' : ' is'} exceeding targets and ready to scale.`
    );
  }

  if (volatility) {
    sentences.push(
      'Strategy consistency is flagged — high variance across campaigns suggests execution is outpacing strategic clarity.'
    );
  } else if (bottomMetric && bottomMetric.avg_pct_of_target < 85) {
    sentences.push(
      `${bottomMetric.label} remains the weakest link, so fixing that drag is more important than simply increasing activity volume.`
    );
  } else if (ss.status_distribution.underperformed > 0) {
    sentences.push(
      `${ss.status_distribution.underperformed} campaign${ss.status_distribution.underperformed !== 1 ? 's' : ''} are still underperforming and need correction before scaling the whole system harder.`
    );
  }

  if (tracking.progressRatio != null && tracking.progressRatio >= 0.6 && (ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0)) {
    sentences.push(
      'The opportunity now is not only to hit the target, but to push beyond it by activating the next commercial motion while signal quality is favorable.'
    );
  } else if (highPriority.length > 0) {
    sentences.push(
      `Immediate priority: ${highPriority.length} action${highPriority.length !== 1 ? 's' : ''} require${highPriority.length === 1 ? 's' : ''} urgent attention${pivots.length > 0 ? ', especially where direction changes are already clear.' : '.'}`
    );
  } else if (scales.length > 0 && scales.length >= pivots.length) {
    sentences.push(
      'Strategic direction is clear: scale what is working while making incremental refinements to the weaker parts of the system.'
    );
  } else {
    sentences.push(
      'The next step is to deepen signal quality so future recommendations can move from guidance into stronger commercial action.'
    );
  }

  return sentences.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — Enhanced priority classification (stability + confidence + impact)
// ─────────────────────────────────────────────────────────────────────────────

function computeEnhancedPriority(action: NextAction): {
  priority: 'high' | 'medium' | 'low';
  label: string;
  dot: string;
  text: string;
} {
  let urgency = 0;

  // Action base (pivot = most urgent, continue = least)
  if (action.action === 'pivot')    urgency += 3;
  else if (action.action === 'optimize') urgency += 2;
  else urgency += 1;

  // Stability risk (volatile decision = more urgent)
  if (action.stability_signal === 'volatile')  urgency += 2;
  else if (action.stability_signal === 'sensitive') urgency += 1;

  // Low confidence = more urgent to resolve
  if (action.decision_confidence_level === 'low') urgency += 1;

  // Performance gap
  const score = action.evaluation_score ?? 70;
  if (score < 45) urgency += 2;
  else if (score < 60) urgency += 1;

  if (urgency >= 6) return { priority: 'high',   label: 'High priority', dot: 'bg-red-400',     text: 'text-red-600'     };
  if (urgency >= 3) return { priority: 'medium',  label: 'Watch',         dot: 'bg-amber-400',   text: 'text-amber-600'   };
  return               { priority: 'low',    label: 'Opportunity',   dot: 'bg-emerald-400', text: 'text-emerald-600' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — Time range config + localStorage
// ─────────────────────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { days: 7,  label: '7d'  },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
] as const;
type TimeRange = typeof TIME_RANGES[number]['days'];

const TIME_RANGE_KEY    = 'omnivyra_micc_timerange';
const SECTIONS_KEY      = 'omnivyra_micc_sections';

function loadTimeRange(): TimeRange {
  if (typeof window === 'undefined') return 30;
  const raw = localStorage.getItem(TIME_RANGE_KEY);
  const n = parseInt(raw ?? '', 10);
  return (TIME_RANGES.map((r) => r.days) as number[]).includes(n) ? (n as TimeRange) : 30;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section config
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { key: 'system_snapshot',        label: 'System Snapshot'        },
  { key: 'next_actions',           label: 'Next Actions'           },
  { key: 'campaign_status',        label: 'Campaign Status'        },
  { key: 'content_performance',    label: 'Content Performance'    },
  { key: 'strategic_intelligence', label: 'Strategic Intelligence' },
  { key: 'campaign_dna',           label: 'Campaign DNA'           },
  { key: 'audience_response',      label: 'Audience Response'      },
  { key: 'strategic_memory',       label: 'Strategic Memory'       },
] as const;
type SectionKey = typeof SECTIONS[number]['key'];
const ALL_SECTION_KEYS = new Set<SectionKey>(SECTIONS.map((s) => s.key));

function loadVisibility(): Set<SectionKey> {
  if (typeof window === 'undefined') return new Set(ALL_SECTION_KEYS);
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return new Set(ALL_SECTION_KEYS);
    return new Set(JSON.parse(raw) as SectionKey[]);
  } catch { return new Set(ALL_SECTION_KEYS); }
}
function saveVisibility(v: Set<SectionKey>) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify([...v]));
}

// Part 4 — Section microcopy
const SECTION_DESCRIPTION: Record<SectionKey, string> = {
  system_snapshot:        'Overall health and current direction of your marketing activity',
  next_actions:           'Recommended steps based on recent performance and strategic signals',
  campaign_status:        'Current state of all campaigns and their performance',
  content_performance:    'Top and bottom performing campaigns based on outcomes',
  strategic_intelligence: 'Patterns and momentum derived from campaign performance',
  campaign_dna:           'How your campaigns are structured and what consistently works',
  audience_response:      'How your audience is reacting across key performance metrics',
  strategic_memory:       'What your system has learned over time from past decisions',
};

// ─────────────────────────────────────────────────────────────────────────────
// Visual helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  exceeded:      { label: 'Exceeded',       dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  met:           { label: 'Met Goals',      dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 border-blue-200'          },
  underperformed:{ label: 'Underperformed', dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-200'       },
} as const;

const ACTION_CFG = {
  continue: { label: 'Continue', icon: TrendingUp, colour: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
  optimize: { label: 'Optimise', icon: RefreshCw,  colour: 'text-blue-600',    bg: 'bg-blue-50 border-blue-100'       },
  pivot:    { label: 'Pivot',    icon: ArrowRight, colour: 'text-amber-600',   bg: 'bg-amber-50 border-amber-100'     },
} as const;

const STABILITY_CFG = {
  stable:   { label: 'Stable',  dot: 'bg-emerald-400', text: 'text-emerald-600' },
  sensitive:{ label: 'Monitor', dot: 'bg-blue-400',    text: 'text-blue-600'    },
  volatile: { label: 'Volatile',dot: 'bg-amber-400',   text: 'text-amber-600'   },
} as const;

const HEALTH_CFG = {
  strong:   { label: 'Strong',   colour: 'text-emerald-600', bg: 'bg-emerald-50' },
  moderate: { label: 'Moderate', colour: 'text-blue-600',    bg: 'bg-blue-50'    },
  weak:     { label: 'Weak',     colour: 'text-amber-600',   bg: 'bg-amber-50'   },
} as const;

const GOAL_LABELS: Record<string, string> = {
  awareness: 'Awareness', engagement: 'Engagement', authority: 'Authority',
  lead_gen: 'Lead Gen', conversion: 'Conversion',
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  snapshot: 'Digital Authority Snapshot',
  performance: 'Performance Intelligence',
  growth: 'Market Growth Intelligence',
  strategic: 'Strategic Intelligence',
};

const REPORT_READINESS_LABELS: Record<string, string> = {
  not_ready: 'Not ready',
  partially_ready: 'Partially ready',
  collecting_baseline: 'Collecting baseline data',
  ready_soon: 'Ready soon',
  ready_now: 'Ready now',
};

const INTELLIGENCE_OBJECTIVE_LABELS: Record<string, string> = {
  authority_growth: 'Authority growth',
  engagement_growth: 'Engagement growth',
  lead_generation: 'Lead generation',
  pipeline_growth: 'Pipeline growth',
  revenue_acceleration: 'Revenue acceleration',
};

const TARGET_METRIC_LABELS: Record<string, string> = {
  qualified_leads: 'qualified leads',
  active_leads: 'active leads',
  engagement_rate: 'engagement rate',
  campaigns_ready_to_scale: 'campaigns ready to scale',
  content_velocity: 'content velocity',
  authority_depth: 'authority depth',
  pipeline_value: 'pipeline value',
  revenue: 'revenue',
};

const CAMPAIGN_PATH_LABELS: Record<string, string> = {
  bolt_text: 'BOLT Text',
  bolt_creator: 'BOLT Creator',
  intelligent_mix: 'Intelligent Mix',
  strategy_mix: 'Strategy Mix',
  unknown: 'Unclassified path',
};

const TIME_HORIZON_LABELS: Record<string, string> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
};

const PATTERN_TYPE_LABELS: Record<string, string> = {
  topic_strength: 'Topic Strength', goal_affinity: 'Goal Affinity',
  volatility: 'Volatility', momentum: 'Momentum', source_pattern: 'Content Source',
};

function scoreColour(s: number | null) {
  if (s == null) return 'text-gray-300';
  return s >= 70 ? 'text-emerald-600' : s >= 50 ? 'text-blue-600' : 'text-amber-600';
}

function toSentenceCase(value: string | null | undefined) {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseTargetNumber(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/[\d,.]+/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getIntelligenceObjectiveLabel(snapshot: Snapshot) {
  const objective = snapshot.intelligence_settings?.objective;
  if (!objective) return 'Operating intelligence';
  return INTELLIGENCE_OBJECTIVE_LABELS[objective] ?? toSentenceCase(objective) ?? 'Operating intelligence';
}

function getTargetMetricLabel(snapshot: Snapshot) {
  const targetMetric = snapshot.intelligence_settings?.target_metric;
  if (!targetMetric) return null;
  return TARGET_METRIC_LABELS[targetMetric] ?? targetMetric.replace(/_/g, ' ');
}

function formatContentTypeLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCampaignPathLabel(value: string | null | undefined) {
  if (!value) return null;
  return CAMPAIGN_PATH_LABELS[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatReportTypeLabel(value: string | null | undefined) {
  if (!value) return null;
  return REPORT_TYPE_LABELS[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPlatformLabel(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'x') return 'X';
  if (normalized === 'linkedin') return 'LinkedIn';
  if (normalized === 'facebook') return 'Facebook';
  if (normalized === 'instagram') return 'Instagram';
  if (normalized === 'youtube') return 'YouTube';
  if (normalized === 'tiktok') return 'TikTok';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function shouldRefreshCurrentReport(snapshot: Snapshot) {
  const latestReportAgeDays = snapshot.reports_summary.latest_report_age_days;
  if (latestReportAgeDays == null || latestReportAgeDays < 90) return false;

  const tracking = deriveTargetTracking(snapshot);
  const weakestMetric = snapshot.audience_response.metric_rankings[snapshot.audience_response.metric_rankings.length - 1];
  const performanceIsWeak =
    snapshot.system_snapshot.health === 'weak' ||
    snapshot.system_snapshot.trend_signal === 'declining' ||
    snapshot.system_snapshot.status_distribution.underperformed > 0 ||
    (tracking.progressRatio != null && tracking.progressRatio < 0.6) ||
    (weakestMetric?.avg_pct_of_target ?? 100) < 85;

  return performanceIsWeak;
}

function deriveTargetTracking(snapshot: Snapshot) {
  const { intelligence_settings, lead_summary, system_snapshot, content_summary } = snapshot;
  const targetNumber = parseTargetNumber(intelligence_settings?.target_value);
  const metricLabel = getTargetMetricLabel(snapshot);
  const horizonLabel = intelligence_settings?.time_horizon
    ? TIME_HORIZON_LABELS[intelligence_settings.time_horizon]
    : null;

  const currentValue =
    intelligence_settings?.target_metric === 'qualified_leads'
      ? lead_summary.qualified_active_leads
      : intelligence_settings?.target_metric === 'active_leads'
        ? lead_summary.active_leads
        : intelligence_settings?.target_metric === 'campaigns_ready_to_scale'
          ? system_snapshot.campaigns_ready_to_scale
          : intelligence_settings?.target_metric === 'content_velocity'
            ? content_summary.recent_blogs
            : null;

  const progressRatio =
    targetNumber && currentValue != null && targetNumber > 0 ? currentValue / targetNumber : null;

  return {
    targetNumber,
    currentValue,
    progressRatio,
    metricLabel,
    horizonLabel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard — Part 4 microcopy via `description` prop
// ─────────────────────────────────────────────────────────────────────────────

interface SectionCardProps {
  sectionKey?: SectionKey;
  title: string;
  badge?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

function SectionCard({ sectionKey, title, badge, children, footer, className = '' }: SectionCardProps) {
  const description = sectionKey ? SECTION_DESCRIPTION[sectionKey] : undefined;
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</p>
          {badge && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{badge}</span>}
        </div>
        {description && <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
      {footer && <div className="px-6 pb-5 pt-0">{footer}</div>}
    </div>
  );
}

// Part 5 — CTA helper
function SectionCta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-[#0A66C2] hover:border-[#0A66C2] hover:text-white transition-colors"
    >
      {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Executive Summary component
// ─────────────────────────────────────────────────────────────────────────────

function ExecutiveSummary({ snapshot }: { snapshot: Snapshot }) {
  const text = generateExecutiveSummaryV2(snapshot) ?? generateExecutiveSummary(snapshot);
  if (!text) return null;

  const ss = snapshot.system_snapshot;
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const tracking = deriveTargetTracking(snapshot);
  const TrendIcon =
    ss.trend_signal === 'improving' ? TrendingUp :
    ss.trend_signal === 'declining' ? TrendingDown : Minus;
  const trendColour =
    ss.trend_signal === 'improving' ? 'text-emerald-500' :
    ss.trend_signal === 'declining' ? 'text-amber-500' : 'text-gray-400';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-8 py-6">
      <div className="flex items-start gap-4">
        <div className={`mt-0.5 shrink-0 ${trendColour}`}>
          <TrendIcon className="h-5 w-5" />
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Executive Summary</p>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{objectiveLabel}</span>
            {tracking.metricLabel && snapshot.intelligence_settings.target_value && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                {snapshot.intelligence_settings.target_value} {tracking.metricLabel}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 leading-relaxed max-w-4xl">{text}</p>
          <p className="mt-2 text-[10px] text-gray-400">
            Based on {ss.evaluated_campaigns} evaluated campaign{ss.evaluated_campaigns !== 1 ? 's' : ''} · last {snapshot.time_range_days} days
          </p>
        </div>
      </div>
    </div>
  );
}

function ObjectiveSetupNotice({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.intelligence_settings.objective && snapshot.intelligence_settings.target_metric && snapshot.intelligence_settings.target_value) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Operating target needed</p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-amber-900/85">
            Intelligence is now able to track pace against a declared objective, but this company still needs a clearer operating target.
            Add the primary objective, target metric, target value, and time horizon in company profile so this page can judge whether performance is behind, on track, or capable of surpassing the goal.
          </p>
        </div>
        <Link
          href="/company-profile"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
        >
          Set target
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

type DerivedInsight = {
  title: string;
  detail: string;
  tone: 'strong' | 'moderate' | 'watch';
};

function toneClasses(tone: DerivedInsight['tone']) {
  if (tone === 'strong') {
    return {
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      text: 'text-emerald-600',
    };
  }
  if (tone === 'watch') {
    return {
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      text: 'text-amber-600',
    };
  }
  return {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    text: 'text-blue-600',
  };
}

function deriveOperatingOverview(snapshot: Snapshot): Array<{ label: string; value: string; helper: string; tone: DerivedInsight['tone'] }> {
  const { system_snapshot: ss, audience_response, strategic_memory, lead_summary, reports_summary, intelligence_settings, timing_summary } = snapshot;
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const horizonLabel = intelligence_settings?.time_horizon ? TIME_HORIZON_LABELS[intelligence_settings.time_horizon] : 'monthly';
  const momentumTone: DerivedInsight['tone'] =
    ss.trend_signal === 'improving' ? 'strong' :
    ss.trend_signal === 'declining' ? 'watch' : 'moderate';
  const readinessTone: DerivedInsight['tone'] =
    ss.campaigns_ready_to_scale > 0 ? 'strong' :
    ss.status_distribution.underperformed > 0 ? 'watch' : 'moderate';
  const confidenceTone: DerivedInsight['tone'] =
    ss.evaluated_campaigns >= 6 ? 'strong' :
    ss.evaluated_campaigns >= 3 ? 'moderate' : 'watch';
  const graphTone: DerivedInsight['tone'] =
    strategic_memory.campaigns_analyzed >= 5 && strategic_memory.dominant_topic_cluster ? 'strong' :
    strategic_memory.campaigns_analyzed >= 2 ? 'moderate' : 'watch';
  const rhythmTone: DerivedInsight['tone'] =
    timing_summary.rhythm_state === 'strong' ? 'strong' :
    timing_summary.rhythm_state === 'steady' ? 'moderate' : 'watch';

  return [
    {
      label: 'Current state',
      value: HEALTH_CFG[ss.health].label,
      helper: `${ss.avg_score}/100 average across evaluated activity for ${objectiveLabel.toLowerCase()}`,
      tone: ss.health === 'strong' ? 'strong' : ss.health === 'weak' ? 'watch' : 'moderate',
    },
    {
      label: 'Momentum',
      value: ss.trend_signal ? ss.trend_signal[0].toUpperCase() + ss.trend_signal.slice(1) : 'Stable',
      helper: audience_response.engagement_trend ?? `No clear ${horizonLabel} shift is visible yet`,
      tone: momentumTone,
    },
    {
      label: 'Commercial readiness',
      value: lead_summary.qualified_active_leads > 0 || ss.campaigns_ready_to_scale > 0 ? 'Ready' : lead_summary.active_leads > 0 || ss.status_distribution.met > 0 ? 'Emerging' : 'Early',
      helper: lead_summary.qualified_active_leads > 0
        ? `${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} already support a stronger next motion`
        : ss.campaigns_ready_to_scale > 0
          ? `${ss.campaigns_ready_to_scale} campaign${ss.campaigns_ready_to_scale === 1 ? '' : 's'} can support a stronger next motion`
          : 'Signals still need stronger proof before full escalation',
      tone: readinessTone,
    },
    {
      label: 'Operating rhythm',
      value: timing_summary.rhythm_state === 'strong' ? 'Strong' : timing_summary.rhythm_state === 'steady' ? 'Steady' : 'Thin',
      helper: timing_summary.active_days > 0
        ? `${timing_summary.active_days} active day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days${timing_summary.avg_gap_days != null ? ` with an average ${timing_summary.avg_gap_days}-day gap between visible content or distribution events` : ''}`
        : `No meaningful content or distribution rhythm is visible in the last ${snapshot.time_range_days} days`,
      tone: rhythmTone,
    },
    {
      label: 'Evidence confidence',
      value: ss.evaluated_campaigns >= 6 ? 'Strong' : ss.evaluated_campaigns >= 3 ? 'Moderate' : 'Early',
      helper: reports_summary.total_reports > 0
        ? `Built from ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns === 1 ? '' : 's'} plus ${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days`
        : `Built from ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days`,
      tone: confidenceTone,
    },
    {
      label: 'Knowledge graph',
      value: strategic_memory.dominant_topic_cluster ? 'Building' : 'Shallow',
      helper: strategic_memory.dominant_topic_cluster
        ? `${strategic_memory.dominant_topic_cluster} is becoming the strongest authority cluster`
        : 'Topic depth is still too thin to show a dominant authority cluster',
      tone: graphTone,
    },
  ];
}

function deriveTargetPotential(snapshot: Snapshot) {
  const { system_snapshot: ss, strategic_intelligence, audience_response, lead_summary, intelligence_settings, timing_summary } = snapshot;
  const topMetric = audience_response.metric_rankings[0];
  const weakestMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const metricLabel = getTargetMetricLabel(snapshot);
  const targetValue = intelligence_settings?.target_value ?? null;
  const targetNumber = parseTargetNumber(targetValue);
  const currentValue =
    intelligence_settings?.target_metric === 'qualified_leads'
      ? lead_summary.qualified_active_leads
      : intelligence_settings?.target_metric === 'active_leads'
        ? lead_summary.active_leads
        : intelligence_settings?.target_metric === 'campaigns_ready_to_scale'
          ? ss.campaigns_ready_to_scale
          : intelligence_settings?.target_metric === 'content_velocity'
            ? snapshot.content_summary.recent_blogs
            : null;
  const progressRatio =
    targetNumber && currentValue != null && targetNumber > 0 ? currentValue / targetNumber : null;
  const targetGap =
    targetNumber && currentValue != null && targetNumber > 0
      ? Math.max(targetNumber - currentValue, 0)
      : null;
  const upsideDriver =
    ss.campaigns_ready_to_scale > 0
      ? `${ss.campaigns_ready_to_scale} high-performing campaign${ss.campaigns_ready_to_scale === 1 ? '' : 's'} can be scaled harder`
      : strategic_intelligence.best_performing_goal
        ? `${GOAL_LABELS[strategic_intelligence.best_performing_goal] ?? strategic_intelligence.best_performing_goal} is the strongest goal pattern so far`
        : 'The current system still needs more evidence before pushing harder';

  return {
    objectiveLabel,
    targetLabel: metricLabel && targetValue
      ? `${targetValue} ${metricLabel} ${intelligence_settings?.time_horizon ? `this ${TIME_HORIZON_LABELS[intelligence_settings.time_horizon]}` : ''}`.trim()
      : metricLabel
        ? `${metricLabel} ${intelligence_settings?.time_horizon ? `this ${TIME_HORIZON_LABELS[intelligence_settings.time_horizon]}` : ''}`.trim()
        : null,
    currentPace: progressRatio != null
      ? progressRatio >= 1
        ? 'Ahead of target'
        : progressRatio >= 0.6
          ? 'On track'
          : 'Behind target'
      : ss.health === 'strong'
        ? 'Above baseline'
        : ss.health === 'moderate'
          ? 'On baseline'
          : 'Below baseline',
    currentProgress: progressRatio != null && currentValue != null && targetValue
      ? `${Math.round(progressRatio * 100)}% of target reached`
      : null,
    currentDetail:
      progressRatio != null && currentValue != null && metricLabel
        ? `Current delivery is at ${currentValue} of ${targetValue} ${metricLabel}, which is the clearest present-state read for ${objectiveLabel.toLowerCase()}.`
        : ss.health === 'strong'
          ? 'Current activity is creating enough signal to support stronger commercial moves.'
          : ss.health === 'moderate'
            ? 'The system is moving, but it still needs tighter execution to create consistent upside.'
            : 'Current momentum is not strong enough yet to justify aggressive scaling.',
    potential:
      ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0 || (topMetric && topMetric.avg_pct_of_target >= 95)
        ? 'Upside available'
        : 'Limited upside',
    potentialDetail: lead_summary.qualified_active_leads > 0
      ? `${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} can be moved into a stronger conversion motion now`
      : upsideDriver,
    targetNote: intelligence_settings?.target_note ?? null,
    targetGap,
    upsideProjection:
      targetNumber && currentValue != null && metricLabel
        ? progressRatio != null && progressRatio >= 1 && (ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0)
          ? `Current signals suggest the team can exceed the declared target if the next motion is activated quickly.`
          : progressRatio != null && progressRatio >= 0.6 && targetGap != null
            ? `${targetGap} more ${metricLabel} would close the current target, and current upside suggests the ceiling may be higher than that.`
            : progressRatio != null && targetGap != null
              ? `${targetGap} more ${metricLabel} are still needed, so execution has to tighten before upside becomes realistic.`
              : null
        : null,
    delayCost:
      progressRatio != null && progressRatio >= 0.6 && (ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0)
        ? 'If the next motion is delayed, warm demand may cool off and the current upside window will narrow.'
        : timing_summary.rhythm_state === 'thin'
          ? 'If the operating rhythm stays thin, even good ideas will keep arriving too slowly to compound into reliable traction.'
        : weakestMetric && weakestMetric.avg_pct_of_target < 85
          ? `If ${weakestMetric.label.toLowerCase()} is not fixed soon, the system will keep creating activity without converting enough of it into the target outcome.`
          : 'If nothing changes, the system is likely to plateau before it captures the full upside available.',
    risk:
      timing_summary.rhythm_state === 'thin'
        ? `The current rhythm is too light for ${objectiveLabel.toLowerCase()} and will likely delay target attainment even if individual signals look promising.`
        : weakestMetric && weakestMetric.avg_pct_of_target < 85
        ? `${weakestMetric.label} remains the main drag. If it is not corrected, growth will flatten even if top signals look healthy.`
        : ss.status_distribution.underperformed > 0
          ? `${ss.status_distribution.underperformed} campaign${ss.status_distribution.underperformed === 1 ? '' : 's'} are dragging the portfolio and could slow overall progress if left unchanged.`
          : 'No major drag is visible yet, but the portfolio still needs more operating depth to avoid plateauing.',
  };
}

function deriveLearnedSignals(snapshot: Snapshot): DerivedInsight[] {
  const {
    strategic_intelligence,
    content_performance,
    audience_response,
    strategic_memory,
    reports_summary,
    content_summary,
    campaign_mix_summary,
    distribution_summary,
    timing_summary,
    engagement_summary,
    lead_summary,
    market_pulse_summary,
  } = snapshot;
  const learned: DerivedInsight[] = [];
  const topicStrength = strategic_intelligence.patterns.find((p) => p.type === 'topic_strength');
  const goalAffinity = strategic_intelligence.patterns.find((p) => p.type === 'goal_affinity');
  const volatility = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const topContent = content_performance.top[0];
  const weakestMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const topContentType = content_summary.content_type_mix[0];
  const secondContentType = content_summary.content_type_mix[1];
  const topReportType = reports_summary.report_type_mix[0];
  const secondReportType = reports_summary.report_type_mix[1];
  const topPlatform = distribution_summary.platform_mix[0];
  const secondPlatform = distribution_summary.platform_mix[1];
  const shouldRefreshReport = shouldRefreshCurrentReport(snapshot);
  const maturityStageLabel = snapshot.report_readiness_summary.maturity_stage.replace(/_/g, ' ');
  const growthIntegrationSummary = snapshot.report_readiness_summary.growth_integration_summary;
  const growthSystemCount = Object.values(growthIntegrationSummary).filter(Boolean).length;
  const dominantCampaignPath = formatCampaignPathLabel(campaign_mix_summary.dominant_path);
  const campaignPathCounts = [
    { key: 'bolt_text', count: campaign_mix_summary.bolt_text },
    { key: 'bolt_creator', count: campaign_mix_summary.bolt_creator },
    { key: 'intelligent_mix', count: campaign_mix_summary.intelligent_mix },
    { key: 'strategy_mix', count: campaign_mix_summary.strategy_mix },
  ].filter((item) => item.count > 0).sort((left, right) => right.count - left.count);
  const secondCampaignPath = campaignPathCounts[1];

  if (topicStrength) {
    learned.push({
      title: 'Reports and campaign signals are pointing to a winning topic cluster',
      detail: topicStrength.pattern,
      tone: topicStrength.confidence === 'high' ? 'strong' : 'moderate',
    });
  }
  if (reports_summary.total_reports > 0) {
    learned.push({
      title: shouldRefreshReport ? 'The current report layer is becoming stale for present decisions' : 'Report activity is starting to shape operating clarity',
      detail: topReportType
        ? `${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'} have been generated so far${reports_summary.latest_report_at ? `, most recently at ${new Date(reports_summary.latest_report_at).toLocaleDateString()}` : ''}. ${formatReportTypeLabel(topReportType.type)} is currently the most-used report path${secondReportType ? `, followed by ${formatReportTypeLabel(secondReportType.type)}` : ''}, which gives the system a clearer base for deciding what diagnostic depth is still missing.`
        : shouldRefreshReport && reports_summary.latest_report_age_days != null && reports_summary.latest_report_type
          ? `The latest ${formatReportTypeLabel(reports_summary.latest_report_type)} is already ${reports_summary.latest_report_age_days} days old, and current signals are not moving strongly enough to rely on it as the main diagnostic lens.`
        : `${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'} have been generated so far${reports_summary.latest_report_at ? `, most recently at ${new Date(reports_summary.latest_report_at).toLocaleDateString()}` : ''}. That means the system has enough diagnostic input to recommend deeper execution shifts instead of generic guesses.`,
      tone: shouldRefreshReport ? 'watch' : reports_summary.total_reports >= 2 ? 'strong' : 'moderate',
    });
  }
  learned.push({
    title: 'Report readiness now depends on maturity, not only on connected tools',
    detail: `The company is currently in the ${maturityStageLabel} stage. ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.performance.state]} for Performance Intelligence and ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.growth.state]} for Market & Growth Intelligence means the next report suggestion should follow readiness and data depth, not just ambition.`,
    tone:
      snapshot.report_readiness_summary.growth.state === 'ready_now' || snapshot.report_readiness_summary.performance.state === 'ready_now'
        ? 'moderate'
        : 'watch',
  });
  if (growthSystemCount > 0) {
    learned.push({
      title: 'Growth maturity is now checking broader commercial systems too',
      detail: `${growthSystemCount} broader growth system${growthSystemCount === 1 ? '' : 's'} are currently connected across CRM, email/outreach, commerce, or event signal inputs. Market & Growth Intelligence should only become a serious next step when those systems are broad enough and have enough history behind them.`,
      tone: growthSystemCount >= 2 ? 'moderate' : 'watch',
    });
  }
  if (topContent) {
    learned.push({
      title: 'One campaign is clearly leading current content performance',
      detail: `${topContent.name} is setting the current pace with a score of ${topContent.evaluation_score ?? '—'}/100${topContent.topic_seed ? ` around ${topContent.topic_seed}` : ''}.`,
      tone: (topContent.evaluation_score ?? 0) >= 70 ? 'strong' : 'moderate',
    });
  }
  if (goalAffinity) {
    learned.push({
      title: 'The current mix is showing an objective bias',
      detail: goalAffinity.pattern,
      tone: goalAffinity.confidence === 'high' ? 'strong' : 'moderate',
    });
  }
  if (content_summary.total_blogs > 0) {
    learned.push({
      title: 'Content production is contributing real operating signal',
      detail: `${content_summary.total_blogs} blog or long-form content asset${content_summary.total_blogs === 1 ? '' : 's'} exist in the system, with ${content_summary.recent_blogs} added in the current window. That gives the page a better base for deciding whether to deepen or diversify the mix.`,
      tone: content_summary.recent_blogs > 0 ? 'strong' : 'moderate',
    });
  }
  if (topContentType) {
    learned.push({
      title: 'One content type is currently dominating the system mix',
      detail: secondContentType
        ? `${formatContentTypeLabel(topContentType.type)} leads the current content mix with ${topContentType.count} asset${topContentType.count === 1 ? '' : 's'}, followed by ${formatContentTypeLabel(secondContentType.type)} with ${secondContentType.count}. This is useful if intentional, but risky if the company needs a broader authority or demand mix.`
        : `${formatContentTypeLabel(topContentType.type)} is carrying nearly the entire content system right now. That gives clarity, but it also means the page should watch for over-dependence on one editorial shape.`,
      tone: content_summary.content_type_mix.length >= 3 ? 'moderate' : 'watch',
    });
  }
  if (campaign_mix_summary.total_versions > 0 && dominantCampaignPath) {
    learned.push({
      title: 'Campaign execution is clustering around one path',
      detail: secondCampaignPath
        ? `${dominantCampaignPath} is the most-used campaign path so far with ${campaignPathCounts[0]?.count ?? 0} run${(campaignPathCounts[0]?.count ?? 0) === 1 ? '' : 's'}, followed by ${formatCampaignPathLabel(secondCampaignPath.key)} with ${secondCampaignPath.count}. This is useful if deliberate, but it can hide upside in other execution paths.`
        : `${dominantCampaignPath} is carrying nearly the whole campaign system right now. That creates focus, but it also means the page should watch for over-reliance on one execution path.`,
      tone: campaignPathCounts.length >= 3 ? 'moderate' : 'watch',
    });
  }
  if (distributionSummary.connected_platforms > 0) {
    learned.push({
      title: 'Distribution quality is now visible, not just content output',
      detail: distributionSummary.active_platforms > 0
        ? topPlatform
          ? `${distributionSummary.published_posts} post${distributionSummary.published_posts === 1 ? '' : 's'} have been published across ${distributionSummary.active_platforms} active platform${distributionSummary.active_platforms === 1 ? '' : 's'} in the current window. ${formatPlatformLabel(topPlatform.platform)} currently carries ${topPlatform.share_pct}% of visible distribution${secondPlatform ? `, followed by ${formatPlatformLabel(secondPlatform.platform)} at ${secondPlatform.share_pct}%` : ''}, which helps the page separate weak traction caused by content from weak traction caused by channel concentration.`
          : `${distributionSummary.published_posts} post${distributionSummary.published_posts === 1 ? '' : 's'} have been published across ${distributionSummary.active_platforms} active platform${distributionSummary.active_platforms === 1 ? '' : 's'} in the current window. This helps the page separate weak traction caused by content from weak traction caused by thin distribution.`
        : `${distributionSummary.connected_platforms} social platform${distributionSummary.connected_platforms === 1 ? '' : 's'} are connected, but no meaningful active publishing breadth is visible yet. That means timing and distribution may still be too thin to support compounding traction.`,
      tone:
        distributionSummary.active_platforms >= 2 && distributionSummary.publish_success_rate >= 80
          ? 'moderate'
          : 'watch',
    });
  }
  learned.push({
    title: 'Operating rhythm is now part of the intelligence picture',
    detail: timing_summary.active_days > 0
      ? `The system has been visibly active on ${timing_summary.active_days} day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days, with ${timing_summary.recent_content_events} content event${timing_summary.recent_content_events === 1 ? '' : 's'} and ${timing_summary.recent_distribution_events} distribution event${timing_summary.recent_distribution_events === 1 ? '' : 's'}. ${timing_summary.avg_gap_days != null ? `The average ${timing_summary.avg_gap_days}-day gap between visible events is now shaping whether momentum can compound.` : 'This now gives the page a better read on whether the operating rhythm is actually compounding.'}`
      : `No meaningful recent rhythm is visible across content or distribution in the last ${snapshot.time_range_days} days, which means the system is still learning from isolated activity instead of a repeatable cadence.`,
    tone: timing_summary.rhythm_state === 'strong' ? 'moderate' : 'watch',
  });
  if (weakestMetric) {
    learned.push({
      title: 'Audience response shows one weak point that is holding performance back',
      detail: `${weakestMetric.label} is the softest audience signal at ${weakestMetric.avg_pct_of_target}% of benchmark, which means resonance is not yet converting cleanly into stronger momentum.`,
      tone: weakestMetric.avg_pct_of_target < 85 ? 'watch' : 'moderate',
    });
  }
  if (volatility) {
    learned.push({
      title: 'Execution quality is moving faster than strategic consistency',
      detail: volatility.pattern,
      tone: 'watch',
    });
  }
  if (engagement_summary.threads > 0 || lead_summary.active_leads > 0) {
    learned.push({
      title: 'Engagement is now feeding commercial signal, not just surface activity',
      detail: `${engagement_summary.threads} thread${engagement_summary.threads === 1 ? '' : 's'} and ${lead_summary.active_leads} active lead${lead_summary.active_leads === 1 ? '' : 's'} have been captured so far, including ${lead_summary.prospect_active_leads} prospect${lead_summary.prospect_active_leads === 1 ? '' : 's'} and ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'}. That means the system can start recommending stronger follow-up motions when the quality is high enough.`,
      tone: lead_summary.qualified_active_leads > 0 ? 'strong' : 'moderate',
    });
  }
  if (strategic_memory.dominant_topic_cluster) {
    learned.push({
      title: 'The broader ecosystem is starting to organize around one authority cluster',
      detail: `${strategic_memory.dominant_topic_cluster} is becoming the anchor for strategic memory, which is useful but also a signal to widen adjacent supporting clusters next.`,
      tone: 'moderate',
    });
  }
  if (market_pulse_summary.completed_runs > 0) {
    learned.push({
      title: 'External market signal is available for context, not just internal performance',
      detail: `${market_pulse_summary.completed_runs} Market Pulse run${market_pulse_summary.completed_runs === 1 ? '' : 's'} have been completed, with ${market_pulse_summary.latest_findings} finding${market_pulse_summary.latest_findings === 1 ? '' : 's'} in the latest cycle. That gives future recommendations more context about whether to push, hold, or redirect.`,
      tone: 'moderate',
    });
  }
  if (snapshot.intelligence_settings.target_note) {
    learned.push({
      title: 'The operating target is now explicit instead of implied',
      detail: snapshot.intelligence_settings.target_note,
      tone: 'moderate',
    });
  }

  return learned.slice(0, 6);
}

function derivePrimaryBottleneck(snapshot: Snapshot): DerivedInsight {
  const { system_snapshot: ss, strategic_intelligence, audience_response, timing_summary } = snapshot;
  const volatility = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const weakestMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];

  if (timing_summary.rhythm_state === 'thin') {
    return {
      title: 'Operating rhythm is the primary bottleneck',
      detail: `The system is not running frequently enough in the last ${snapshot.time_range_days} days to let strong ideas compound. Until content and distribution happen more consistently, traction and conversion will keep looking more random than repeatable.`,
      tone: 'watch',
    };
  }

  if (volatility) {
    return {
      title: 'Strategic consistency is the primary bottleneck',
      detail: 'Campaign execution is generating activity, but the variance across results suggests the system does not yet have a repeatable playbook. Tightening the message, topic, and campaign mix will unlock cleaner scaling.',
      tone: 'watch',
    };
  }

  if (weakestMetric && weakestMetric.avg_pct_of_target < 85) {
    return {
      title: `${weakestMetric.label} is the main limiting factor right now`,
      detail: `Topline activity is not converting strongly enough through ${weakestMetric.label.toLowerCase()}. Until that weak link improves, more content or more campaigns alone will not create the full upside available.`,
      tone: 'watch',
    };
  }

  if (ss.evaluated_campaigns < 3) {
    return {
      title: 'Evidence depth is still too thin',
      detail: 'The system needs more evaluated activity before it can make stronger future-facing recommendations. Right now, the main job is to build signal quality, not force a larger commercial move.',
      tone: 'moderate',
    };
  }

  return {
    title: 'The main bottleneck is portfolio depth',
    detail: 'The system has some positive signals, but it still depends on too few successful patterns. Broadening what is working into adjacent formats, audiences, or campaign types is the next unlock.',
    tone: 'moderate',
  };
}

function splitActionBuckets(actions: NextAction[]) {
  const grouped = { doNow: [] as NextAction[], doNext: [] as NextAction[], monitor: [] as NextAction[] };

  actions.forEach((action) => {
    const priority = computeEnhancedPriority(action).priority;
    if (priority === 'high') grouped.doNow.push(action);
    else if (priority === 'medium') grouped.doNext.push(action);
    else grouped.monitor.push(action);
  });

  return grouped;
}

function deriveSystemActionLines(snapshot: Snapshot) {
  const { reports_summary, content_summary, campaign_mix_summary, distribution_summary, timing_summary, engagement_summary, lead_summary, market_pulse_summary, system_snapshot, intelligence_settings } = snapshot;
  const actions = { doNow: [] as string[], doNext: [] as string[], monitor: [] as string[] };
  const objective = intelligence_settings.objective;
  const topContentType = content_summary.content_type_mix[0];
  const contentTypeCount = content_summary.content_type_mix.length;
  const topReportType = reports_summary.report_type_mix[0]?.type ?? null;
  const refreshCurrentReport = shouldRefreshCurrentReport(snapshot);
  const performanceReadiness = snapshot.report_readiness_summary.performance;
  const growthReadiness = snapshot.report_readiness_summary.growth;
  const growthIntegrationSummary = snapshot.report_readiness_summary.growth_integration_summary;
  const connectedGrowthSystems = [
    growthIntegrationSummary.crm_connected ? 'CRM' : null,
    growthIntegrationSummary.email_connected ? 'email' : null,
    growthIntegrationSummary.outreach_connected ? 'outreach' : null,
    growthIntegrationSummary.commerce_connected ? 'commerce' : null,
    growthIntegrationSummary.event_signal_connected ? 'event/webinar' : null,
  ].filter(Boolean) as string[];
  const dominantCampaignPath = campaign_mix_summary.dominant_path;
  const dominantCampaignPathLabel = formatCampaignPathLabel(dominantCampaignPath);
  const topPlatform = distribution_summary.platform_mix[0];
  const campaignPathCounts = [
    campaign_mix_summary.bolt_text,
    campaign_mix_summary.bolt_creator,
    campaign_mix_summary.intelligent_mix,
    campaign_mix_summary.strategy_mix,
  ].filter((count) => count > 0);

  if (reports_summary.total_reports === 0) {
    actions.doNow.push('Run the first report so the system can move from surface activity into evidence-backed guidance.');
  } else if (refreshCurrentReport && reports_summary.latest_report_type) {
    actions.doNow.push(`Redo ${formatReportTypeLabel(reports_summary.latest_report_type)} before moving to the next report level. The current diagnostic is stale enough that a fresh baseline will create better decisions.`);
  } else if (reports_summary.total_reports === 1) {
    actions.doNext.push('Run the next report tier to deepen the operating picture before scaling further.');
  }

  if (!refreshCurrentReport && reports_summary.analytics_reports === 0 && reports_summary.structured_reports > 0) {
    if (performanceReadiness.state === 'ready_now') {
      actions.doNext.push('Performance Intelligence is now justified because the core instrumentation and operating signal are both in place.');
    } else if (performanceReadiness.state === 'collecting_baseline') {
      actions.monitor.push('Performance Intelligence prerequisites are connected, but the system is still collecting enough live baseline data to make that report genuinely useful.');
    } else {
      actions.doNext.push(`Before moving to Performance Intelligence, close the readiness gaps first: ${performanceReadiness.missing_requirements.slice(0, 2).join('; ')}.`);
    }
  } else if (!refreshCurrentReport && reports_summary.structured_reports === 0 && reports_summary.analytics_reports > 0) {
    actions.doNext.push('Add a structured diagnostic report next so the system can explain what is missing, not only what is moving.');
  } else if (!refreshCurrentReport && reports_summary.total_reports >= 2) {
    actions.monitor.push('The report layer is broad enough for now, so the bigger gain likely comes from acting on the findings rather than collecting another report immediately.');
  }

  if (!refreshCurrentReport && topReportType === 'snapshot' && reports_summary.report_type_mix.length === 1) {
    if (performanceReadiness.state === 'ready_now') {
      actions.doNext.push('The current report layer is dominated by Digital Authority Snapshot, and the company is now mature enough for Performance Intelligence to create real execution guidance.');
    } else if (performanceReadiness.state === 'collecting_baseline') {
      actions.monitor.push('The company is instrumented enough for Performance Intelligence, but it still needs a little more tracked activity before that report will be worth the credits.');
    } else if (growthReadiness.state === 'ready_now') {
      actions.doNext.push('Market & Growth Intelligence is now viable, but only because the company appears growth-mature enough to support it. Use it only if downstream commercial context is the real next decision.');
    } else {
      actions.doNext.push(`Do not jump beyond Digital Authority Snapshot yet. First close the missing readiness items for the next report: ${performanceReadiness.missing_requirements.slice(0, 2).join('; ')}.`);
    }
  } else if (!refreshCurrentReport && topReportType === 'performance' && reports_summary.report_type_mix.length === 1) {
    if (growthReadiness.state === 'ready_now') {
      actions.doNext.push('The company now looks mature enough for Market & Growth Intelligence because broader growth instrumentation and commercial context are available.');
    } else if (growthReadiness.state === 'collecting_baseline') {
      actions.monitor.push('Growth instrumentation is largely in place, but the system still needs more accumulated commercial signal before Market & Growth Intelligence becomes decision-grade.');
    } else {
      actions.doNext.push(`Do not push into Market & Growth Intelligence yet. First close the readiness gaps: ${growthReadiness.missing_requirements.slice(0, 2).join('; ')}.`);
    }
  } else if (!refreshCurrentReport && topReportType === 'growth' && reports_summary.report_type_mix.length === 1) {
    actions.monitor.push('Market & Growth Intelligence is already the dominant report path, so the better move now is likely acting on that guidance rather than climbing further.');
  } else if (!refreshCurrentReport && topReportType === 'strategic' && reports_summary.report_type_mix.length === 1) {
    actions.doNext.push('The current report layer is dominated by Strategic Intelligence. Add a more concrete diagnostic or performance report next so recommendations stay grounded in operating evidence.');
  }

  if (!refreshCurrentReport && growthReadiness.state !== 'ready_now' && connectedGrowthSystems.length < 2) {
    actions.doNext.push(`Market & Growth Intelligence should wait until at least two broader commercial systems are connected. Right now the system only sees ${connectedGrowthSystems.length > 0 ? connectedGrowthSystems.join(' + ') : 'too little commercial infrastructure'} from a growth-readiness standpoint.`);
  }

  if (content_summary.recent_blogs === 0) {
    actions.doNow.push('Add fresh content in the current window so the system has more than static historical evidence to work from.');
  } else if (content_summary.total_blogs < 3) {
    actions.doNext.push('Broaden the content mix slightly so one successful piece does not carry the whole authority story.');
  }

  if (topContentType && contentTypeCount <= 1) {
    actions.doNext.push(`Right now the content system leans almost entirely on ${formatContentTypeLabel(topContentType.type)}. Add one adjacent format so the intelligence layer can compare what actually creates stronger traction.`);
  } else if (topContentType && contentTypeCount === 2) {
    actions.monitor.push(`The current mix still leans heavily on ${formatContentTypeLabel(topContentType.type)}. Keep watching whether the second format is creating enough distinct value to justify scaling it.`);
  }

  if (campaign_mix_summary.total_versions > 0 && dominantCampaignPathLabel && campaignPathCounts.length <= 1) {
    actions.doNext.push(`Campaign execution currently leans almost entirely on ${dominantCampaignPathLabel}. Add one adjacent campaign path so the system can learn whether a different execution style creates stronger traction or conversion.`);
  } else if (campaign_mix_summary.total_versions > 0 && dominantCampaignPathLabel && campaignPathCounts.length === 2) {
    actions.monitor.push(`${dominantCampaignPathLabel} is still the dominant campaign path. Keep watching whether the second path is creating a distinct enough lift to justify scaling the mix further.`);
  }

  if (distributionSummary.connected_platforms === 0) {
    actions.doNow.push('Connect publishing platforms because the system still cannot judge whether traction is weak due to content or due to thin distribution.');
  } else if (distributionSummary.active_platforms === 0) {
    actions.doNow.push('Start publishing consistently on the connected platforms so timing and distribution intelligence can begin to compound.');
  } else if (distributionSummary.active_platforms === 1 && distributionSummary.connected_platforms > 1) {
    actions.doNext.push('Distribution is still too narrow for the current setup. Use at least one more connected platform so traction does not depend on a single channel.');
  }

  if (topPlatform && topPlatform.share_pct >= 70 && distributionSummary.active_platforms > 1) {
    actions.doNext.push(`${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of visible distribution right now. Rebalance the mix slightly so growth does not depend too heavily on one platform.`);
  }

  if (topPlatform && topPlatform.success_rate > 0 && topPlatform.success_rate < 80) {
    actions.doNow.push(`${formatPlatformLabel(topPlatform.platform)} is only delivering at a ${topPlatform.success_rate}% success rate. Fix that channel before relying on it as the main distribution path.`);
  }

  if (distributionSummary.publish_success_rate > 0 && distributionSummary.publish_success_rate < 85) {
    actions.doNow.push(`Publishing reliability is only ${distributionSummary.publish_success_rate}%. Fix delivery failures before scaling content volume or campaign complexity.`);
  }

  if (timing_summary.rhythm_state === 'thin') {
    actions.doNow.push(`Operating rhythm is still too thin with only ${timing_summary.active_days} active day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days. Increase content and distribution consistency before expecting compounding traction.`);
  } else if (timing_summary.rhythm_state === 'steady' && timing_summary.avg_gap_days != null && timing_summary.avg_gap_days > 5) {
    actions.doNext.push(`The system is active, but the average ${timing_summary.avg_gap_days}-day gap between visible events is still slowing compounding momentum. Tighten the publishing rhythm a little further.`);
  }

  if (engagement_summary.connected_social_accounts === 0) {
    actions.doNow.push('Connect at least one active social account because engagement and distribution intelligence are still underpowered.');
  } else if (engagement_summary.threads === 0) {
    actions.doNext.push('Publish and ingest more live interactions so engagement intelligence can influence the next move.');
  }

  if (lead_summary.qualified_active_leads > 0) {
    actions.doNow.push(`Move the ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} into a stronger follow-up or outreach motion now.`);
  } else if (lead_summary.prospect_active_leads > 0) {
    actions.doNow.push(`Review the ${lead_summary.prospect_active_leads} prospect${lead_summary.prospect_active_leads === 1 ? '' : 's'} now and tighten the next motion around role, segment, and urgency before they cool off.`);
  } else if (lead_summary.active_leads > 0) {
    actions.doNext.push('Review active leads and decide which ones should be nurtured into stronger commercial follow-up.');
  }

  if (market_pulse_summary.completed_runs === 0) {
    actions.monitor.push('Run Market Pulse to add external context before making the next bigger commercial bet.');
  } else if (market_pulse_summary.latest_findings > 0) {
    actions.doNext.push('Use the latest Market Pulse findings to refine where timing, partnerships, or expansion signals can strengthen execution.');
  }

  if (system_snapshot.campaigns_ready_to_scale > 1) {
    actions.doNow.push('More than one campaign is ready to scale, so the next move should focus on amplification rather than just more experimentation.');
  }

  if (dominantCampaignPath === 'bolt_text') {
    actions.doNext.push('Current campaigns rely heavily on BOLT Text. Test BOLT Creator or Intelligent Mix next so the system can judge whether creative-led execution unlocks more traction or stronger conversion.');
  } else if (dominantCampaignPath === 'bolt_creator') {
    actions.doNext.push('Current campaigns rely heavily on BOLT Creator. Add a stronger text-led or mixed path next so the system can compare whether strategic text depth improves repeatability.');
  } else if (dominantCampaignPath === 'strategy_mix') {
    actions.monitor.push('Strategy Mix is carrying most of the campaign load right now. Watch whether that flexibility is creating clarity or whether a more opinionated BOLT path would tighten execution.');
  }

  if (objective === 'authority_growth') {
    if (content_summary.recent_blogs === 0) {
      actions.doNow.unshift('Publish a fresh authority asset now because authority growth stalls quickly when the content graph goes quiet.');
    }
    if (topContentType?.type === 'post' || topContentType?.type === 'story') {
      actions.doNext.push('Authority growth should not rely only on short-form. Add at least one deeper format like blog, article, guide, or whitepaper to build stronger depth.');
    }
    if (dominantCampaignPath === 'bolt_text') {
      actions.doNext.push('Authority growth may now need a richer campaign mix than BOLT Text alone. Try Intelligent Mix or a creator-supported path if strong topics already exist.');
    }
    actions.doNext.push('Extend the strongest topic cluster into adjacent supporting formats so authority depth does not remain too narrow.');
  } else if (objective === 'engagement_growth') {
    if (engagement_summary.connected_social_accounts > 0 && engagement_summary.threads === 0) {
      actions.doNow.unshift('Push more live distribution now because engagement growth needs active conversations, not only content inventory.');
    }
    if (topContentType?.type === 'blog' || topContentType?.type === 'whitepaper') {
      actions.doNext.push('Engagement growth may be too weighted toward long-form depth. Add faster-response formats like posts, stories, or threads to increase interaction velocity.');
    }
    if (dominantCampaignPath === 'bolt_text' || dominantCampaignPath === 'strategy_mix') {
      actions.doNext.push('Engagement growth may benefit from a more creative campaign path. Test BOLT Creator or Intelligent Mix to increase visual pull and shareability.');
    }
    actions.doNext.push('Review timing, shareability, and creative variation because engagement growth depends on resonance, not just output volume.');
  } else if (objective === 'lead_generation') {
    if (lead_summary.active_leads === 0) {
      actions.doNow.unshift('Tighten campaigns around clearer buyer intent so activity starts turning into identifiable active leads.');
    }
    if (topContentType?.type === 'post' || topContentType?.type === 'thread') {
      actions.doNext.push('Lead generation may need stronger conversion support than short-form alone. Add a deeper asset such as blog, article, case study, or newsletter to capture more serious demand.');
    }
    if (dominantCampaignPath === 'bolt_creator') {
      actions.doNext.push('Lead generation should not rely only on creator-led campaigns. Add a text-led or mixed campaign path so stronger offer clarity and buyer education can support qualification.');
    }
    if (lead_summary.qualified_active_leads > 0) {
      actions.doNow.unshift(`Convert the ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} now before that demand cools off.`);
    } else if (lead_summary.prospect_active_leads > 0) {
      actions.doNow.unshift(`Push the ${lead_summary.prospect_active_leads} prospect${lead_summary.prospect_active_leads === 1 ? '' : 's'} through a sharper qualification step now so the next commercial move is based on evidence, not guesswork.`);
    }
    actions.doNext.push('Use campaign and engagement signals to separate suspects, prospects, and qualified leads before scaling volume.');
  } else if (objective === 'pipeline_growth') {
    actions.doNow.push('Prioritize actions that move warm demand into a stronger pipeline motion instead of only expanding top-of-funnel activity.');
    if (lead_summary.qualified_active_leads > 0) {
      actions.doNow.push('Segment qualified demand by role, business type, or deal potential before routing the next outreach motion.');
    } else if (lead_summary.prospect_active_leads > 0) {
      actions.doNext.push('Prospect-stage demand exists, but it still needs stronger qualification before the team treats it like true pipeline.');
    }
    if (intelligence_settings.target_customer_segment) {
      actions.doNext.push(`Pressure-test pipeline actions against the target segment: ${intelligence_settings.target_customer_segment}.`);
    }
  } else if (objective === 'revenue_acceleration') {
    actions.doNow.push('Bias the next move toward commercial conversion, not only engagement uplift, because revenue acceleration depends on turning warm demand into action quickly.');
    if (intelligence_settings.sales_motion) {
      actions.doNext.push(`Align the next commercial step to the ${intelligence_settings.sales_motion} sales motion so the path from demand to revenue stays realistic.`);
    }
    if (intelligence_settings.avg_deal_size) {
      actions.doNext.push(`Use the ${intelligence_settings.avg_deal_size} average deal context when deciding whether to pursue volume, qualification, or deeper nurture.`);
    }
  }

  return actions;
}

function deriveCommercialReadiness(snapshot: Snapshot): DerivedInsight[] {
  const { system_snapshot: ss, audience_response, next_actions, strategic_intelligence, campaign_mix_summary, distribution_summary, timing_summary, lead_summary, engagement_summary, intelligence_settings } = snapshot;
  const strongestMetric = audience_response.metric_rankings[0];
  const pivotCount = next_actions.filter((action) => action.action === 'pivot').length;
  const continueCount = next_actions.filter((action) => action.action === 'continue').length;
  const insights: DerivedInsight[] = [];
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const refreshCurrentReport = shouldRefreshCurrentReport(snapshot);
  const topPlatform = distribution_summary.platform_mix[0];

  insights.push({
    title: lead_summary.qualified_active_leads > 0 || ss.campaigns_ready_to_scale > 0 ? 'The system is approaching a stronger activation point' : 'The system still needs more proof before a hard commercial push',
    detail: lead_summary.qualified_active_leads > 0
      ? `Qualified lead evidence already exists, which means the next motion can move beyond content and campaign learning into sharper conversion action for ${objectiveLabel.toLowerCase()}.`
      : lead_summary.prospect_active_leads > 0
      ? `Prospect-stage demand already exists, which means the next motion should focus on qualification and routing rather than treating all activity as equal.`
      : ss.campaigns_ready_to_scale > 0
      ? `There is enough evidence to justify a stronger next motion, especially if you extend what is already working into follow-up outreach, email, or a tighter conversion path.`
      : 'Right now the better move is to improve signal quality, not rush into a broader outreach motion too early.',
    tone: lead_summary.qualified_active_leads > 0 || ss.campaigns_ready_to_scale > 0 ? 'strong' : lead_summary.prospect_active_leads > 0 ? 'moderate' : 'moderate',
  });

  if (distributionSummary.connected_platforms > 0) {
    insights.push({
      title: 'Commercial readiness depends on distribution reliability too',
      detail: distributionSummary.active_platforms > 0
        ? `Current publishing breadth spans ${distributionSummary.active_platforms} active platform${distributionSummary.active_platforms === 1 ? '' : 's'} with a ${distributionSummary.publish_success_rate}% publish success rate${topPlatform ? `, and ${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of that visible load` : ''}. Commercial escalation should stay realistic if delivery reliability or channel balance is still weak.`
        : 'Platforms are connected, but live publishing breadth is still too thin to assume the current signal is fully representative.',
      tone:
        distributionSummary.active_platforms >= 2 && distributionSummary.publish_success_rate >= 85
          ? 'moderate'
          : 'watch',
    });
  }

  insights.push({
    title: 'Commercial timing depends on operating rhythm too',
    detail: timing_summary.active_days > 0
      ? `The system has been visibly active on ${timing_summary.active_days} day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days${timing_summary.avg_gap_days != null ? `, with an average ${timing_summary.avg_gap_days}-day gap between visible events` : ''}. That rhythm affects whether current demand can compound into stronger commercial readiness.`
      : 'There is still too little recent operating rhythm to assume that current commercial signals are representative.',
    tone: timing_summary.rhythm_state === 'strong' ? 'moderate' : 'watch',
  });

  if (strongestMetric) {
    insights.push({
      title: `${strongestMetric.label} is the strongest commercial signal in the current cycle`,
      detail: `That makes it the best candidate for deciding whether to scale distribution, add a follow-up campaign layer, or move promising engagement into more direct lead handling.`,
      tone: strongestMetric.avg_pct_of_target >= 95 ? 'strong' : 'moderate',
    });
  }

  insights.push({
    title: continueCount > pivotCount ? 'Scale and refine should come before a full reset' : 'A stronger directional correction is likely needed before scaling',
    detail: continueCount > pivotCount
      ? 'The balance of current recommendations suggests there is enough value in the existing system to improve and extend it, rather than abandoning the current path.'
      : 'Too many current signals are asking for change, which means aggressive scaling now would probably magnify the wrong pattern.',
    tone: continueCount > pivotCount ? 'moderate' : 'watch',
  });

  if (engagement_summary.opportunities > 0 || lead_summary.engagement_signals > 0) {
    insights.push({
      title: 'Engagement is mature enough to inform the next commercial step',
      detail: `${engagement_summary.opportunities} engagement opportunit${engagement_summary.opportunities === 1 ? 'y' : 'ies'} and ${lead_summary.engagement_signals} lead signal${lead_summary.engagement_signals === 1 ? '' : 's'} mean the system can start judging whether the next move should be nurture, direct outreach, or a stronger campaign layer. The stage mix currently sits at ${lead_summary.suspect_active_leads} suspect, ${lead_summary.prospect_active_leads} prospect, and ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'}.`,
      tone: engagement_summary.opportunities > 0 ? 'moderate' : 'watch',
    });
  }

  if (strategic_intelligence.best_performing_goal) {
    insights.push({
      title: 'Future commercial moves should follow the strongest goal pattern',
      detail: `${GOAL_LABELS[strategic_intelligence.best_performing_goal] ?? strategic_intelligence.best_performing_goal} is currently the best-performing objective, so future campaigns and outreach should be anchored there first.`,
      tone: 'moderate',
    });
  }

  if (intelligence_settings.sales_motion || intelligence_settings.avg_deal_size || intelligence_settings.target_customer_segment) {
    insights.push({
      title: 'Commercial recommendations should follow the actual sales motion',
      detail: [
        intelligence_settings.sales_motion ? `Sales motion: ${intelligence_settings.sales_motion}.` : null,
        intelligence_settings.avg_deal_size ? `Avg deal size: ${intelligence_settings.avg_deal_size}.` : null,
        intelligence_settings.target_customer_segment ? `Target segment: ${intelligence_settings.target_customer_segment}.` : null,
      ].filter(Boolean).join(' '),
      tone: 'moderate',
    });
  }

  if (intelligence_settings.target_customer_segment) {
    insights.push({
      title: 'The next commercial move should stay segment-specific',
      detail: `Current signals should be judged against the target segment "${intelligence_settings.target_customer_segment}" so the team does not overreact to activity from the wrong audience cluster.`,
      tone: 'moderate',
    });
  }

  if (snapshot.reports_summary.latest_report_type) {
    insights.push({
      title: refreshCurrentReport ? 'Commercial guidance needs a fresher report lens' : 'Commercial guidance should respect the latest report lens',
      detail: refreshCurrentReport && snapshot.reports_summary.latest_report_age_days != null
        ? `${formatReportTypeLabel(snapshot.reports_summary.latest_report_type)} is already ${snapshot.reports_summary.latest_report_age_days} days old, and current performance signals suggest it should be refreshed before the team overcommits to the next report level or commercial motion.`
        : `${formatReportTypeLabel(snapshot.reports_summary.latest_report_type)} is the latest structured report in the system, so the next recommendation should build on that diagnostic lens instead of pretending all report contexts are interchangeable.`,
      tone: refreshCurrentReport ? 'watch' : 'moderate',
    });
  }

  insights.push({
    title: 'Report progression should follow maturity, not just appetite',
    detail: `Current report maturity is ${snapshot.report_readiness_summary.maturity_stage.replace(/_/g, ' ')}. Performance Intelligence is ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.performance.state].toLowerCase()}, and Market & Growth Intelligence is ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.growth.state].toLowerCase()}.`,
    tone:
      snapshot.report_readiness_summary.growth.state === 'ready_now' || snapshot.report_readiness_summary.performance.state === 'ready_now'
        ? 'moderate'
        : 'watch',
  });

  const connectedGrowthSystems = [
    snapshot.report_readiness_summary.growth_integration_summary.crm_connected ? 'CRM' : null,
    snapshot.report_readiness_summary.growth_integration_summary.email_connected ? 'email' : null,
    snapshot.report_readiness_summary.growth_integration_summary.outreach_connected ? 'outreach' : null,
    snapshot.report_readiness_summary.growth_integration_summary.commerce_connected ? 'commerce' : null,
    snapshot.report_readiness_summary.growth_integration_summary.event_signal_connected ? 'event/webinar' : null,
  ].filter(Boolean) as string[];
  insights.push({
    title: 'Growth maturity should be judged against commercial-system coverage',
    detail: connectedGrowthSystems.length > 0
      ? `Current broader growth-system coverage includes ${connectedGrowthSystems.join(', ')}. That is useful, but Market & Growth Intelligence should still wait until both coverage and baseline data depth are strong enough.`
      : 'No meaningful broader commercial-system coverage is visible yet, so Market & Growth Intelligence would still be premature even if top-of-funnel signals look active.',
    tone: connectedGrowthSystems.length >= 2 ? 'moderate' : 'watch',
  });

  if (campaign_mix_summary.total_versions > 0 && campaign_mix_summary.dominant_path) {
    insights.push({
      title: 'Commercial guidance should respect the dominant campaign path',
      detail: `${formatCampaignPathLabel(campaign_mix_summary.dominant_path)} is currently the strongest execution habit in the system. The next commercial move should either exploit that strength deliberately or test one adjacent path with a clear reason, not switch blindly.`,
      tone: campaign_mix_summary.total_versions >= 2 ? 'moderate' : 'watch',
    });
  }

  return insights.slice(0, 5);
}

function OperatingOverviewSection({ snapshot }: { snapshot: Snapshot }) {
  const cards = deriveOperatingOverview(snapshot);

  return (
    <SectionCard title="Operating Overview" badge="Present state">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const tone = toneClasses(card.tone);
          return (
            <div key={card.label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{card.label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>{card.value}</span>
              </div>
              <p className={`mt-3 text-sm font-semibold ${tone.text}`}>{card.value}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{card.helper}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function TargetPotentialSection({ snapshot }: { snapshot: Snapshot }) {
  const derived = deriveTargetPotential(snapshot);

  return (
    <SectionCard title="Target vs Pace vs Potential" badge="Present + future">
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Operating target</p>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{derived.objectiveLabel}</span>
          {derived.targetLabel && (
            <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600">{derived.targetLabel}</span>
          )}
        </div>
        {derived.targetNote && (
          <p className="mt-2 text-xs leading-relaxed text-gray-600">{derived.targetNote}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Current pace</p>
          <p className="mt-3 text-lg font-bold text-gray-900">{derived.currentPace}</p>
          {derived.currentProgress && (
            <p className="mt-1 text-[11px] font-semibold text-blue-600">{derived.currentProgress}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-gray-500">{derived.currentDetail}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Potential upside</p>
          <p className="mt-3 text-lg font-bold text-emerald-700">{derived.potential}</p>
          <p className="mt-2 text-xs leading-relaxed text-emerald-800/80">{derived.potentialDetail}</p>
          {derived.upsideProjection && (
            <p className="mt-2 text-[11px] font-medium text-emerald-700/90">{derived.upsideProjection}</p>
          )}
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Risk if unchanged</p>
          <p className="mt-3 text-sm font-semibold text-amber-700">Do not leave the weak link unattended</p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800/80">{derived.risk}</p>
          {derived.delayCost && (
            <p className="mt-2 text-[11px] font-medium text-amber-700/90">{derived.delayCost}</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function LearnedSignalsSection({ snapshot }: { snapshot: Snapshot }) {
  const learned = deriveLearnedSignals(snapshot);

  if (learned.length === 0) return null;

  return (
    <SectionCard title="What We Have Learned" badge={`${learned.length} signals`}>
      <div className="space-y-3">
        {learned.map((item) => {
          const tone = toneClasses(item.tone);
          return (
            <div key={item.title} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${item.tone === 'strong' ? 'bg-emerald-400' : item.tone === 'watch' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                <p className={`text-sm font-semibold ${tone.text}`}>{item.title}</p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function PrimaryBottleneckSection({ snapshot }: { snapshot: Snapshot }) {
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const tone = toneClasses(bottleneck.tone);

  return (
    <SectionCard title="Primary Bottleneck" badge="Main constraint">
      <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-white p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-amber-100 p-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className={`text-base font-bold ${tone.text}`}>{bottleneck.title}</p>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-gray-600">{bottleneck.detail}</p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function ActionBucketsSection({ snapshot }: { snapshot: Snapshot }) {
  const actions = snapshot.next_actions;
  const buckets = splitActionBuckets(actions);
  const systemLines = deriveSystemActionLines(snapshot);
  const groups = [
    {
      key: 'do-now',
      title: 'Do now',
      items: buckets.doNow,
      systemItems: systemLines.doNow,
      tone: 'border-red-100 bg-red-50/70',
      text: 'text-red-700',
      empty: 'No urgent action is blocking progress right now.',
    },
    {
      key: 'do-next',
      title: 'Do next',
      items: buckets.doNext,
      systemItems: systemLines.doNext,
      tone: 'border-blue-100 bg-blue-50/70',
      text: 'text-blue-700',
      empty: 'No medium-priority follow-up actions are waiting.',
    },
    {
      key: 'monitor',
      title: 'Monitor',
      items: buckets.monitor,
      systemItems: systemLines.monitor,
      tone: 'border-emerald-100 bg-emerald-50/70',
      text: 'text-emerald-700',
      empty: 'No lower-priority opportunities are being tracked yet.',
    },
  ] as const;

  return (
    <SectionCard title="Action Priorities" badge={`${actions.length} recommendations`}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {groups.map((group) => (
          <div key={group.key} className={`rounded-xl border p-4 ${group.tone}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${group.text}`}>{group.title}</p>
            <div className="mt-3 space-y-2.5">
              {group.systemItems.length > 0 && (
                group.systemItems.slice(0, 2).map((line) => (
                  <div key={`${group.key}-${line}`} className="rounded-lg border border-white/70 bg-white/80 p-3">
                    <p className="text-xs font-semibold text-gray-800">{line}</p>
                  </div>
                ))
              )}
              {group.items.length > 0 ? (
                group.items.slice(0, 3).map((action) => (
                  <div key={`${group.key}-${action.campaign_id}`} className="rounded-lg border border-white/70 bg-white/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-800">{action.campaign_name}</p>
                        <p className="mt-1 text-[11px] capitalize text-gray-500">
                          {ACTION_CFG[action.action].label}
                          {action.next_topic ? ` around ${action.next_topic}` : ''}
                        </p>
                      </div>
                      {action.evaluation_score != null && (
                        <span className={`text-xs font-bold ${scoreColour(action.evaluation_score)}`}>{action.evaluation_score}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : group.systemItems.length === 0 ? (
                <p className="text-xs text-gray-500">{group.empty}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function CommercialReadinessSection({ snapshot }: { snapshot: Snapshot }) {
  const insights = deriveCommercialReadiness(snapshot);

  return (
    <SectionCard title="Commercial Readiness" badge="Activation guidance">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {insights.map((item) => {
          const tone = toneClasses(item.tone);
          return (
            <div key={item.title} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <p className={`text-sm font-semibold ${tone.text}`}>{item.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. System Snapshot
// ─────────────────────────────────────────────────────────────────────────────

function SystemSnapshotSection({ data }: { data: Snapshot['system_snapshot'] }) {
  const health = HEALTH_CFG[data.health];
  const TrendIcon =
    data.trend_signal === 'improving' ? TrendingUp :
    data.trend_signal === 'declining' ? TrendingDown : Minus;
  const trendColour =
    data.trend_signal === 'improving' ? 'text-emerald-600' :
    data.trend_signal === 'declining' ? 'text-amber-600' : 'text-gray-400';

  return (
    <SectionCard sectionKey="system_snapshot" title="System Snapshot">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`rounded-xl p-4 ${health.bg}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Health</p>
          <p className={`text-xl font-bold ${health.colour}`}>{health.label}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{data.avg_score}/100 avg</p>
        </div>
        <div className="rounded-xl p-4 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Trend</p>
          <div className={`flex items-center gap-1.5 ${trendColour}`}>
            <TrendIcon className="h-5 w-5" />
            <span className="text-xl font-bold capitalize">{data.trend_signal ?? '—'}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{data.evaluated_campaigns} evaluated</p>
        </div>
        <div className="rounded-xl p-4 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Campaigns</p>
          <p className="text-xl font-bold text-gray-800">{data.total_campaigns}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{data.campaigns_ready_to_scale} scaling-ready</p>
        </div>
        <div className="rounded-xl p-4 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Actions</p>
          <div className="space-y-1">
            {Object.entries(data.action_distribution).map(([action, count]) => count > 0 ? (
              <span key={action} className={`block text-[10px] font-semibold ${ACTION_CFG[action as keyof typeof ACTION_CFG]?.colour ?? 'text-gray-600'}`}>
                {count} {action}
              </span>
            ) : null)}
          </div>
        </div>
      </div>

      {data.evaluated_campaigns > 0 && (
        <div className="mt-4">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
            {data.status_distribution.exceeded > 0 && (
              <div className="bg-emerald-400" style={{ width: `${(data.status_distribution.exceeded / data.evaluated_campaigns) * 100}%` }} />
            )}
            {data.status_distribution.met > 0 && (
              <div className="bg-blue-400" style={{ width: `${(data.status_distribution.met / data.evaluated_campaigns) * 100}%` }} />
            )}
            {data.status_distribution.underperformed > 0 && (
              <div className="bg-amber-400" style={{ width: `${(data.status_distribution.underperformed / data.evaluated_campaigns) * 100}%` }} />
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-500">
            {data.status_distribution.exceeded > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />{data.status_distribution.exceeded} exceeded</span>}
            {data.status_distribution.met > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />{data.status_distribution.met} met</span>}
            {data.status_distribution.underperformed > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{data.status_distribution.underperformed} underperformed</span>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Campaign Status
// ─────────────────────────────────────────────────────────────────────────────

function CampaignStatusSection({ campaigns }: { campaigns: CampaignRow[] }) {
  if (campaigns.length === 0) {
    return (
      <SectionCard sectionKey="campaign_status" title="Campaign Status">
        <p className="text-sm text-gray-400">No campaigns found.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard sectionKey="campaign_status" title="Campaign Status" badge={`${campaigns.length}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] font-bold uppercase tracking-widest text-gray-400">
              <th className="pb-2 text-left font-normal">Campaign</th>
              <th className="pb-2 text-left font-normal">Goal</th>
              <th className="pb-2 text-center font-normal">Score</th>
              <th className="pb-2 text-center font-normal">Status</th>
              <th className="pb-2 text-center font-normal">Action</th>
              <th className="pb-2 text-center font-normal">Stability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {campaigns.map((c) => {
              const statusCfg = c.evaluation_status ? STATUS_CFG[c.evaluation_status] : null;
              const actionCfg = c.recommended_action ? ACTION_CFG[c.recommended_action] : null;
              const stabilCfg = c.stability_signal   ? STABILITY_CFG[c.stability_signal] : null;
              const ActionIcon = actionCfg?.icon;

              return (
                <tr key={c.id}>
                  <td className="py-2.5 pr-4">
                    <Link href={`/recommendations?campaign=${c.id}`} className="font-medium text-gray-800 hover:text-[#0A66C2] transition-colors line-clamp-1">
                      {c.name}
                    </Link>
                    {c.topic_seed && <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{c.topic_seed}</p>}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500">
                    {c.goal_type ? (GOAL_LABELS[c.goal_type] ?? c.goal_type) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {c.evaluation_score != null
                      ? <span className={`font-bold ${scoreColour(c.evaluation_score)}`}>{c.evaluation_score}</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {statusCfg
                      ? <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCfg.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`}/>{statusCfg.label}</span>
                      : <span className="text-gray-300 text-[10px]">No data</span>
                    }
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    {actionCfg && ActionIcon
                      ? <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${actionCfg.bg} ${actionCfg.colour}`}><ActionIcon className="h-3 w-3"/>{actionCfg.label}</span>
                      : <span className="text-gray-300 text-[10px]">—</span>
                    }
                  </td>
                  <td className="py-2.5 text-center">
                    {stabilCfg
                      ? <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${stabilCfg.text}`}><span className={`h-1.5 w-1.5 rounded-full ${stabilCfg.dot}`}/>{stabilCfg.label}</span>
                      : <span className="text-gray-300 text-[10px]">—</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Content Performance
// ─────────────────────────────────────────────────────────────────────────────

function ContentPerformanceSection({ data }: { data: Snapshot['content_performance'] }) {
  if (data.all.length === 0) {
    return <SectionCard sectionKey="content_performance" title="Content Performance"><p className="text-sm text-gray-400">No evaluated campaigns yet.</p></SectionCard>;
  }

  return (
    <SectionCard sectionKey="content_performance" title="Content Performance">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-3">Top performing</p>
          <div className="space-y-2">
            {data.top.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
                <span className="text-xs font-bold text-emerald-300 w-4 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <Link href={`/recommendations?campaign=${c.id}`} className="text-xs font-semibold text-gray-800 hover:text-[#0A66C2] truncate block">{c.name}</Link>
                  {c.topic_seed && <p className="text-[10px] text-gray-400 truncate">{c.topic_seed}</p>}
                </div>
                <span className={`text-sm font-bold ${scoreColour(c.evaluation_score)}`}>{c.evaluation_score}</span>
              </div>
            ))}
          </div>
        </div>
        {data.bottom.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-3">Needs attention</p>
            <div className="space-y-2">
              {data.bottom.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <Link href={`/recommendations?campaign=${c.id}`} className="text-xs font-semibold text-gray-800 hover:text-[#0A66C2] truncate block">{c.name}</Link>
                    {c.topic_seed && <p className="text-[10px] text-gray-400 truncate">{c.topic_seed}</p>}
                  </div>
                  <span className={`text-sm font-bold ${scoreColour(c.evaluation_score)}`}>{c.evaluation_score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Strategic Intelligence
// ─────────────────────────────────────────────────────────────────────────────

function StrategicIntelligenceSection({ data }: { data: Snapshot['strategic_intelligence'] }) {
  const nonMomentum    = data.patterns.filter((p) => p.type !== 'momentum' && p.type !== 'source_pattern');
  const momentum       = data.patterns.find((p) => p.type === 'momentum');
  const sourcePattern  = data.patterns.find((p) => p.type === 'source_pattern');
  const isUp           = momentum?.pattern.toLowerCase().includes('upward');
  const companyWins    = sourcePattern?.recommendation.toLowerCase().includes('proprietary');

  if (data.campaigns_analyzed === 0) {
    return <SectionCard sectionKey="strategic_intelligence" title="Strategic Intelligence"><p className="text-sm text-gray-400">Need at least 3 evaluated campaigns to surface patterns.</p></SectionCard>;
  }

  return (
    <SectionCard
      sectionKey="strategic_intelligence"
      title="Strategic Intelligence"
      badge={`${data.campaigns_analyzed} campaigns`}
      footer={
        data.dominant_topic_cluster
          ? <SectionCta href={`/recommendations?initialTopic=${encodeURIComponent(data.dominant_topic_cluster)}`} label="Explore related topics" />
          : undefined
      }
    >
      {momentum && (
        <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 ${isUp ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
          {isUp ? <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" /> : <TrendingDown className="h-4 w-4 shrink-0 text-amber-500" />}
          <div>
            <p className={`text-xs font-semibold ${isUp ? 'text-emerald-700' : 'text-amber-700'}`}>{momentum.pattern}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">→ {momentum.recommendation}</p>
          </div>
        </div>
      )}
      {/* Content Source Performance micro-section */}
      {sourcePattern && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${companyWins ? 'border-blue-100 bg-blue-50' : 'border-purple-100 bg-purple-50'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${companyWins ? 'text-blue-500' : 'text-purple-500'}`}>
              Content Source Performance
            </span>
            <span className={`ml-auto text-[10px] font-semibold ${sourcePattern.confidence === 'high' ? 'text-emerald-600' : 'text-blue-600'}`}>
              {sourcePattern.confidence} confidence · {sourcePattern.evidence_count} campaigns
            </span>
          </div>
          <p className={`text-xs font-medium leading-relaxed ${companyWins ? 'text-blue-800' : 'text-purple-800'}`}>{sourcePattern.pattern}</p>
          <p className="mt-1 text-[11px] text-gray-500">→ {sourcePattern.recommendation}</p>
        </div>
      )}

      <div className="space-y-3">
        {nonMomentum.map((p, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{PATTERN_TYPE_LABELS[p.type] ?? p.type}</span>
              <span className={`ml-auto text-[10px] font-semibold ${p.confidence === 'high' ? 'text-emerald-600' : p.confidence === 'medium' ? 'text-blue-600' : 'text-amber-600'}`}>
                {p.confidence} · {p.evidence_count} pts
              </span>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed">{p.pattern}</p>
            <p className="mt-1 text-[11px] text-gray-500">→ {p.recommendation}</p>
          </div>
        ))}
        {nonMomentum.length === 0 && !momentum && !sourcePattern && (
          <p className="text-sm text-gray-400">No patterns detected — more campaign data required.</p>
        )}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Campaign DNA
// ─────────────────────────────────────────────────────────────────────────────

function CampaignDnaSection({ data }: { data: Snapshot['campaign_dna'] }) {
  const totalGoals     = Object.values(data.goal_distribution).reduce((a, b) => a + b, 0);
  const totalStability = Object.values(data.stability_distribution).reduce((a, b) => a + b, 0);

  return (
    <SectionCard
      sectionKey="campaign_dna"
      title="Campaign DNA"
      footer={<SectionCta href="/campaigns" label="View all campaigns" />}
    >
      <div className="space-y-5">
        {totalGoals > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Goal distribution</p>
            <div className="space-y-1.5">
              {Object.entries(data.goal_distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([goal, count]) => (
                  <div key={goal} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-600 w-24 shrink-0">{GOAL_LABELS[goal] ?? goal}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0A66C2] rounded-full" style={{ width: `${(count / totalGoals) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 w-4 text-right">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        {data.topic_clusters.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Topic clusters by performance</p>
            <div className="space-y-2">
              {data.topic_clusters.map((t, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
                  <span className="text-xs font-medium text-gray-700 flex-1 capitalize">{t.cluster}</span>
                  <span className="text-[11px] text-gray-400">{t.count} campaign{t.count !== 1 ? 's' : ''}</span>
                  <span className={`text-xs font-bold ml-2 ${scoreColour(t.avg_score)}`}>{t.avg_score}/100</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {totalStability > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Decision stability</p>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(data.stability_distribution).filter(([, n]) => n > 0).map(([signal, count]) => {
                const cfg = STABILITY_CFG[signal as keyof typeof STABILITY_CFG];
                return (
                  <div key={signal} className="flex items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 px-3 py-1 text-[11px]">
                    <span className={`h-2 w-2 rounded-full ${cfg?.dot ?? 'bg-gray-400'}`} />
                    <span className="text-gray-600">{count} {cfg?.label ?? signal}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Audience Response
// ─────────────────────────────────────────────────────────────────────────────

function AudienceResponseSection({ data }: { data: Snapshot['audience_response'] }) {
  if (data.metric_rankings.length === 0) {
    return <SectionCard sectionKey="audience_response" title="Audience Response"><p className="text-sm text-gray-400">No metric data yet — record performance metrics to see audience signals.</p></SectionCard>;
  }

  const maxRatio = Math.max(...data.metric_rankings.map((m) => m.avg_ratio));

  return (
    <SectionCard
      sectionKey="audience_response"
      title="Audience Response"
      footer={<SectionCta href="/recommendations" label="Adjust campaign strategy" />}
    >
      <div className="space-y-3">
        {data.metric_rankings.map((m) => {
          const pct = m.avg_pct_of_target;
          const barColour  = pct >= 100 ? 'bg-emerald-400' : pct >= 80 ? 'bg-blue-400' : 'bg-amber-400';
          const textColour = pct >= 100 ? 'text-emerald-600' : pct >= 80 ? 'text-blue-600' : 'text-amber-600';
          return (
            <div key={m.metric}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600">{m.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{m.campaigns_tracked} campaigns</span>
                  <span className={`text-xs font-bold ${textColour}`}>{pct}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${barColour}`} style={{ width: `${Math.min(100, (m.avg_ratio / Math.max(maxRatio, 1.5)) * 100)}%` }} />
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">
                {pct >= 100 ? 'Consistently exceeding benchmark' : pct >= 80 ? 'Near benchmark' : 'Below benchmark — growth area'}
              </p>
            </div>
          );
        })}
      </div>
      {data.weakest_metric && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs text-amber-700">
          <span className="font-semibold">Growth area:</span> {data.weakest_metric} sits below benchmark across campaigns — worth targeting in the next planning cycle.
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Strategic Memory
// ─────────────────────────────────────────────────────────────────────────────

function StrategicMemorySection({ data }: { data: Snapshot['strategic_memory'] }) {
  const totalDecisions = Object.values(data.decision_summary).reduce((a, b) => a + b, 0);
  const bestGoalHref   = data.best_performing_goal
    ? `/recommendations?goal=${encodeURIComponent(data.best_performing_goal)}`
    : '/recommendations';
  const sourceMemory   = data.patterns?.find((p) => p.type === 'source_pattern');

  return (
    <SectionCard
      sectionKey="strategic_memory"
      title="Strategic Memory"
      badge={`${data.campaigns_analyzed} in memory`}
      footer={<SectionCta href={bestGoalHref} label="Apply winning strategy" />}
    >
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <p className="text-lg font-bold text-gray-800">{data.portfolio_avg_score || '—'}</p>
          <p className="text-[10px] text-gray-400">Avg score</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <p className="text-sm font-semibold text-gray-700 capitalize truncate">{data.dominant_topic_cluster ?? '—'}</p>
          <p className="text-[10px] text-gray-400">Top cluster</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <p className="text-sm font-semibold text-gray-700 capitalize">{data.best_performing_goal ? (GOAL_LABELS[data.best_performing_goal] ?? data.best_performing_goal) : '—'}</p>
          <p className="text-[10px] text-gray-400">Best goal</p>
        </div>
      </div>

      {sourceMemory && (
        <div className="mb-5 rounded-xl border border-[#0A66C2]/20 bg-blue-50 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A66C2] mb-1">Content Source Insight</p>
          <p className="text-xs text-blue-800 leading-relaxed">{sourceMemory.pattern}</p>
        </div>
      )}

      {totalDecisions > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Decision history</p>
          <div className="space-y-1.5">
            {Object.entries(data.decision_summary).filter(([, n]) => n > 0).map(([action, count]) => {
              const cfg  = ACTION_CFG[action as keyof typeof ACTION_CFG];
              const Icon = cfg?.icon ?? Activity;
              return (
                <div key={action} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${cfg?.bg ?? 'bg-gray-50 border-gray-100'}`}>
                  <Icon className={`h-3.5 w-3.5 ${cfg?.colour ?? 'text-gray-400'}`} />
                  <span className={`text-xs font-semibold ${cfg?.colour ?? 'text-gray-600'}`}>{cfg?.label ?? action}</span>
                  <span className="ml-auto text-xs text-gray-500">{count}×</span>
                  <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-current opacity-25" style={{ width: `${(count / totalDecisions) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Next Actions — Part 2 enhanced priority badges
// ─────────────────────────────────────────────────────────────────────────────

function NextActionsSection({ actions }: { actions: NextAction[] }) {
  // Re-sort by enhanced priority (overrides API ordering)
  const sorted = [...actions].sort((a, b) => {
    const ord = { high: 0, medium: 1, low: 2 };
    return ord[computeEnhancedPriority(a).priority] - ord[computeEnhancedPriority(b).priority];
  });

  const topPivot = sorted.find((a) => a.action === 'pivot' && a.next_topic);
  const topCta   = topPivot
    ? `/recommendations?initialTopic=${encodeURIComponent(topPivot.next_topic!)}`
    : '/recommendations';

  if (sorted.length === 0) {
    return (
      <SectionCard sectionKey="next_actions" title="Next Actions">
        <p className="text-sm text-gray-400">No pending actions — record campaign performance to generate recommendations.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      sectionKey="next_actions"
      title="Next Actions"
      badge={`${sorted.length}`}
      footer={<SectionCta href={topCta} label="Build campaign from top insight" />}
    >
      <div className="space-y-2.5">
        {sorted.map((a) => {
          const actionCfg  = ACTION_CFG[a.action];
          const { priority, label: priorityLabel, dot, text: priorityText } = computeEnhancedPriority(a);
          const ActionIcon = actionCfg.icon;

          return (
            <div key={a.campaign_id} className={`flex items-start gap-3 rounded-xl border p-3.5 ${actionCfg.bg}`}>
              {/* Part 2: Priority indicator */}
              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Part 2: Priority badge */}
                  <span className={`text-[10px] font-bold ${priorityText}`}>{priorityLabel}</span>
                  <span className="text-gray-300 text-[10px]">·</span>
                  <Link href={`/recommendations?campaign=${a.campaign_id}`} className={`text-xs font-semibold hover:underline ${actionCfg.colour}`}>
                    {a.campaign_name}
                  </Link>
                  <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${actionCfg.bg} ${actionCfg.colour}`}>
                    <ActionIcon className="h-3 w-3" />
                    {actionCfg.label}
                  </span>
                </div>
                {a.next_topic && (
                  <p className="mt-0.5 text-[11px] text-gray-500 truncate">→ "{a.next_topic}"</p>
                )}
              </div>

              <div className="shrink-0 flex flex-col items-end gap-1">
                {a.evaluation_score != null && (
                  <span className={`text-xs font-bold ${scoreColour(a.evaluation_score)}`}>{a.evaluation_score}/100</span>
                )}
                {a.stability_signal && STABILITY_CFG[a.stability_signal as keyof typeof STABILITY_CFG] && (
                  <span className={`text-[10px] ${STABILITY_CFG[a.stability_signal as keyof typeof STABILITY_CFG].text}`}>
                    {STABILITY_CFG[a.stability_signal as keyof typeof STABILITY_CFG].label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Configure panel
// ─────────────────────────────────────────────────────────────────────────────

function ConfigurePanel({ visible, onChange, onClose }: {
  visible: Set<SectionKey>;
  onChange: (key: SectionKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-700">Show / hide sections</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">Done</button>
      </div>
      <div className="space-y-1">
        {SECTIONS.map((s) => (
          <label key={s.key} className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={visible.has(s.key)}
              onChange={() => onChange(s.key)}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-[#0A66C2]"
            />
            <span className="text-xs text-gray-600 flex-1">{s.label}</span>
            {visible.has(s.key) ? <Eye className="h-3 w-3 text-gray-300" /> : <EyeOff className="h-3 w-3 text-gray-200" />}
          </label>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

import type { useMarketingIntel } from '../hooks/useMarketingIntel';
type S = ReturnType<typeof useMarketingIntel>;
export default function MarketingIntelView({ d }: { d: S }) {
  const {
    _ef1,
    _ef2,
    configOpen,
    error,
    fetchSnapshot,
    handleTimeRange,
    isLoading,
    isVisible,
    loading,
    router,
    selectedCompanyId,
    setConfigOpen,
    setError,
    setLoading,
    setSnapshot,
    setTimeRange,
    setVisible,
    snapshot,
    timeRange,
    toggleSection,
    userRole,
    visible,
  } = d;

    return (
    <>
      <Head>
        <title>Intelligence · Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gray-50/60">

        {/* ── Sticky header ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <Brain className="h-5 w-5 text-[#0A66C2] shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold text-gray-900 leading-tight">Intelligence</h1>
                  {snapshot?.intelligence_settings?.objective && (
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                      {getIntelligenceObjectiveLabel(snapshot)}
                    </span>
                  )}
                </div>
                {snapshot && (
                  <p className="text-[10px] text-gray-400 leading-tight">
                    {new Date(snapshot.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {loading && ' · Refreshing…'}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 relative shrink-0">

              {/* Part 3: Time range toggle */}
              <div className="flex items-center gap-0.5 rounded-full border border-gray-100 bg-gray-50 p-0.5">
                <Clock className="h-3 w-3 text-gray-400 ml-2 mr-1 shrink-0" />
                {TIME_RANGES.map((r) => (
                  <button
                    key={r.days}
                    onClick={() => handleTimeRange(r.days)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      timeRange === r.days
                        ? 'bg-white text-gray-800 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => fetchSnapshot()}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              <button
                onClick={() => setConfigOpen((p) => !p)}
                className="flex items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                Configure
              </button>

              {configOpen && (
                <ConfigurePanel
                  visible={visible}
                  onChange={toggleSection}
                  onClose={() => setConfigOpen(false)}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── Content ───────────────────────────────────────────────────── */}
        {snapshot ? (
          <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

            {/* Part 1: Executive summary — always at top, no toggle */}
            <ObjectiveSetupNotice snapshot={snapshot} />

            <ExecutiveSummary snapshot={snapshot} />

            <OperatingOverviewSection snapshot={snapshot} />

            <TargetPotentialSection snapshot={snapshot} />

            <PrimaryBottleneckSection snapshot={snapshot} />

            <LearnedSignalsSection snapshot={snapshot} />

            <ActionBucketsSection snapshot={snapshot} />

            <CommercialReadinessSection snapshot={snapshot} />

            {/* System Snapshot */}
            {isVisible('system_snapshot') && (
              <SystemSnapshotSection data={snapshot.system_snapshot} />
            )}

            {/* Next Actions */}
            {isVisible('next_actions') && (
              <NextActionsSection actions={snapshot.next_actions} />
            )}

            {/* Strategic Intelligence + Campaign DNA */}
            {(isVisible('strategic_intelligence') || isVisible('campaign_dna')) && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {isVisible('strategic_intelligence') && (
                  <StrategicIntelligenceSection data={snapshot.strategic_intelligence} />
                )}
                {isVisible('campaign_dna') && (
                  <CampaignDnaSection data={snapshot.campaign_dna} />
                )}
              </div>
            )}

            {/* Audience Response + Strategic Memory */}
            {(isVisible('audience_response') || isVisible('strategic_memory')) && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {isVisible('audience_response') && (
                  <AudienceResponseSection data={snapshot.audience_response} />
                )}
                {isVisible('strategic_memory') && (
                  <StrategicMemorySection data={snapshot.strategic_memory} />
                )}
              </div>
            )}

            {/* Content Performance */}
            {isVisible('content_performance') && (
              <ContentPerformanceSection data={snapshot.content_performance} />
            )}

            {/* Campaign Status */}
            {isVisible('campaign_status') && (
              <CampaignStatusSection campaigns={snapshot.campaign_status} />
            )}

          </div>
        ) : (
          <div className="flex items-center justify-center py-32 text-gray-400 text-sm">
            No data available for this time range.
          </div>
        )}
      </div>
    </>
  );
}
