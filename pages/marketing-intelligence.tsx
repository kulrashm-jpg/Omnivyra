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

const PATTERN_TYPE_LABELS: Record<string, string> = {
  topic_strength: 'Topic Strength', goal_affinity: 'Goal Affinity',
  volatility: 'Volatility', momentum: 'Momentum', source_pattern: 'Content Source',
};

function scoreColour(s: number | null) {
  if (s == null) return 'text-gray-300';
  return s >= 70 ? 'text-emerald-600' : s >= 50 ? 'text-blue-600' : 'text-amber-600';
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
  const text = generateExecutiveSummary(snapshot);
  if (!text) return null;

  const ss = snapshot.system_snapshot;
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
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Executive Summary</p>
          <p className="text-sm text-gray-700 leading-relaxed max-w-4xl">{text}</p>
          <p className="mt-2 text-[10px] text-gray-400">
            Based on {ss.evaluated_campaigns} evaluated campaign{ss.evaluated_campaigns !== 1 ? 's' : ''} · last {snapshot.time_range_days} days
          </p>
        </div>
      </div>
    </div>
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

export default function MarketingIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId, userRole, isLoading: isContextLoading } = useCompanyContext();

  const [snapshot, setSnapshot]     = useState<Snapshot | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [visible, setVisible]       = useState<Set<SectionKey>>(new Set(ALL_SECTION_KEYS));

  // Part 3: time range
  const [timeRange, setTimeRange]   = useState<TimeRange>(30);

  // Hydrate preferences
  useEffect(() => {
    setVisible(loadVisibility());
    setTimeRange(loadTimeRange());
  }, []);

  // Auth guard
  useEffect(() => {
    if (isContextLoading) return;
    const allowed = ['SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN'];
    if (userRole && !allowed.some((r) => userRole.toUpperCase().includes(r))) {
      router.replace('/dashboard');
    }
  }, [userRole, isContextLoading, router]);

  // Fetch snapshot
  const fetchSnapshot = useCallback(async (days: TimeRange = timeRange) => {
    const cid = selectedCompanyId;
    if (!cid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/intelligence/snapshot?companyId=${encodeURIComponent(cid)}&days=${days}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      setSnapshot(await res.json());
    } catch {
      setError('Could not load intelligence data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, timeRange]);

  useEffect(() => { fetchSnapshot(); }, [fetchSnapshot]);

  // Part 3: time range change
  function handleTimeRange(d: TimeRange) {
    setTimeRange(d);
    localStorage.setItem(TIME_RANGE_KEY, String(d));
    fetchSnapshot(d);
  }

  // Toggle section
  function toggleSection(key: SectionKey) {
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      saveVisibility(next);
      return next;
    });
  }

  const isVisible = (k: SectionKey) => visible.has(k);

  // ── Loading / Error ────────────────────────────────────────────────────────

  if (isContextLoading || (loading && !snapshot)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Loading intelligence…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 p-8 text-center max-w-sm">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-red-700 mb-1">{error}</p>
          <button onClick={() => fetchSnapshot()} className="mt-3 rounded-full border border-red-200 px-4 py-2 text-xs text-red-600 hover:bg-red-100 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Marketing Intelligence · Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gray-50/60">

        {/* ── Sticky header ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <Brain className="h-5 w-5 text-[#0A66C2] shrink-0" />
              <div className="min-w-0">
                <h1 className="text-sm font-bold text-gray-900 leading-tight">Marketing Intelligence</h1>
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
            <ExecutiveSummary snapshot={snapshot} />

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
