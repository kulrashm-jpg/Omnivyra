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
import SystemDiagnosisSection from '@/features/marketing-intel/components/SystemDiagnosisSection';
import SystemMemorySection from '@/features/marketing-intel/components/SystemMemorySection';
import SessionAwarenessSection from '@/features/marketing-intel/components/SessionAwarenessSection';
import SupportingSignalsSection from '@/features/marketing-intel/components/SupportingSignalsSection';
import EcosystemProgressSection from '@/features/marketing-intel/components/EcosystemProgressSection';
import ObjectiveSetupNotice from '@/features/marketing-intel/components/ObjectiveSetupNotice';
import ConfigurePanel from '@/features/marketing-intel/components/ConfigurePanel';
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

// ─────────────────────────────────────────────────────────────────────────────
// Visual helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SectionCard — Part 4 microcopy via `description` prop
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — Executive Summary component










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
// Main page
// ─────────────────────────────────────────────────────────────────────────────

import type { MarketingIntelData } from '@/features/marketing-intel/types';
type MarketingIntelHookState = MarketingIntelData;
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

            <SessionAwarenessSection d={d} />

            <SystemDiagnosisSection d={d} />

            <SystemMemorySection d={d} />

            <PrimaryBottleneckSection d={d} />

            <ActionBucketsSection d={d} />

            <SupportingSignalsSection d={d} />

            <BottomLineSection d={d} />

            <ObjectiveSetupNotice d={d} />

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

                <EcosystemProgressSection d={d} />

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
