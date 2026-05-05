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
import PrimaryBottleneckSection from '@/features/marketing-intel/components/PrimaryBottleneckSection';
import ActionBucketsSection from '@/features/marketing-intel/components/ActionBucketsSection';
import LearnedSignalsSection from '@/features/marketing-intel/components/LearnedSignalsSection';
import BottomLineSection from '@/features/marketing-intel/components/BottomLineSection';
import CommercialReadinessSection from '@/features/marketing-intel/components/CommercialReadinessSection';
import StrategicIntelligenceSection from '@/features/marketing-intel/components/StrategicIntelligenceSection';
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
  PATTERN_TYPE_LABELS,
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
  deriveLearnedSignals,
  deriveLearnedSignalsCta,
  deriveBottomLine,
  deriveCommercialReadiness,
  deriveCommercialReadinessCta,
  deriveEcosystemProgressCta,
  deriveDiagnosis,
  deriveSystemMemory,
  deriveSupportingSignals,
} from '@/features/marketing-intel/derives';
import { deriveSystemActionLines } from '@/features/marketing-intel/actionLines';
import {
  type ActionStatus,
  type ConstraintConfidence,
  type ConfidenceDirection,
  type ActionProgressEntry,
  type OutcomeSignalSnapshot,
  type ActionOutcomeBaseline,
  MARKETING_INTEL_PROGRESS_STORAGE_KEY,
  MARKETING_INTEL_CONFIDENCE_STORAGE_KEY,
  MARKETING_INTEL_OUTCOME_STORAGE_KEY,
  STALE_ACTION_MS,
  EARLY_OUTCOME_WINDOW_MS,
  normalizeActionProgress,
  buildActionProgressEntry,
  deriveOutcomeSignals,
  normalizeOutcomeBaselines,
  countImprovingOutcomes,
  getActionCompletionFeedback,
  getRecommendedActionReason,
  deriveOutcomeMessages,
  deriveCurrentDoNowItems,
  splitActionBuckets,
  deriveConstraintConfidence,
  deriveConstraintConfidenceDirection,
} from '@/features/marketing-intel/outcomeTracking';

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

            <PrimaryBottleneckSection d={d} />

            <ActionBucketsSection d={d} />

            <SupportingSignalsSection snapshot={snapshot} />

            <BottomLineSection d={d} />

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

                <LearnedSignalsSection d={d} />

                <CommercialReadinessSection d={d} />

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
                      <StrategicIntelligenceSection d={d} />
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
