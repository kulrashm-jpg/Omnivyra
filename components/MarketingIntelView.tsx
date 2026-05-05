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
import {
  scoreColour,
  toSentenceCase,
  parseTargetNumber,
  formatContentTypeLabel,
  formatPlatformLabel,
  getContentRoute,
  formatCampaignPathLabel,
  formatReportTypeLabel,
  getCampaignPathRoute,
} from '@/features/marketing-intel/hooks/viewModel.helpers';
import { useMarketingIntelViewModel } from '@/features/marketing-intel/hooks/useMarketingIntelViewModel';
import {
  SECTIONS,
  SectionCard,
  SectionCta,
  type SectionKey,
} from '@/features/marketing-intel/components/SectionCard';
import CampaignStatusSection from '@/features/marketing-intel/components/CampaignStatusSection';
import ContentPerformanceSection from '@/features/marketing-intel/components/ContentPerformanceSection';
import ExecutiveSummary from '@/features/marketing-intel/components/ExecutiveSummary';
import TargetPotentialSection from '@/features/marketing-intel/components/TargetPotentialSection';
import OperatingOverviewSection from '@/features/marketing-intel/components/OperatingOverviewSection';
import StrategicMemorySection from '@/features/marketing-intel/components/StrategicMemorySection';
import SystemSnapshotSection from '@/features/marketing-intel/components/SystemSnapshotSection';
import CampaignDnaSection from '@/features/marketing-intel/components/CampaignDnaSection';
import AudienceResponseSection from '@/features/marketing-intel/components/AudienceResponseSection';
import NextActionsSection from '@/features/marketing-intel/components/NextActionsSection';
import type {
  PatternSignal,
  CampaignRow,
  NextAction,
  Snapshot,
  DerivedInsight,
  RoutedSystemAction,
} from '@/features/marketing-intel/types';
import {
  STATUS_CFG,
  ACTION_CFG,
  STABILITY_CFG,
  GOAL_LABELS,
  INTELLIGENCE_OBJECTIVE_LABELS,
  TARGET_METRIC_LABELS,
  TIME_HORIZON_LABELS,
  HEALTH_CFG,
  KNOWLEDGE_GRAPH_LABELS,
} from '@/features/marketing-intel/constants';
import {
  getIntelligenceObjectiveLabel,
  getTargetMetricLabel,
  toneClasses,
  deriveTargetTracking,
  deriveTargetPotential,
  derivePrimaryBottleneck,
  computeEnhancedPriority,
  shouldRefreshCurrentReport,
  deriveOperatingOverview,
} from '@/features/marketing-intel/derives';
import { deriveSystemActionLines } from '@/features/marketing-intel/actionLines';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Executive summary generation (pure, in-memory)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — Enhanced priority classification (stability + confidence + impact)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Visual helpers
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_READINESS_LABELS: Record<string, string> = {
  not_ready: 'Not ready',
  partially_ready: 'Partially ready',
  collecting_baseline: 'Collecting baseline data',
  ready_soon: 'Ready soon',
  ready_now: 'Ready now',
};

const PATTERN_TYPE_LABELS: Record<string, string> = {
  topic_strength: 'Topic Strength', goal_affinity: 'Goal Affinity',
  volatility: 'Volatility', momentum: 'Momentum', source_pattern: 'Content Source',
};

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard — Part 4 microcopy via `description` prop
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Executive Summary component
// ─────────────────────────────────────────────────────────────────────────────

function ObjectiveSetupNotice({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.intelligence_settings.objective && snapshot.intelligence_settings.target_metric && snapshot.intelligence_settings.target_value) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Target not set</p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-amber-900/75">
            No target is set yet, so pacing cannot be evaluated properly.
            Add the primary objective, target metric, target value, and time horizon so this page can judge whether the system is behind, on track, or capable of surpassing the goal.
          </p>
        </div>
        <Link
          href="/company-profile"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"
        >
          Set target
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

type ActionStatus = 'not_started' | 'in_progress' | 'completed';
type ConstraintConfidence = 'Low' | 'Medium' | 'High';
type ConfidenceDirection = 'up' | 'flat' | 'down';
type ActionProgressEntry = {
  status: ActionStatus;
  updatedAt: string;
  completedAt?: string;
};
type OutcomeSignalSnapshot = {
  publishingCount: number;
  activeChannels: number;
  publishedPosts: number;
  engagementSignals: number;
  activeLeads: number;
  qualifiedLeads: number;
};
type ActionOutcomeBaseline = {
  capturedAt: string;
  signals: OutcomeSignalSnapshot;
};

const MARKETING_INTEL_PROGRESS_STORAGE_KEY = 'marketing-intel-progress';
const MARKETING_INTEL_CONFIDENCE_STORAGE_KEY = 'marketing-intel-constraint-confidence';
const MARKETING_INTEL_OUTCOME_STORAGE_KEY = 'marketing-intel-outcomes';
const STALE_ACTION_MS = 48 * 60 * 60 * 1000;
const EARLY_OUTCOME_WINDOW_MS = 48 * 60 * 60 * 1000;

function normalizeActionProgress(raw: unknown): Record<string, ActionProgressEntry> {
  if (!raw || typeof raw !== 'object') return {};

  const now = new Date().toISOString();
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, ActionProgressEntry>>((acc, [key, value]) => {
    if (typeof value === 'string' && ['not_started', 'in_progress', 'completed'].includes(value)) {
      acc[key] = { status: value as ActionStatus, updatedAt: now };
      return acc;
    }

    if (
      value &&
      typeof value === 'object' &&
      'status' in value &&
      typeof (value as { status?: unknown }).status === 'string' &&
      ['not_started', 'in_progress', 'completed'].includes((value as { status: string }).status)
    ) {
      const candidate = value as Partial<ActionProgressEntry>;
      acc[key] = {
        status: candidate.status as ActionStatus,
        updatedAt: candidate.updatedAt ?? now,
        completedAt: candidate.completedAt,
      };
    }

    return acc;
  }, {});
}

function buildActionProgressEntry(status: ActionStatus, previous?: ActionProgressEntry): ActionProgressEntry {
  const now = new Date().toISOString();
  if (status === 'completed') {
    return {
      status,
      updatedAt: now,
      completedAt: now,
    };
  }

  return {
    status,
    updatedAt: now,
    completedAt: previous?.completedAt,
  };
}

function deriveOutcomeSignals(snapshot: Snapshot): OutcomeSignalSnapshot {
  return {
    publishingCount: snapshot.content_summary.recent_blogs,
    activeChannels: snapshot.distribution_summary.active_platforms,
    publishedPosts: snapshot.distribution_summary.published_posts,
    engagementSignals: snapshot.lead_summary.engagement_signals,
    activeLeads: snapshot.lead_summary.active_leads,
    qualifiedLeads: snapshot.lead_summary.qualified_active_leads,
  };
}

function normalizeOutcomeBaselines(raw: unknown): Record<string, ActionOutcomeBaseline> {
  if (!raw || typeof raw !== 'object') return {};

  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, ActionOutcomeBaseline>>((acc, [key, value]) => {
    if (
      value &&
      typeof value === 'object' &&
      'capturedAt' in value &&
      'signals' in value &&
      typeof (value as { capturedAt?: unknown }).capturedAt === 'string'
    ) {
      const candidate = value as Partial<ActionOutcomeBaseline> & { signals?: Partial<OutcomeSignalSnapshot> };
      acc[key] = {
        capturedAt: candidate.capturedAt as string,
        signals: {
          publishingCount: candidate.signals?.publishingCount ?? 0,
          activeChannels: candidate.signals?.activeChannels ?? 0,
          publishedPosts: candidate.signals?.publishedPosts ?? 0,
          engagementSignals: candidate.signals?.engagementSignals ?? 0,
          activeLeads: candidate.signals?.activeLeads ?? 0,
          qualifiedLeads: candidate.signals?.qualifiedLeads ?? 0,
        },
      };
    }
    return acc;
  }, {});
}

function countImprovingOutcomes(snapshot: Snapshot, baselines: Record<string, ActionOutcomeBaseline>): number {
  return deriveCurrentDoNowItems(snapshot).reduce((count, item) => {
    const baseline = baselines[item.id];
    if (!baseline) return count;

    const current = deriveOutcomeSignals(snapshot);
    const previous = baseline.signals;
    const improved =
      current.publishingCount > previous.publishingCount ||
      current.activeChannels > previous.activeChannels ||
      current.engagementSignals > previous.engagementSignals ||
      current.activeLeads > previous.activeLeads ||
      current.qualifiedLeads > previous.qualifiedLeads;

    return improved ? count + 1 : count;
  }, 0);
}

function getActionCompletionFeedback(item: { id: string; label: string }): string {
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  if (normalized.includes('publish') || normalized.includes('content') || normalized.includes('cadence') || normalized.includes('rhythm')) {
    return 'Good — this will improve signal consistency over the next cycle.';
  }
  if (normalized.includes('distribution') || normalized.includes('channel') || normalized.includes('platform')) {
    return 'Good — this will improve signal reliability across channels.';
  }
  if (normalized.includes('stage') || normalized.includes('journey')) {
    return 'Good — this will strengthen progression through the buyer journey.';
  }
  if (normalized.includes('lead') || normalized.includes('prospect') || normalized.includes('qualified')) {
    return 'Good — this will sharpen the path from demand into commercial action.';
  }
  return 'Good — this will make the next decision cycle more reliable.';
}

function getRecommendedActionReason(item: { id: string; label: string }): string {
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  if (normalized.includes('publish') || normalized.includes('content') || normalized.includes('cadence') || normalized.includes('rhythm')) {
    return 'This will improve signal consistency and unlock clearer performance patterns.';
  }
  if (normalized.includes('distribution') || normalized.includes('channel') || normalized.includes('platform')) {
    return 'This will reduce channel bias and make traction signals more reliable.';
  }
  if (normalized.includes('stage') || normalized.includes('journey')) {
    return 'This will strengthen buyer progression and make weak journey gaps measurable.';
  }
  if (normalized.includes('lead') || normalized.includes('prospect') || normalized.includes('qualified')) {
    return 'This will turn warm demand into clearer commercial signal faster.';
  }
  return 'This will make the next decision cycle clearer and easier to trust.';
}

function deriveOutcomeMessages(
  item: { id: string; label: string },
  baseline: ActionOutcomeBaseline | undefined,
  snapshot: Snapshot
): string[] {
  if (!baseline) return ['\u2192 No measurable impact yet'];

  const current = deriveOutcomeSignals(snapshot);
  const previous = baseline.signals;
  const normalized = `${item.id} ${item.label}`.toLowerCase();
  const lines: string[] = [];
  const ageMs = Date.now() - new Date(baseline.capturedAt).getTime();
  const pushIfMeaningful = (line: string | null) => {
    if (line && lines.length < 3) lines.push(line);
  };

  if (normalized.includes('publish') || normalized.includes('content') || normalized.includes('cadence') || normalized.includes('rhythm')) {
    const publishingDelta = current.publishingCount - previous.publishingCount;
    const engagementDelta = current.engagementSignals - previous.engagementSignals;
    pushIfMeaningful(
      publishingDelta > 0
        ? `\u2191 Publishing increased (+${publishingDelta} piece${publishingDelta === 1 ? '' : 's'})`
        : publishingDelta < 0
          ? `\u2193 Publishing slowed (${Math.abs(publishingDelta)} fewer piece${Math.abs(publishingDelta) === 1 ? '' : 's'})`
          : null
    );
    pushIfMeaningful(
      engagementDelta > 0
        ? `\u2191 Engagement signals improving (+${engagementDelta})`
        : engagementDelta < 0
          ? `\u2193 Engagement signals softer (${Math.abs(engagementDelta)} lower)`
          : null
    );
  }

  if (normalized.includes('distribution') || normalized.includes('channel') || normalized.includes('platform')) {
    const channelDelta = current.activeChannels - previous.activeChannels;
    const postsDelta = current.publishedPosts - previous.publishedPosts;
    pushIfMeaningful(
      channelDelta > 0
        ? `\u2191 Distribution broader (+${channelDelta} active channel${channelDelta === 1 ? '' : 's'})`
        : channelDelta < 0
          ? `\u2193 Distribution narrowed (${Math.abs(channelDelta)} fewer active channel${Math.abs(channelDelta) === 1 ? '' : 's'})`
          : '\u2192 Distribution unchanged'
    );
    pushIfMeaningful(
      postsDelta > 0
        ? `\u2191 More delivery signal visible (+${postsDelta} published post${postsDelta === 1 ? '' : 's'})`
        : postsDelta < 0
          ? `\u2193 Published output slipped (${Math.abs(postsDelta)} fewer post${Math.abs(postsDelta) === 1 ? '' : 's'})`
          : null
    );
  }

  if (normalized.includes('lead') || normalized.includes('prospect') || normalized.includes('qualified')) {
    const qualifiedDelta = current.qualifiedLeads - previous.qualifiedLeads;
    const leadDelta = current.activeLeads - previous.activeLeads;
    pushIfMeaningful(
      qualifiedDelta > 0
        ? `\u2191 Qualified demand increased (+${qualifiedDelta})`
        : qualifiedDelta < 0
          ? `\u2193 Qualified demand slipped (${Math.abs(qualifiedDelta)} lower)`
          : null
    );
    pushIfMeaningful(
      leadDelta > 0
        ? `\u2191 Active leads increased (+${leadDelta})`
        : leadDelta < 0
          ? `\u2193 Active leads decreased (${Math.abs(leadDelta)} lower)`
          : null
    );
  }

  if (lines.length === 0) {
    const engagementDelta = current.engagementSignals - previous.engagementSignals;
    const publishingDelta = current.publishingCount - previous.publishingCount;
    if (engagementDelta > 0) {
      lines.push(`\u2191 Engagement signals improving (+${engagementDelta})`);
    } else if (publishingDelta > 0) {
      lines.push(`\u2191 Publishing increased (+${publishingDelta} piece${publishingDelta === 1 ? '' : 's'})`);
    }
  }

  if (lines.length > 0) return lines.slice(0, 3);
  return [ageMs < EARLY_OUTCOME_WINDOW_MS ? '\u2192 Too early to measure impact — check back next cycle' : '\u2192 No measurable impact yet'];
}

function deriveCurrentDoNowItems(snapshot: Snapshot) {
  return deriveSystemActionLines(snapshot).doNow.slice(0, 2).map((item) => ({
    id: item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: item.text,
    href: item.href,
    ctaLabel: item.label,
  }));
}

function classifyInsightBucket(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('report')) return 'report';
  if (normalized.includes('knowledge graph') || normalized.includes('authority-graph') || normalized.includes('authority cluster')) return 'knowledge_graph';
  if (normalized.includes('distribution')) return 'distribution';
  if (normalized.includes('rhythm') || normalized.includes('timing')) return 'timing';
  if (normalized.includes('commercial') || normalized.includes('lead') || normalized.includes('pipeline')) return 'commercial';
  if (normalized.includes('campaign')) return 'campaign';
  if (normalized.includes('content')) return 'content';
  if (normalized.includes('engagement')) return 'engagement';
  if (normalized.includes('audience')) return 'audience';
  if (normalized.includes('growth maturity') || normalized.includes('commercial-system')) return 'growth_maturity';
  return normalized;
}

function insightWeight(insight: DerivedInsight): number {
  const toneWeight = insight.tone === 'strong' ? 3 : insight.tone === 'watch' ? 2 : 1;
  const bucket = classifyInsightBucket(insight.title);
  const bucketWeight =
    bucket === 'report' ? 5 :
    bucket === 'knowledge_graph' ? 4 :
    bucket === 'commercial' ? 4 :
    bucket === 'distribution' ? 3 :
    bucket === 'timing' ? 3 :
    bucket === 'content' ? 3 :
    bucket === 'campaign' ? 3 :
    bucket === 'engagement' ? 2 :
    bucket === 'audience' ? 2 :
    bucket === 'growth_maturity' ? 2 : 1;
  return bucketWeight * 10 + toneWeight;
}

function selectTopInsights(insights: DerivedInsight[], limit: number): DerivedInsight[] {
  const chosen: DerivedInsight[] = [];
  const usedBuckets = new Set<string>();

  const sorted = [...insights].sort((left, right) => insightWeight(right) - insightWeight(left));
  for (const insight of sorted) {
    const bucket = classifyInsightBucket(insight.title);
    if (!usedBuckets.has(bucket)) {
      chosen.push(insight);
      usedBuckets.add(bucket);
    }
    if (chosen.length >= limit) return chosen;
  }

  for (const insight of sorted) {
    if (!chosen.includes(insight)) {
      chosen.push(insight);
    }
    if (chosen.length >= limit) return chosen;
  }

  return chosen;
}

function deriveLearnedSignals(snapshot: Snapshot): DerivedInsight[] {
  const {
    strategic_intelligence,
    content_performance,
    audience_response,
    strategic_memory,
    knowledge_graph_summary,
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
  if (distribution_summary.connected_platforms > 0) {
    learned.push({
      title: 'Distribution quality is now visible, not just content output',
      detail: distribution_summary.active_platforms > 0
        ? topPlatform
          ? `${distribution_summary.published_posts} post${distribution_summary.published_posts === 1 ? '' : 's'} have been published across ${distribution_summary.active_platforms} active platform${distribution_summary.active_platforms === 1 ? '' : 's'} in the current window. ${formatPlatformLabel(topPlatform.platform)} currently carries ${topPlatform.share_pct}% of visible distribution${secondPlatform ? `, followed by ${formatPlatformLabel(secondPlatform.platform)} at ${secondPlatform.share_pct}%` : ''}, which helps the page separate weak traction caused by content from weak traction caused by channel concentration.`
          : `${distribution_summary.published_posts} post${distribution_summary.published_posts === 1 ? '' : 's'} have been published across ${distribution_summary.active_platforms} active platform${distribution_summary.active_platforms === 1 ? '' : 's'} in the current window. This helps the page separate weak traction caused by content from weak traction caused by thin distribution.`
        : `${distribution_summary.connected_platforms} social platform${distribution_summary.connected_platforms === 1 ? '' : 's'} are connected, but no meaningful active publishing breadth is visible yet. That means timing and distribution may still be too thin to support compounding traction.`,
      tone:
        distribution_summary.active_platforms >= 2 && distribution_summary.publish_success_rate >= 80
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
      title: 'The broader ecosystem is starting to show authority-graph shape',
      detail: `${strategic_memory.dominant_topic_cluster} is becoming the anchor for strategic memory. The current graph is ${KNOWLEDGE_GRAPH_LABELS[knowledge_graph_summary.status].toLowerCase()}, with ${knowledge_graph_summary.topic_cluster_count} topic cluster${knowledge_graph_summary.topic_cluster_count === 1 ? '' : 's'} and ${knowledge_graph_summary.format_diversity} active format${knowledge_graph_summary.format_diversity === 1 ? '' : 's'} contributing to that shape.`,
      tone: knowledge_graph_summary.status === 'maturing' ? 'strong' : 'moderate',
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

  return selectTopInsights(learned, 6);
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

  if (distribution_summary.connected_platforms > 0) {
    insights.push({
      title: 'Commercial readiness depends on distribution reliability too',
      detail: distribution_summary.active_platforms > 0
        ? `Current publishing breadth spans ${distribution_summary.active_platforms} active platform${distribution_summary.active_platforms === 1 ? '' : 's'} with a ${distribution_summary.publish_success_rate}% publish success rate${topPlatform ? `, and ${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of that visible load` : ''}. Commercial escalation should stay realistic if delivery reliability or channel balance is still weak.`
        : 'Platforms are connected, but live publishing breadth is still too thin to assume the current signal is fully representative.',
      tone:
        distribution_summary.active_platforms >= 2 && distribution_summary.publish_success_rate >= 85
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

  return selectTopInsights(insights, 5);
}

function deriveLearnedSignalsCta(snapshot: Snapshot): { href: string; label: string } {
  if (shouldRefreshCurrentReport(snapshot) && snapshot.reports_summary.latest_report_type) {
    return {
      href:
        snapshot.reports_summary.latest_report_type === 'performance'
          ? '/reports/performance-intelligence'
          : snapshot.reports_summary.latest_report_type === 'growth'
            ? '/reports/market-growth-intelligence'
            : '/reports/digital-authority-snapshot',
      label: 'Refresh report lens',
    };
  }

  if (snapshot.report_readiness_summary.performance.state === 'ready_now' && snapshot.reports_summary.report_type_mix[0]?.type === 'snapshot') {
    return { href: '/reports/performance-intelligence', label: 'Open next report' };
  }

  if (snapshot.report_readiness_summary.growth.state === 'ready_now' && snapshot.reports_summary.report_type_mix[0]?.type === 'performance') {
    return { href: '/reports/market-growth-intelligence', label: 'Open growth report' };
  }

  if (snapshot.knowledge_graph_summary.status === 'imbalanced' && snapshot.knowledge_graph_summary.weakest_stage) {
    return {
      href:
        snapshot.knowledge_graph_summary.weakest_stage === 'awareness'
          ? '/posts/create'
          : snapshot.knowledge_graph_summary.weakest_stage === 'decision'
            ? '/case-studies/create'
            : '/admin/content',
      label: 'Strengthen weak stage',
    };
  }

  if (snapshot.distribution_summary.active_platforms <= 1) {
    return { href: '/engagement', label: 'Improve distribution' };
  }

  return { href: '/command-center/content', label: 'Act on content insights' };
}

function deriveEcosystemProgressCta(snapshot: Snapshot): { href: string; label: string } {
  if (snapshot.knowledge_graph_summary.status === 'shallow') {
    return { href: '/command-center/content', label: 'Expand knowledge graph' };
  }
  if (snapshot.knowledge_graph_summary.status === 'imbalanced' && snapshot.knowledge_graph_summary.weakest_stage) {
    return {
      href:
        snapshot.knowledge_graph_summary.weakest_stage === 'awareness'
          ? '/posts/create'
          : snapshot.knowledge_graph_summary.weakest_stage === 'decision'
            ? '/case-studies/create'
            : '/admin/content',
      label: 'Fix graph imbalance',
    };
  }
  if (snapshot.timing_summary.rhythm_state === 'thin') {
    return { href: '/admin/content', label: 'Tighten operating rhythm' };
  }
  if (snapshot.distribution_summary.active_platforms <= 1 || snapshot.distribution_summary.publish_success_rate < 85) {
    return { href: '/engagement', label: 'Strengthen distribution' };
  }
  return { href: '/intelligence', label: 'Monitor ecosystem health' };
}

function deriveCommercialReadinessCta(snapshot: Snapshot): { href: string; label: string } {
  if (snapshot.lead_summary.qualified_active_leads > 0) {
    return { href: '/dashboard/intelligence?intelTab=active-leads', label: 'Review qualified demand' };
  }
  if (snapshot.report_readiness_summary.growth.state === 'ready_now') {
    return { href: '/reports/market-growth-intelligence', label: 'Open growth intelligence' };
  }
  if (snapshot.distribution_summary.active_platforms <= 1 || snapshot.distribution_summary.publish_success_rate < 85) {
    return { href: '/engagement', label: 'Strengthen commercial distribution' };
  }
  if (snapshot.timing_summary.rhythm_state === 'thin') {
    return { href: '/command-center/campaigns', label: 'Increase operating cadence' };
  }
  if (snapshot.lead_summary.prospect_active_leads > 0 || snapshot.lead_summary.suspect_active_leads > 0) {
    return { href: '/dashboard/intelligence?intelTab=active-leads', label: 'Review lead progression' };
  }
  return { href: '/command-center/campaigns', label: 'Tighten commercial motion' };
}

function deriveDiagnosis(snapshot: Snapshot): Array<{
  label: string;
  explanation: string;
  tone: DerivedInsight['tone'];
}> {
  const { timing_summary, distribution_summary, knowledge_graph_summary, content_summary, reports_summary, report_readiness_summary, lead_summary, engagement_summary } = snapshot;
  const topContentType = content_summary.content_type_mix[0];
  const topPlatform = distribution_summary.platform_mix[0];
  const evidenceInputs = [
    reports_summary.total_reports > 0 ? `${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'}` : null,
    content_summary.total_blogs > 0 ? `${content_summary.total_blogs} content asset${content_summary.total_blogs === 1 ? '' : 's'}` : null,
    engagement_summary.threads > 0 ? `${engagement_summary.threads} thread${engagement_summary.threads === 1 ? '' : 's'}` : null,
    lead_summary.active_leads > 0 ? `${lead_summary.active_leads} active lead${lead_summary.active_leads === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];

  return [
    {
      label: 'Rhythm',
      explanation:
        timing_summary.rhythm_state === 'thin'
          ? 'Publishing too infrequent -> no compounding signal.'
        : timing_summary.rhythm_state === 'steady'
            ? 'Publishing is happening, but not steadily enough to compound.'
            : 'Publishing cadence is steady enough to support compounding.',
      tone: timing_summary.rhythm_state === 'strong' ? 'strong' : timing_summary.rhythm_state === 'steady' ? 'moderate' : 'watch',
    },
    {
      label: 'Distribution',
      explanation:
        distribution_summary.connected_platforms === 0
          ? 'Distribution not connected tightly enough -> weak traction may still be an access problem.'
          : distribution_summary.active_platforms === 0
            ? 'Distribution not active enough -> current performance cannot be trusted.'
            : distribution_summary.active_platforms === 1 && distribution_summary.connected_platforms > 1
              ? 'Distribution too narrow -> performance is biased, not reliable.'
              : topPlatform && topPlatform.share_pct >= 70
                ? `${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of visible distribution -> reach is still too dependent on one channel.`
                : 'Distribution broad enough -> channel comparisons are now more reliable.',
      tone:
        distribution_summary.connected_platforms === 0 || distribution_summary.active_platforms === 0
          ? 'watch'
          : distribution_summary.active_platforms >= 2 && distribution_summary.publish_success_rate >= 85
            ? 'strong'
            : 'moderate',
    },
    {
      label: 'Content depth',
      explanation:
        knowledge_graph_summary.status === 'shallow'
          ? 'Content too shallow -> cannot move users across the journey.'
        : knowledge_graph_summary.status === 'imbalanced' && knowledge_graph_summary.weakest_stage
            ? `Content depth uneven -> ${knowledge_graph_summary.weakest_stage} stage is too weak.`
            : topContentType
              ? `${formatContentTypeLabel(topContentType.type)} dominates the mix -> the journey still lacks enough adjacent depth.`
              : 'Content depth is still emerging -> not enough range to trust the authority pattern fully.',
      tone:
        knowledge_graph_summary.status === 'maturing'
          ? 'strong'
          : knowledge_graph_summary.status === 'emerging'
            ? 'moderate'
            : 'watch',
    },
    {
      label: 'Evidence strength',
      explanation:
        evidenceInputs.length === 0
          ? 'Evidence too early -> not decision-grade yet.'
          : report_readiness_summary.performance.state === 'collecting_baseline'
            ? 'Evidence exists, but it is still too early to trust fully.'
          : report_readiness_summary.growth.state === 'ready_now'
              ? 'Evidence broad enough -> deeper commercial decisions are now justified.'
              : 'Signals exist, but they are not decision-grade yet.',
      tone:
        report_readiness_summary.growth.state === 'ready_now'
          ? 'strong'
          : report_readiness_summary.performance.state === 'ready_now' || report_readiness_summary.performance.state === 'ready_soon'
            ? 'moderate'
            : 'watch',
    },
  ];
}

function deriveSupportingSignals(snapshot: Snapshot): Array<{
  title: string;
  summary: string;
  href: string;
  label: string;
}> {
  const topMetric = snapshot.audience_response.metric_rankings[0];
  const weakestMetric = snapshot.audience_response.metric_rankings[snapshot.audience_response.metric_rankings.length - 1];
  const dominantCampaignPath = formatCampaignPathLabel(snapshot.campaign_mix_summary.dominant_path);

  return [
    {
      title: 'Campaigns',
      summary: dominantCampaignPath
        ? `${snapshot.system_snapshot.total_campaigns} campaigns are visible, with ${dominantCampaignPath} currently acting as the main execution path.`
        : `${snapshot.system_snapshot.total_campaigns} campaigns are visible, but the system still needs cleaner execution history before a dominant path is obvious.`,
      href: '/command-center/campaigns',
      label: 'Open campaigns',
    },
    {
      title: 'Knowledge graph',
      summary: `${KNOWLEDGE_GRAPH_LABELS[snapshot.knowledge_graph_summary.status]} graph with ${snapshot.knowledge_graph_summary.topic_cluster_count} topic cluster${snapshot.knowledge_graph_summary.topic_cluster_count === 1 ? '' : 's'}${snapshot.knowledge_graph_summary.weakest_stage ? `; weakest stage is ${snapshot.knowledge_graph_summary.weakest_stage}` : ''}.`,
      href: '/command-center/content',
      label: 'Open content system',
    },
    {
      title: 'Metrics',
      summary: topMetric
        ? `${topMetric.label} is strongest right now${weakestMetric ? `, while ${weakestMetric.label.toLowerCase()} remains the main drag` : ''}.`
        : 'The system does not have enough metric depth yet to separate the strongest and weakest signal cleanly.',
      href: '/engagement',
      label: 'Open engagement',
    },
    {
      title: 'History',
      summary: snapshot.reports_summary.total_reports > 0
        ? `${snapshot.reports_summary.total_reports} reports and ${snapshot.market_pulse_summary.completed_runs} Market Pulse run${snapshot.market_pulse_summary.completed_runs === 1 ? '' : 's'} are available as historical context for current decisions.`
        : 'Historical context is still light, so current recommendations depend more on live operating signal than long-term pattern memory.',
      href: '/reports',
      label: 'Open reports',
    },
  ];
}

function deriveBottomLine(snapshot: Snapshot): { text: string; cta: { href: string; label: string } | null } {
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const _actions = deriveSystemActionLines(snapshot);
  const action = _actions.doNow[0] ?? _actions.doNext[0] ?? _actions.monitor[0] ?? null;

  return {
    text:
      snapshot.system_snapshot.health === 'weak'
        ? 'Do not scale noise. Build signal first. Fix publishing rhythm and distribution. Scale only when signal is consistent.'
        : `Do not scale noise. Build signal first. Fix ${bottleneck.title.toLowerCase()}. Scale only when signal is consistent.`,
    cta: action ? { href: action.href, label: action.label } : null,
  };
}

function deriveConstraintConfidence(snapshot: Snapshot): ConstraintConfidence {
  return snapshot.system_snapshot.evaluated_campaigns >= 6 && snapshot.lead_summary.engagement_signals > 0
    ? 'High'
    : snapshot.system_snapshot.evaluated_campaigns >= 3
      ? 'Medium'
      : 'Low';
}

function getConfidenceRank(confidence: ConstraintConfidence): number {
  return confidence === 'High' ? 3 : confidence === 'Medium' ? 2 : 1;
}

function deriveConstraintConfidenceDirection(snapshot: Snapshot): ConfidenceDirection {
  if (typeof window === 'undefined') return 'flat';

  try {
    const saved = window.localStorage.getItem(MARKETING_INTEL_CONFIDENCE_STORAGE_KEY);
    const outcomeSaved = window.localStorage.getItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY);
    const improvingOutcomes = outcomeSaved ? countImprovingOutcomes(snapshot, normalizeOutcomeBaselines(JSON.parse(outcomeSaved))) : 0;
    const current = {
      confidence: deriveConstraintConfidence(snapshot),
      evaluatedCampaigns: snapshot.system_snapshot.evaluated_campaigns,
      engagementSignals: snapshot.lead_summary.engagement_signals,
      improvingOutcomes,
    };

    window.localStorage.setItem(MARKETING_INTEL_CONFIDENCE_STORAGE_KEY, JSON.stringify(current));

    if (!saved) return 'flat';

    const previous = JSON.parse(saved) as Partial<{
      confidence: ConstraintConfidence;
      evaluatedCampaigns: number;
      engagementSignals: number;
      improvingOutcomes: number;
    }>;

    if (!previous.confidence) return 'flat';

    const currentRank = getConfidenceRank(current.confidence);
    const previousRank = getConfidenceRank(previous.confidence);
    if (currentRank > previousRank) return 'up';
    if (currentRank < previousRank) return 'down';

    const currentSupport = current.evaluatedCampaigns + current.engagementSignals;
    const previousSupport = (previous.evaluatedCampaigns ?? 0) + (previous.engagementSignals ?? 0);
    if (currentSupport > previousSupport) return 'up';
    if (currentSupport < previousSupport) return 'down';

    if (current.improvingOutcomes > (previous.improvingOutcomes ?? 0)) return 'up';
    if (current.improvingOutcomes < (previous.improvingOutcomes ?? 0)) return 'down';
  } catch {}

  return 'flat';
}

function deriveSystemMemory(snapshot: Snapshot): Array<{ direction: 'up' | 'flat' | 'down'; text: string }> {
  const items: Array<{ direction: 'up' | 'flat' | 'down'; text: string }> = [];

  if (snapshot.content_summary.recent_blogs > 0) {
    items.push({
      direction: 'up',
      text: `Publishing activity increased (+${snapshot.content_summary.recent_blogs} piece${snapshot.content_summary.recent_blogs === 1 ? '' : 's'})`,
    });
  } else {
    items.push({
      direction: 'down',
      text: 'No new content published (rhythm still weak)',
    });
  }

  if (snapshot.distribution_summary.active_platforms <= 1) {
    items.push({
      direction: 'flat',
      text: `Distribution unchanged (still limited to ${snapshot.distribution_summary.active_platforms || 1} channel)`,
    });
  } else {
    items.push({
      direction: 'up',
      text: `Distribution broader (${snapshot.distribution_summary.active_platforms} active channels)`,
    });
  }

  if (snapshot.lead_summary.engagement_signals > 0 || snapshot.engagement_summary.threads > 0) {
    items.push({
      direction: 'up',
      text: 'Evidence slightly stronger (more engagement signals)',
    });
  }

  if (snapshot.report_readiness_summary.performance.state === 'collecting_baseline') {
    items.push({
      direction: 'flat',
      text: 'Evidence still building (not decision-grade yet)',
    });
  }

  return items.slice(0, 4);
}

function derivePrimaryBottleneckCta(snapshot: Snapshot): { href: string; label: string } | null {
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const title = bottleneck.title.toLowerCase();

  if (title.includes('rhythm')) {
    return { href: '/admin/content', label: 'Tighten operating rhythm' };
  }
  if (title.includes('stage depth')) {
    const weakestStage = snapshot.knowledge_graph_summary.weakest_stage;
    return {
      href:
        weakestStage === 'awareness'
          ? '/posts/create'
          : weakestStage === 'decision'
            ? '/case-studies/create'
            : '/admin/content',
      label: 'Strengthen weak stage',
    };
  }
  if (title.includes('strategic consistency')) {
    return { href: '/command-center/campaigns', label: 'Tighten campaign strategy' };
  }
  if (title.includes('limiting factor')) {
    return { href: '/engagement', label: 'Fix conversion drag' };
  }
  if (title.includes('evidence depth')) {
    return { href: '/command-center/content', label: 'Build more signal' };
  }
  return { href: '/command-center/content', label: 'Broaden portfolio depth' };
}

function LearnedSignalsSection({ snapshot }: { snapshot: Snapshot }) {
  const learned = deriveLearnedSignals(snapshot);
  const cta = deriveLearnedSignalsCta(snapshot);

  if (learned.length === 0) return null;

  return (
    <SectionCard
      title="What We Have Learned"
      badge="Top signals"
      footer={<SectionCta href={cta.href} label={cta.label} />}
    >
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
  const confidence = deriveConstraintConfidence(snapshot);
  const [confidenceDirection, setConfidenceDirection] = React.useState<ConfidenceDirection>('flat');
  const [confidenceReason, setConfidenceReason] = React.useState<string | null>(null);

  React.useEffect(() => {
    setConfidenceDirection(deriveConstraintConfidenceDirection(snapshot));
    if (typeof window === 'undefined') {
      setConfidenceReason(null);
      return;
    }

    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY);
      if (!saved) {
        setConfidenceReason(null);
        return;
      }

      const improvingOutcomes = countImprovingOutcomes(snapshot, normalizeOutcomeBaselines(JSON.parse(saved)));
      setConfidenceReason(improvingOutcomes > 0 ? 'Improving signal after recent actions' : null);
    } catch {
      setConfidenceReason(null);
    }
  }, [snapshot]);

  const confidenceTone =
    confidence === 'High'
      ? 'bg-emerald-50 text-emerald-700'
      : confidence === 'Medium'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-gray-100 text-gray-600';
  const confidenceGlyph = confidenceDirection === 'up' ? '\u2191' : confidenceDirection === 'down' ? '\u2193' : '\u2192';

  return (
    <SectionCard
      title="Primary Constraint"
      badge="Main blocker"
      className="h-full"
    >
      <div className="rounded-2xl border border-amber-300 bg-amber-50 py-7 px-6 shadow-md">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-amber-200 p-2.5">
            <AlertCircle className="h-5 w-5 text-amber-800" />
          </div>
            <div className="border-l-[6px] border-amber-500 pl-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-lg font-bold text-slate-950">{bottleneck.title}</p>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${confidenceTone}`}>
                  Confidence: {confidence} {confidenceGlyph}
                </span>
              </div>
            {confidenceReason && (
              <p className="mb-2 text-[11px] font-medium text-slate-500">{confidenceReason}</p>
            )}
            <p className="mt-2 max-w-4xl text-sm leading-[1.6] text-slate-600">{bottleneck.detail}</p>
            <p className="mt-3 text-xs font-medium text-amber-800/90">
              If this is not fixed, the team will keep making scaling decisions on unreliable signal.
            </p>
            <p className="mt-2 text-xs font-semibold text-amber-800">
              Fix rhythm. Then measure. Then scale.
            </p>
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
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const constraintLabel = bottleneck.title.toLowerCase().includes('operating rhythm')
    ? 'inconsistent operating rhythm'
    : bottleneck.title.toLowerCase();
  const doNowItems = React.useMemo(() => deriveCurrentDoNowItems(snapshot), [snapshot]);
  const [actionProgress, setActionProgress] = React.useState<Record<string, ActionProgressEntry>>({});
  const [outcomeBaselines, setOutcomeBaselines] = React.useState<Record<string, ActionOutcomeBaseline>>({});

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_PROGRESS_STORAGE_KEY);
      if (saved) {
        setActionProgress(normalizeActionProgress(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY);
      if (saved) {
        setOutcomeBaselines(normalizeOutcomeBaselines(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MARKETING_INTEL_PROGRESS_STORAGE_KEY, JSON.stringify(actionProgress));
    } catch {}
  }, [actionProgress]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY, JSON.stringify(outcomeBaselines));
    } catch {}
  }, [outcomeBaselines]);

  React.useEffect(() => {
    setActionProgress((prev) => {
      const next: Record<string, ActionProgressEntry> = {};
      doNowItems.forEach((item) => {
        next[item.id] = prev[item.id] ?? buildActionProgressEntry('not_started');
      });
      return next;
    });
  }, [doNowItems]);

  const completedCount = doNowItems.filter((item) => actionProgress[item.id]?.status === 'completed').length;
  const recommendedNextAction =
    doNowItems.find((item) => actionProgress[item.id]?.status !== 'completed') ??
    doNowItems[0] ??
    (systemLines.doNext[0]
      ? {
          id: systemLines.doNext[0].label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          label: systemLines.doNext[0].text,
          href: systemLines.doNext[0].href,
          ctaLabel: systemLines.doNext[0].label,
        }
      : null);
  const markActionCompleted = (itemId: string, previous?: ActionProgressEntry) => {
    setActionProgress((prev) => ({
      ...prev,
      [itemId]: buildActionProgressEntry('completed', previous ?? prev[itemId]),
    }));

    setOutcomeBaselines((prev) => {
      if (prev[itemId]) return prev;
      return {
        ...prev,
        [itemId]: {
          capturedAt: new Date().toISOString(),
          signals: deriveOutcomeSignals(snapshot),
        },
      };
    });
  };
  const groups = [
    {
      key: 'do-now',
      title: 'Do now',
      items: buckets.doNow,
      systemItems: systemLines.doNow,
      tone: 'border-[#FECACA] bg-[#FEF2F2]',
      text: 'text-red-800',
      empty: 'No urgent action is blocking progress right now.',
    },
    {
      key: 'do-next',
      title: 'Do next',
      items: buckets.doNext,
      systemItems: systemLines.doNext,
      tone: 'border-[#E2E8F0] bg-[#F8FAFC]/95',
      text: 'text-blue-600',
      empty: 'No medium-priority follow-up actions are waiting.',
    },
  ] as const;

  return (
    <SectionCard title="Action Plan" badge="Do now + do next">
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-sm leading-relaxed text-gray-700">
          To fix <span className="font-semibold text-gray-900">{constraintLabel}</span>:
        </p>
      </div>
      {recommendedNextAction && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50/70 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-700">Recommended next action</p>
          <p className="mt-1 text-xs font-medium text-red-700/80">
            {completedCount} of {doNowItems.length} actions completed — next: {recommendedNextAction.ctaLabel}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-950">{recommendedNextAction.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-red-700/70">
                → {getRecommendedActionReason(recommendedNextAction).charAt(0).toLowerCase() + getRecommendedActionReason(recommendedNextAction).slice(1)}
              </p>
            </div>
            <SectionCta href={recommendedNextAction.href} label={recommendedNextAction.ctaLabel} variant="critical" />
          </div>
        </div>
      )}
      <div className="mb-4 text-xs font-medium text-gray-600">
        Progress: {completedCount} / {doNowItems.length} actions completed
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map((group) => (
          <div key={group.key} className={`rounded-xl border p-4 ${group.tone}`}>
            <p className={`${group.key === 'do-now' ? 'text-[10px]' : 'text-[9px]'} font-bold uppercase tracking-widest ${group.text}`}>{group.title}</p>
            <div className="mt-3 space-y-3">
              {group.key === 'do-now' ? (
                doNowItems.length > 0 ? (
                  doNowItems.map((item) => {
                    const progress = actionProgress[item.id] ?? buildActionProgressEntry('not_started');
                    const status = progress.status;
                    const isCompleted = status === 'completed';
                    const isInProgress = status === 'in_progress';
                    const isStale = !isCompleted && Date.now() - new Date(progress.updatedAt).getTime() > STALE_ACTION_MS;

                    return (
                      <div key={item.id} className={`space-y-2.5 py-1 transition-opacity ${isCompleted ? 'opacity-70' : 'opacity-100'}`}>
                        <p className="text-sm font-semibold text-red-950">{item.label}</p>
                        {isStale && (
                          <p className="text-xs font-medium text-red-700">
                            {isInProgress ? 'This action is still pending.' : 'No progress made on this critical action yet.'}
                          </p>
                        )}
                        {isInProgress && !isCompleted && (
                          <p className="text-xs font-medium text-blue-700">In progress...</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {isCompleted ? (
                            <>
                              <span className="inline-flex items-center rounded-[8px] bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                &#10003; Completed
                              </span>
                              <span className="text-xs font-medium text-emerald-700/90">
                                {getActionCompletionFeedback(item)}
                              </span>
                            </>
                          ) : (
                            <>
                              <Link
                                href={item.href}
                                onClick={() =>
                                  setActionProgress((prev) => ({
                                    ...prev,
                                    [item.id]: buildActionProgressEntry('in_progress', prev[item.id]),
                                  }))
                                }
                                className="inline-flex items-center gap-1.5 rounded-[8px] border border-transparent bg-[#DC2626] px-4 py-2 text-xs font-semibold tracking-[0.2px] text-white shadow-sm transition-all duration-150 ease-out hover:-translate-y-[1px] hover:bg-[#B91C1C]"
                              >
                                {item.ctaLabel}
                                <ArrowRight className="h-3 w-3" />
                              </Link>
                              <button
                                type="button"
                                onClick={() => markActionCompleted(item.id, progress)}
                                className="inline-flex items-center rounded-[8px] border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition-all duration-150 ease-out hover:-translate-y-[1px] hover:border-red-300 hover:bg-red-50"
                              >
                                Mark as done &#10003;
                              </button>
                            </>
                          )}
                        </div>
                        {isCompleted && (
                          <div className="space-y-1 rounded-lg bg-white/50 px-3 py-2">
                            <p className="text-[11px] font-semibold text-gray-600">After this action:</p>
                            {deriveOutcomeMessages(item, outcomeBaselines[item.id], snapshot).map((line) => (
                              <p key={`${item.id}-${line}`} className="text-xs text-gray-600">
                                {line}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-gray-500">{group.empty}</p>
                )
              ) : group.systemItems.length > 0 ? (
                group.systemItems.slice(0, 2).map((item) => (
                  <div key={`${group.key}-${item.text}`} className="rounded-lg bg-white/80 p-3">
                    <p className="text-xs font-semibold text-gray-800">{item.text}</p>
                    <div className="mt-2">
                      <SectionCta href={item.href} label={item.label} variant="secondary" />
                    </div>
                  </div>
                ))
              ) : null}
              {group.key !== 'do-now' && group.items.length > 0 ? (
                group.items.slice(0, 3).map((action) => (
                  <div key={`${group.key}-${action.campaign_id}`} className="rounded-lg bg-white/80 p-3">
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

function SystemDiagnosisSection({ snapshot }: { snapshot: Snapshot }) {
  const diagnosis = deriveDiagnosis(snapshot);

  return (
    <SectionCard title="Why This Is Happening" badge="Diagnosis">
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-sm leading-relaxed text-gray-700">
          The system is active, but not consistent enough to generate reliable learning. Content, distribution, and evidence are fragmented, so patterns appear, but cannot be trusted.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {diagnosis.map((item) => {
          const tone = toneClasses(item.tone);
          const accent =
            item.label === 'Evidence strength'
              ? 'border-l-blue-400'
              : 'border-l-amber-400';
          return (
            <div key={item.label} className={`rounded-xl border border-gray-100 border-l-4 bg-gray-50 p-4 ${accent}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{item.label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
                  {item.tone === 'strong' ? 'Healthy' : item.tone === 'moderate' ? 'Mixed' : 'Weak'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{item.explanation}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function SystemMemorySection({ snapshot }: { snapshot: Snapshot }) {
  const items = deriveSystemMemory(snapshot);
  if (items.length === 0) return null;

  const indicatorTone = {
    up: 'text-emerald-600',
    flat: 'text-slate-500',
    down: 'text-amber-600',
  } as const;

  const indicatorGlyph = {
    up: '\u2191',
    flat: '\u2192',
    down: '\u2193',
  } as const;

  return (
    <div className="px-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Since last check</p>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {items.map((item) => (
          <li key={`${item.direction}-${item.text}`} className="flex items-start gap-2">
            <span className={indicatorTone[item.direction]}>{indicatorGlyph[item.direction]}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionAwarenessSection({ snapshot }: { snapshot: Snapshot }) {
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const doNowItems = deriveCurrentDoNowItems(snapshot);

    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_PROGRESS_STORAGE_KEY);
      if (!saved) {
        setMessage(doNowItems.length > 0 ? 'System just initialized. Start with Do Now.' : null);
        return;
      }

      const progress = normalizeActionProgress(JSON.parse(saved));
      const pendingCount = doNowItems.filter((item) => progress[item.id]?.status !== 'completed').length;

      if (pendingCount > 0) {
        setMessage(`You have ${pendingCount} pending action${pendingCount === 1 ? '' : 's'} from last session.`);
      } else {
        setMessage('Last session’s urgent actions are complete. Move to the next system step.');
      }
    } catch {
      setMessage(doNowItems.length > 0 ? 'System just initialized. Start with Do Now.' : null);
    }
  }, [snapshot]);

  if (!message) return null;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-sm font-medium text-gray-700">{message}</p>
    </div>
  );
}

function SupportingSignalsSection({ snapshot }: { snapshot: Snapshot }) {
  const cards = deriveSupportingSignals(snapshot);

  return (
    <SectionCard title="Supporting Signals" badge="Optional drill-down">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{card.title}</p>
            <p className="mt-3 text-sm leading-relaxed text-gray-700">{card.summary}</p>
            <div className="mt-3">
              <SectionCta href={card.href} label={card.label} />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function BottomLineSection({ snapshot }: { snapshot: Snapshot }) {
  const bottomLine = deriveBottomLine(snapshot);

  return (
    <SectionCard
      title="Bottom Line"
      badge="Decision"
    >
      <div className="rounded-xl border border-slate-300 bg-slate-100 p-6 shadow-md">
        <p className="text-lg font-bold text-slate-950">Do not scale noise. Build signal first.</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{bottomLine.text}</p>
      </div>
    </SectionCard>
  );
}

function CommercialReadinessSection({ snapshot }: { snapshot: Snapshot }) {
  const insights = deriveCommercialReadiness(snapshot);
  const cta = deriveCommercialReadinessCta(snapshot);

  return (
    <SectionCard
      title="Commercial Readiness"
      badge="Next commercial move"
      className="h-full"
      footer={<SectionCta href={cta.href} label={cta.label} />}
    >
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

function EcosystemProgressSection({ snapshot }: { snapshot: Snapshot }) {
  const graph = snapshot.knowledge_graph_summary;
  const timing = snapshot.timing_summary;
  const distribution = snapshot.distribution_summary;
  const topPlatform = distribution.platform_mix[0];
  const cta = deriveEcosystemProgressCta(snapshot);

  const graphTone =
    graph.status === 'maturing' ? toneClasses('strong') :
    graph.status === 'imbalanced' ? toneClasses('watch') :
    toneClasses('moderate');
  const rhythmTone =
    timing.rhythm_state === 'strong' ? toneClasses('strong') :
    timing.rhythm_state === 'thin' ? toneClasses('watch') :
    toneClasses('moderate');
  const distributionTone =
    distribution.active_platforms >= 2 && distribution.publish_success_rate >= 85
      ? toneClasses('strong')
      : distribution.active_platforms === 0 || distribution.publish_success_rate < 80
        ? toneClasses('watch')
        : toneClasses('moderate');

  return (
    <SectionCard
      title="Ecosystem Progress"
      badge="Compounding health"
      footer={<SectionCta href={cta.href} label={cta.label} />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Knowledge graph</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${graphTone.badge}`}>{KNOWLEDGE_GRAPH_LABELS[graph.status]}</span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${graphTone.text}`}>
            {graph.dominant_cluster ?? 'No dominant cluster yet'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            {graph.topic_cluster_count} topic cluster{graph.topic_cluster_count === 1 ? '' : 's'}, {graph.format_diversity} active format{graph.format_diversity === 1 ? '' : 's'}, and stage coverage of {graph.stage_coverage.awareness} awareness, {graph.stage_coverage.consideration} consideration, and {graph.stage_coverage.decision} decision assets.
          </p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Operating rhythm</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${rhythmTone.badge}`}>{timing.rhythm_state === 'strong' ? 'Strong' : timing.rhythm_state === 'steady' ? 'Steady' : 'Thin'}</span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${rhythmTone.text}`}>
            {timing.active_days} active day{timing.active_days === 1 ? '' : 's'} in the current window
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            {timing.latest_activity_at
              ? `The latest visible activity landed on ${new Date(timing.latest_activity_at).toLocaleDateString()}, and the average gap between visible events is ${timing.avg_gap_days ?? '—'} days.`
              : 'No recent content or distribution rhythm is visible yet, so momentum is still being inferred from isolated activity.'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Distribution shape</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${distributionTone.badge}`}>{distribution.active_platforms === 0 ? 'Inactive' : distribution.active_platforms === 1 ? 'Narrow' : 'Broadening'}</span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${distributionTone.text}`}>
            {distribution.active_platforms} active platform{distribution.active_platforms === 1 ? '' : 's'} with {distribution.publish_success_rate}% reliability
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            {topPlatform
              ? `${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of visible distribution right now${distribution.platform_mix[1] ? `, followed by ${formatPlatformLabel(distribution.platform_mix[1].platform)}.` : '.'}`
              : 'Connected publishing channels exist, but there is still too little live distribution data to describe channel concentration.'}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. System Snapshot
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 2. Campaign Status
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 3. Content Performance
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 6. Audience Response
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 7. Strategic Memory
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 8. Next Actions — Part 2 enhanced priority badges
// ─────────────────────────────────────────────────────────────────────────────

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
type MarketingIntelHookState = ReturnType<typeof useMarketingIntel>;
type MarketingIntelState = Omit<MarketingIntelHookState, 'snapshot' | 'setSnapshot'> & {
  snapshot: Snapshot | null;
  setSnapshot: React.Dispatch<React.SetStateAction<Snapshot | null>>;
};

export default function MarketingIntelView({ d }: { d: MarketingIntelState }) {
  const vm = useMarketingIntelViewModel(d);
  void vm;
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

            <ExecutiveSummary d={d} />

            <SessionAwarenessSection snapshot={snapshot} />

            <SystemDiagnosisSection snapshot={snapshot} />

            <SystemMemorySection snapshot={snapshot} />

            <PrimaryBottleneckSection snapshot={snapshot} />

            <ActionBucketsSection snapshot={snapshot} />

            <SupportingSignalsSection snapshot={snapshot} />

            <BottomLineSection snapshot={snapshot} />

            <ObjectiveSetupNotice snapshot={snapshot} />

            <details className="group rounded-2xl border border-gray-100 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Supporting Signals</p>
                  <p className="mt-1 text-sm text-gray-600">Open this only when you want campaigns, knowledge graph, metrics, and history.</p>
                </div>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 group-open:bg-blue-50 group-open:border-blue-200 group-open:text-blue-700">
                  Open drill-down
                </span>
              </summary>
              <div className="border-t border-gray-100 px-6 py-6 space-y-6">
                <OperatingOverviewSection d={d} />

                <TargetPotentialSection d={d} />

                <LearnedSignalsSection snapshot={snapshot} />

                <CommercialReadinessSection snapshot={snapshot} />

                <EcosystemProgressSection snapshot={snapshot} />

                {/* System Snapshot */}
                {isVisible('system_snapshot') && (
                  <SystemSnapshotSection d={d} />
                )}

                {/* Next Actions */}
                {isVisible('next_actions') && (
                  <NextActionsSection d={d} />
                )}

                {/* Strategic Intelligence + Campaign DNA */}
                {(isVisible('strategic_intelligence') || isVisible('campaign_dna')) && (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {isVisible('strategic_intelligence') && (
                      <StrategicIntelligenceSection data={snapshot.strategic_intelligence} />
                    )}
                    {isVisible('campaign_dna') && (
                      <CampaignDnaSection d={d} />
                    )}
                  </div>
                )}

                {/* Audience Response + Strategic Memory */}
                {(isVisible('audience_response') || isVisible('strategic_memory')) && (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {isVisible('audience_response') && (
                      <AudienceResponseSection d={d} />
                    )}
                    {isVisible('strategic_memory') && (
                      <StrategicMemorySection d={d} />
                    )}
                  </div>
                )}
              </div>
            </details>

            {/* Content Performance */}
            {isVisible('content_performance') && (
              <ContentPerformanceSection d={d} />
            )}

            {/* Campaign Status */}
            {isVisible('campaign_status') && (
              <CampaignStatusSection d={d} />
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

