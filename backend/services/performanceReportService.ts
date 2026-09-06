import { composeReport } from './reportComposerService';
import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import type { SnapshotReport } from './snapshotReportTypes';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { resolveAnalyticsReportInput } from './analyticsInputResolver';
import { buildCompetitorIntelligence, type CompetitorIntelligenceResult } from './reportCompetitorIntelligenceService';
import {
  buildCompetitivePressureAnalysis,
  type CompetitivePressureAnalysis,
} from './reportCompetitorStrategyService';
import {
  impactScore,
  rankByImpactConfidence,
  isOpportunitySignal,
} from './reportDecisionUtils';
import { buildPublicDomainAuditDecisions } from './publicDomainAuditService';
import { buildDecisionBusinessImpact } from './businessImpactFormatter';
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { getGoogleProviderReadiness } from './googleProviderReadinessService';
import { getAnalyticsHealthSummary, type AnalyticsHealthSummary } from './analyticsHealthService';
import { getAnalyticsEnterpriseSnapshot, type AnalyticsEnterpriseSnapshot } from './analyticsEnterpriseSnapshotService';
import { runDedupedReport, type ReportConcurrencyMetadata } from './reportConcurrencyService';
import {
  getTrafficSources,
  getTopPages,
  getSessionMetrics,
  getDropOffPages,
  getBasicFunnel,
  getConversionSummary,
  type BehaviorQueryOpts,
  type TrafficSourceRow,
  type TopPageRow,
  type SessionMetrics,
  type DropOffPageRow,
  type FunnelResult,
  type ConversionSummary,
} from './behaviorAnalyticsService';
import {
  generateBehaviorInsights,
  type BehaviorInsight,
  type BehaviorInsightReportData,
} from './behaviorInsightService';
import {
  generateBehaviorRecommendations,
  type BehaviorRecommendation,
  type BehaviorRecommendationReportData,
} from './behaviorRecommendationService';
import { performanceSections } from './performanceReportSections';
import {
  performanceRendererMap,
  performanceReportStyles,
  renderPerformanceDocument,
  renderPerformanceStateDocument,
  type PerformanceRenderMeta,
} from './performanceHtmlRenderer';
import {
  mapPerformanceReportData,
  type PerformanceSnapshotFoundation,
  type PerformanceReportMappedData,
} from './performanceReportMapper';
import {
  buildPerformanceSearchIntelligence,
  type PerformanceSearchIntelligence,
} from './performanceSearchIntelligenceService';
import {
  buildPerformanceBehaviorIntelligence,
  type PerformanceBehaviorIntelligence,
} from './performanceBehaviorIntelligenceService';
import {
  buildSharedPerformanceIntelligencePrimitives,
  getCreatorIntelligenceCompatibility,
  type CreatorCompatibilityAssessment,
  type SharedIntelligencePrimitive,
} from './sharedPerformanceIntelligencePrimitivesService';
import {
  evaluatePerformanceReportForRealUserReview,
  type PerformanceReportEvaluation,
} from './performanceReportEvaluationService';

const PERFORMANCE_SECTION_DEFINITIONS = [
  {
    section_name: 'Funnel and Journey Diagnostics',
    IU_ids: ['IU-02', 'IU-10'],
  },
  {
    section_name: 'Conversion and Behavior Quality',
    IU_ids: ['IU-06', 'IU-08', 'IU-09'],
  },
  {
    section_name: 'Engagement and Efficiency Friction',
    IU_ids: ['IU-07', 'IU-14'],
  },
] as const;

const PERFORMANCE_IU_IDS: Set<string> = new Set(
  PERFORMANCE_SECTION_DEFINITIONS.flatMap((section) => section.IU_ids),
);

function uniqueReportWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = warning.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type PerformanceInsight = {
  decision_id: string;
  title: string;
  description: string;
  business_impact: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  recommendation: string;
  action_type: string;
};

type PerformanceOpportunity = {
  decision_id: string;
  title: string;
  recommendation: string;
  confidence_score: number;
  action_type: string;
};

type PerformanceAction = {
  decision_id: string;
  title: string;
  recommendation: string;
  action_type: string;
  action_payload: Record<string, unknown>;
};

export interface PerformanceReportSection {
  section_name: string;
  IU_ids: string[];
  insights: PerformanceInsight[];
  opportunities: PerformanceOpportunity[];
  actions: PerformanceAction[];
}

export interface PerformanceReport {
  report_type: 'performance';
  score: {
    available: true;
    value: null;
    label: null;
  };
  competitive_pressure_analysis: CompetitivePressureAnalysis | null;
  sections: PerformanceReportSection[];
}

type PerformanceReportOptions = {
  resolvedInput?: ResolvedReportInput | null;
};

type PerformanceIntelligenceOptions = BehaviorQueryOpts & {
  resolvedInput?: ResolvedReportInput | null;
};

function toInsight(decision: PersistedDecisionObject): PerformanceInsight {
  return {
    decision_id: decision.id,
    title: decision.title,
    description: decision.description,
    business_impact: buildDecisionBusinessImpact(decision),
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

function toOpportunity(decision: PersistedDecisionObject): PerformanceOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

function toAction(decision: PersistedDecisionObject): PerformanceAction {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    action_type: decision.action_type,
    action_payload: decision.action_payload ?? {},
  };
}

function mapDecisionsToPerformanceGroups(
  decisions: PersistedDecisionObject[],
  performanceUnits: IntelligenceUnitWithConfig[],
): Map<string, PersistedDecisionObject[]> {
  const groups = new Map<string, PersistedDecisionObject[]>();

  for (const decision of decisions) {
    const unit = mapDecisionToIntelligenceUnit(decision, performanceUnits);
    if (!unit) continue;
    const current = groups.get(unit.id) ?? [];
    current.push(decision);
    groups.set(unit.id, current);
  }

  return groups;
}

async function resolveInputForCompetitorStrategy(params: {
  companyId: string;
  reportCategory: 'performance' | 'growth';
  resolvedInput?: ResolvedReportInput | null;
}): Promise<ResolvedReportInput | null> {
  if (params.resolvedInput) return params.resolvedInput;
  try {
    return await resolveAnalyticsReportInput({
      companyId: params.companyId,
      reportCategory: params.reportCategory,
    });
  } catch (error) {
    console.warn('[competitor-strategy][input-resolution-failed]', {
      company_id: params.companyId,
      report_category: params.reportCategory,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildCompetitivePressureSafely(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput: ResolvedReportInput | null;
}): {
  intelligence: CompetitorIntelligenceResult | null;
  pressure: CompetitivePressureAnalysis | null;
} {
  if (!params.resolvedInput) return { intelligence: null, pressure: null };
  try {
    const intelligence = buildCompetitorIntelligence({
      decisions: params.decisions,
      resolvedInput: params.resolvedInput,
    });
    return {
      intelligence,
      pressure: buildCompetitivePressureAnalysis(intelligence),
    };
  } catch (error) {
    console.warn('[competitor-strategy][pressure-build-failed]', {
      company_id: params.resolvedInput.companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { intelligence: null, pressure: null };
  }
}

export async function composePerformanceReport(
  companyId: string,
  options?: PerformanceReportOptions,
): Promise<PerformanceReport> {
  const [baseReport, units] = await Promise.all([
    composeReport({
      companyId,
      reportTier: 'deep',
      status: ['open'],
    }),
    listCompanyIntelligenceUnits(companyId),
  ]);
  const publicAudit = await buildPublicDomainAuditDecisions({
    companyId,
    reportTier: 'deep',
    resolvedInput: options?.resolvedInput ?? null,
  });

  const performanceUnits = units.filter((unit) => unit.enabled && PERFORMANCE_IU_IDS.has(unit.id));
  const allDecisions = [...baseReport.decisions, ...publicAudit.decisions];
  const resolvedInput = await resolveInputForCompetitorStrategy({
    companyId,
    reportCategory: 'performance',
    resolvedInput: options?.resolvedInput ?? null,
  });
  const competitivePressure = buildCompetitivePressureSafely({
    decisions: allDecisions,
    resolvedInput,
  }).pressure;
  const grouped = mapDecisionsToPerformanceGroups(
    allDecisions,
    performanceUnits,
  );

  const sections: PerformanceReportSection[] = PERFORMANCE_SECTION_DEFINITIONS.map((section) => {
    const sectionDecisions = section.IU_ids
      .flatMap((iuId) => grouped.get(iuId) ?? [])
      .sort(rankByImpactConfidence);

    const insights = sectionDecisions
      .slice(0, 7)
      .map(toInsight);

    const opportunities = sectionDecisions
      .filter(isOpportunitySignal)
      .slice(0, 5)
      .map(toOpportunity);

    const actions = sectionDecisions
      .slice(0, 5)
      .map(toAction);

    return {
      section_name: section.section_name,
      IU_ids: [...section.IU_ids],
      insights,
      opportunities,
      actions,
    };
  });

  return {
    report_type: 'performance',
    score: {
      available: true,
      value: null,
      label: null,
    },
    competitive_pressure_analysis: competitivePressure,
    sections,
  };
}

// =============================================================================
// Report 2 — Behavior + Funnel Intelligence
//
// Data-layer aggregation of the six behaviorAnalyticsService queries into a
// single structured JSON, gated on analytics readiness. Does NOT touch the
// sections-based `composeReport` above or the snapshot report pipeline.
// =============================================================================

export interface BehaviorReportData {
  traffic_sources: TrafficSourceRow[];
  top_pages:       TopPageRow[];
  session_metrics: SessionMetrics;
  drop_off_pages:  DropOffPageRow[];
  funnel:          FunnelResult;
  conversions:     ConversionSummary;
  insights:        BehaviorInsight[];
  recommendations: BehaviorRecommendation[];
  analytics_provenance: {
    source: 'ga_canonical_ingestion' | 'upload_manual_entry' | 'fallback_no_analytics';
    readiness_status: string;
    last_successful_ingestion_at: string | null;
    events_last_30_days: number;
    confidence: 'none' | 'low' | 'medium' | 'high';
  };
}

export type BehaviorReportResponse =
  | {
      status: 'no_data' | 'low_data';
      message: string;
      readiness: {
        status: string;
        reason: string;
        last_successful_ingestion_at: string | null;
        events_last_30_days: number;
        confidence: 'none' | 'low' | 'medium' | 'high';
      };
      analytics_provenance: BehaviorReportData['analytics_provenance'];
    }
  | ({ status: 'partial'; generated_at: string; window_days: number; warnings: string[] } & BehaviorReportData)
  | ({ status: 'ready'; generated_at: string; window_days: number; warnings: string[] } & BehaviorReportData);

export type PerformanceIntelligenceReportResponse =
  | {
      report_type: 'performance_intelligence';
      status: 'no_data' | 'low_data';
      message: string;
      readiness: {
        status: string;
        reason: string;
        last_successful_ingestion_at: string | null;
        events_last_30_days: number;
        confidence: 'none' | 'low' | 'medium' | 'high';
      };
      analytics_provenance: BehaviorReportData['analytics_provenance'];
      provider_readiness?: Awaited<ReturnType<typeof getGoogleProviderReadiness>>;
      analytics_health?: AnalyticsHealthSummary;
      enterprise_snapshot?: AnalyticsEnterpriseSnapshot;
      stage_timings_ms?: Record<string, number>;
      concurrency?: ReportConcurrencyMetadata;
      html: string;
    }
  | {
      report_type: 'performance_intelligence';
      status: 'ready' | 'partial';
      generated_at: string;
      window_days: number;
      warnings: string[];
      sections: typeof performanceSections;
      competitive_pressure_analysis: CompetitivePressureAnalysis | null;
      mapped_data: PerformanceReportMappedData;
      html: string;
      provider_readiness?: Awaited<ReturnType<typeof getGoogleProviderReadiness>>;
      analytics_health?: AnalyticsHealthSummary;
      enterprise_snapshot?: AnalyticsEnterpriseSnapshot;
      stage_timings_ms?: Record<string, number>;
      concurrency?: ReportConcurrencyMetadata;
      source_data: BehaviorReportData;
      snapshot_foundation?: PerformanceSnapshotFoundation | null;
      search_intelligence?: PerformanceSearchIntelligence;
      behavior_intelligence?: PerformanceBehaviorIntelligence;
      shared_intelligence_primitives?: SharedIntelligencePrimitive[];
      creator_compatibility?: CreatorCompatibilityAssessment[];
      real_user_review_evaluation?: PerformanceReportEvaluation;
    };

type ReadyBehaviorReportResponse = Extract<BehaviorReportResponse, { status: 'ready' | 'partial' }>;

function isReadyBehaviorReportResponse(value: BehaviorReportResponse): value is ReadyBehaviorReportResponse {
  return value.status === 'ready' || value.status === 'partial';
}

function elapsedSince(start: number): number {
  return Math.round(performance.now() - start);
}

function escapePerformanceText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEnterpriseMarketIntelligence(snapshot: AnalyticsEnterpriseSnapshot | null): string {
  if (!snapshot) return '';
  const external = snapshot.external_competitive_intelligence;
  const authority = snapshot.authority_market_position;
  const leadGen = snapshot.lead_generation_authority_intelligence;
  const unifiedCompetitors = snapshot.unified_competitor_intelligence.competitors.slice(0, 3);
  const competitorOpportunities = snapshot.unified_competitor_intelligence.opportunities.slice(0, 3);
  const recommendations = snapshot.recommendation_intelligence.recommendations.slice(0, 3);
  const signals = [
    ...external.signals.slice(0, 3).map((signal) => ({
      title: signal.title,
      meta: `${signal.provenance}; confidence ${signal.confidence}; score ${signal.score}`,
    })),
    ...leadGen.signals.slice(0, 3).map((signal) => ({
      title: signal.title,
      meta: `${signal.type}; confidence ${signal.confidence}; priority ${signal.priority_score}`,
    })),
    ...unifiedCompetitors.map((competitor) => ({
      title: `${competitor.name} competitor benchmark`,
      meta: `priority ${competitor.scores.strategic_priority}; threat ${competitor.scores.discoverability_threat}; ${competitor.confidence} confidence`,
    })),
    ...competitorOpportunities.map((opportunity) => ({
      title: opportunity.title,
      meta: `${opportunity.type}; priority ${opportunity.priority_score}; ${opportunity.confidence} confidence`,
    })),
  ];

  if (!signals.length && !recommendations.length && external.status !== 'ready') {
    return `
      <section class="perf-section">
        <h2>Enterprise Market Intelligence</h2>
        <p class="perf-section-subtitle">${escapePerformanceText(external.summary)}</p>
        <div class="perf-empty">External SERP evidence is not populated yet. Performance recommendations remain limited to canonical GA/GSC evidence.</div>
      </section>
    `;
  }

  return `
    <section class="perf-section">
      <h2>Enterprise Market Intelligence</h2>
      <p class="perf-section-subtitle">
        Authority score ${escapePerformanceText(authority.domain_authority_trajectory_score)}; market position ${escapePerformanceText(authority.market_position_score)}; visibility moat ${escapePerformanceText(authority.visibility_moat)}.
      </p>
      <div class="perf-list">
        ${signals.map((signal) => `
          <div class="perf-list-item">
            <strong>${escapePerformanceText(signal.title)}</strong>
            <div class="perf-list-meta">${escapePerformanceText(signal.meta)}</div>
          </div>
        `).join('')}
        ${recommendations.map((rec) => `
          <div class="perf-list-item">
            <strong>${escapePerformanceText(rec.title)}</strong>
            <div class="perf-list-meta">${escapePerformanceText(rec.business_impact)}; ${escapePerformanceText(rec.strategic_urgency)} urgency; ${escapePerformanceText(rec.confidence)} confidence</div>
            <p class="perf-card-note">${escapePerformanceText(rec.action)}</p>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

/**
 * Report 2 failure-path instrumentation.
 *
 * `composePerformanceIntelligenceReport` races composition against a 45s liveness boundary in
 * `runDedupedReport`. When that boundary fires, the composition's local `stageTimings` object dies
 * with the rejected promise, so `stage_timings_ms` — which is only attached to the SUCCESS and
 * early-return payloads — is never emitted. The result is that a production timeout tells us the
 * report took longer than 45s and nothing about WHERE the time went.
 *
 * The trace below is written by the stage wrappers themselves rather than assembled on the success
 * path, so it survives the rejection. It is a diagnostic projection of the SAME measurements the
 * existing `stageTimings` record already takes — not a second timing system, and not a change to
 * any stage's execution, ordering, timeout or result.
 *
 * A stage still in flight when the boundary fires is reported as `running`, never as completed:
 * an unfinished stage must not read as a successful one. Stages that settle after the boundary
 * emit their own late line, so work that outlives the request stays visible.
 */
type StageStatus = 'running' | 'completed' | 'timed_out' | 'failed';

type StageRecord = {
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: StageStatus;
  error?: string;
};

export type PerformanceStageTrace = Record<string, StageRecord>;

/** Open a stage. Returns a closer that records the outcome exactly once. */
function beginStage(trace: PerformanceStageTrace | undefined, label: string) {
  const startedAtMs = performance.now();
  if (trace) {
    trace[label] = {
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      status: 'running',
    };
  }
  let settled = false;
  return (status: Exclude<StageStatus, 'running'>, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (!trace || !trace[label]) return;
    trace[label] = {
      ...trace[label],
      completed_at: new Date().toISOString(),
      duration_ms: elapsedSince(startedAtMs),
      status,
      ...(error === undefined ? {} : { error: classifyStageError(error) }),
    };
  };
}

/** Error shape only — never the message body, which can carry customer content. */
function classifyStageError(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
}

/** Exported so the failure-path instrumentation contract can be tested directly. */
export async function withReportTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs: number,
  trace?: PerformanceStageTrace,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const closeStage = beginStage(trace, label);
  let timedOut = false;
  // The underlying work is NOT cancelled here (unchanged behaviour). When it settles after the
  // stage timeout, say so rather than leaving the trace claiming it was still running.
  promise.then(
    () => { if (timedOut) console.warn('[performance-report][stage-late-settle]', { stage: label, outcome: 'completed_after_stage_timeout' }); },
    (error) => {
      if (timedOut) console.warn('[performance-report][stage-late-settle]', { stage: label, outcome: 'failed_after_stage_timeout', error: classifyStageError(error) });
      else closeStage('failed', error);
    },
  );
  try {
    const result = await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          console.warn('[performance-report][stage-timeout]', { stage: label, timeout_ms: timeoutMs });
          closeStage('timed_out');
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    closeStage('completed');
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GAP-14 — Report 2 reads the PERSISTED Report 1 baseline.
 *
 * `buildSnapshotFoundationForPerformance` used to call `composeSnapshotReport()` live, which
 * recomputed the whole of Report 1 — crawl, SERP and LLM acquisition included — every time a
 * performance report was built. The baseline it produced was also a different object from the
 * Report 1 the customer had actually been shown, so the two reports could disagree.
 *
 * Selection: the most recent COMPLETED report for the company whose stored `composed_report`
 * carries `canonical` — the Report 1 signature. Filtering on the shape rather than hard-coding a
 * `report_type` string keeps this correct if the monetization mapping renames the type, and
 * performance reports (composed by `composePerformanceIntelligenceReport`) do not carry it.
 * No new status value is invented: `completed` is the existing `ReportStatus`.
 *
 * When there is no completed Report 1, this returns null and the existing empty-baseline state
 * renders. It NEVER falls back to recomposing Report 1.
 */
const BASELINE_CANDIDATE_LIMIT = 20;

type PersistedSnapshotBaseline = {
  reportId: string;
  createdAt: string | null;
  composed: Record<string, unknown>;
};

async function loadLatestCompletedSnapshotBaseline(
  companyId: string,
): Promise<PersistedSnapshotBaseline | null> {
  const { data, error } = await ownedDbTable('reports')
    .select('id, created_at, data')
    .eq('company_id', companyId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(BASELINE_CANDIDATE_LIMIT);

  if (error || !Array.isArray(data)) return null;

  for (const row of data as Array<{ id: string; created_at: string | null; data?: unknown }>) {
    const composed = (row.data as { composed_report?: unknown } | null | undefined)?.composed_report;
    if (composed && typeof composed === 'object' && 'canonical' in (composed as object)) {
      return { reportId: row.id, createdAt: row.created_at ?? null, composed: composed as Record<string, unknown> };
    }
  }
  return null;
}

/**
 * `digital_snapshot.topPriorities` is the canonical priority source
 * (`SnapshotReport.top_priorities` is marked deprecated in LEGACY_ELIMINATION_TRACKING).
 * A present `digital_snapshot.topPriorities` always wins; the legacy array is read ONLY for
 * baselines persisted before that field existed, and never overrides it.
 *
 * `CrossSourceOpportunity.confidence` is a three-level ordinal and the foundation field is
 * numeric, so the levels are rendered on a coarse 30/60/90 scale. That is an ordinal rendering,
 * not a measured percentage — no finer precision is implied or available.
 */
const ORDINAL_CONFIDENCE: Record<string, number> = { high: 90, medium: 60, low: 30 };

function baselineTopPriorities(composed: Record<string, unknown>): PerformanceSnapshotFoundation['top_priorities'] {
  const digital = composed.digital_snapshot as { topPriorities?: unknown } | null | undefined;
  const canonicalPriorities = Array.isArray(digital?.topPriorities) ? digital!.topPriorities : null;

  if (canonicalPriorities && canonicalPriorities.length > 0) {
    return canonicalPriorities.slice(0, 3).map((raw) => {
      const item = raw as {
        title?: string; problem?: string; businessImplication?: string;
        expectedImpact?: string; confidence?: string;
      };
      return {
        title: item.title || 'Priority action',
        why_now: item.problem || item.businessImplication || 'This action came from the Digital Snapshot foundation.',
        impact: item.expectedImpact || 'Authority and conversion readiness',
        confidence: ORDINAL_CONFIDENCE[String(item.confidence)] ?? 0,
      };
    });
  }

  // Legacy compatibility: baselines that predate `digital_snapshot.topPriorities`.
  const legacy = composed.top_priorities;
  if (!Array.isArray(legacy)) return [];
  return legacy.slice(0, 3).map((raw) => {
    const item = raw as {
      title?: string; why_now?: string; expected_outcome?: string; impact?: string;
      expected_upside?: string; confidence_score?: number; impact_score?: number;
    };
    return {
      title: item.title || 'Priority action',
      why_now: item.why_now || item.expected_outcome || 'This action came from the Digital Snapshot foundation.',
      impact: item.impact || item.expected_upside || 'Authority and conversion readiness',
      confidence: (() => {
        const value = Number(item.confidence_score ?? item.impact_score ?? 0);
        return value > 0 && value <= 1 ? value * 100 : value;
      })(),
    };
  });
}

/** Exported so the GAP-14 baseline-read contract can be tested directly. */
export async function buildSnapshotFoundationForPerformance(params: {
  companyId: string;
  resolvedInput?: ResolvedReportInput | null;
}): Promise<PerformanceSnapshotFoundation | null> {
  try {
    const baseline = await loadLatestCompletedSnapshotBaseline(params.companyId);
    if (!baseline) {
      console.warn('[performance-report][snapshot-foundation-absent]', {
        company_id: params.companyId,
        reason: 'no completed Digital Snapshot is persisted for this company',
      });
      return null;
    }
    // `composed_report` IS the stored composed snapshot, so it has the same shape the live call
    // returned and every downstream read below is unchanged.
    const snapshot = baseline.composed as unknown as SnapshotReport;
    const canonical = snapshot.canonical;
    const overview = canonical?.authority_overview;
    const executive = canonical?.executive_insights;

    // GAP-04 — a score may only become numeric authority if its own state says it was measured.
    //
    // This read was `overview?.overall_score?.value ?? snapshot.score?.value ?? null`. Two ways it
    // let unmeasured evidence across the report boundary as fact:
    //
    //   1. The canonical score could itself be `{ value: 10, state: 'insufficient_signal' }`.
    //      That is fixed at the constructor now, so the value arrives null.
    //   2. `??` then falls through to the LEGACY score. Nulling the canonical value therefore
    //      does not close the hole on its own — it opens the fallback. The legacy model happens
    //      to null its own value when insufficient, but relying on that coincidence is exactly
    //      the kind of unstated coupling this defect was made of.
    //
    // Both sources are now gated on their own state before they can be read, so an unmeasured
    // Report 1 hands Report 2 a null baseline instead of a number. `inferred` still qualifies:
    // it is a labelled, evidence-backed reading, and demoting it here would silently blank the
    // baseline for most real companies — a scoring change, not an integrity fix.
    const isUsable = (score: { value?: number | null; state?: string } | null | undefined): boolean =>
      Boolean(score) && typeof score!.value === 'number'
        && score!.state !== 'insufficient_signal' && score!.state !== 'unavailable';

    // Resolve the winning source ONCE, then read its score and its label from that same source —
    // so a band can never describe a number the other source produced.
    const legacyScore = snapshot.score as { value?: number | null; state?: string; label?: string } | undefined;
    const authority: { value: number; band: string } | null =
      isUsable(overview?.overall_score)
        ? { value: overview!.overall_score.value as number, band: overview!.overall_score.band }
        : isUsable(legacyScore)
          ? { value: legacyScore!.value as number, band: legacyScore!.label ?? 'insufficient' }
          : null;

    return {
      authority_score: authority?.value ?? null,
      authority_band: authority?.band ?? 'insufficient',
      maturity_label: canonical?.maturity_stage?.label ?? String(snapshot.system_maturity ?? 'Baseline forming'),
      headline:
        executive?.headline_thesis?.text ||
        snapshot.decision_snapshot?.primary_focus_area ||
        snapshot.summary ||
        'Authority baseline is available as the foundation for this performance read.',
      primary_constraint:
        executive?.primary_constraint?.text ||
        snapshot.decision_snapshot?.whats_broken ||
        snapshot.primary_problem ||
        'Primary authority constraint is still being classified.',
      market_position: snapshot.company_context?.market_position_statement ?? snapshot.company_context?.market_position ?? null,
      positioning: snapshot.company_context?.positioning ?? snapshot.company_context?.positioning_narrative ?? null,
      top_priorities: baselineTopPriorities(baseline.composed),
      pillar_scores: Object.values(canonical?.pillars ?? {}).slice(0, 5).map((pillar) => ({
        label: pillar.label,
        value: pillar.score.value,
        band: pillar.score.band,
        primary_signal: pillar.primary_signal,
      })),
    };
  } catch (error) {
    console.warn('[performance-report][snapshot-foundation-failed]', {
      company_id: params.companyId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Build the Behavior + Funnel Intelligence report for a company.
 *
 * Gating: calls getAnalyticsReadiness(companyId) first. If not ready, returns
 * { status: 'not_ready', reason } without running any behavior queries.
 *
 * Window: default 30 days, overridable via opts.sinceDays. All six underlying
 * queries use the same window so their counts are directly comparable.
 */
export async function composeBehaviorReport(
  companyId: string,
  opts?: BehaviorQueryOpts,
): Promise<BehaviorReportResponse> {
  const readiness = await getAnalyticsReadiness(companyId);
  if (!readiness.ready && readiness.events_last_30_days === 0) {
    return {
      status: 'no_data',
      message: readiness.status === 'sync_in_progress'
        ? 'Google Analytics sync is still in progress'
        : 'No analytics data available',
      readiness,
      analytics_provenance: {
        source: 'fallback_no_analytics',
        readiness_status: readiness.status,
        last_successful_ingestion_at: readiness.last_successful_ingestion_at,
        events_last_30_days: readiness.events_last_30_days,
        confidence: readiness.confidence,
      },
    };
  }

  const [trafficSources, topPages, sessionMetrics, dropOffPages, funnel, conversions] = await Promise.all([
    getTrafficSources(companyId, opts),
    getTopPages(companyId, opts),
    getSessionMetrics(companyId, opts),
    getDropOffPages(companyId, opts),
    getBasicFunnel(companyId, opts),
    getConversionSummary(companyId, opts),
  ]);
  const warnings: string[] = [];
  if (!readiness.ready) {
    warnings.push(`Analytics confidence is limited: ${readiness.reason}.`);
  }
  if (funnel.inferred_entry) {
    warnings.push('Funnel entry inferred from first event per session because session_start was missing.');
  }
  if (trafficSources.length === 0) warnings.push('Traffic source breakdown is empty.');
  if (topPages.length === 0) warnings.push('Top pages section is empty.');
  if (dropOffPages.length === 0) warnings.push('Drop-off page section is empty.');
  if (conversions.total_conversions === 0) warnings.push('No conversions found in the reporting window.');

  const insights = generateBehaviorInsights({
    traffic_sources: trafficSources,
    top_pages: topPages,
    drop_off_pages: dropOffPages,
    funnel,
    conversions,
  });
  const reportData: BehaviorRecommendationReportData = {
    traffic_sources: trafficSources,
    top_pages: topPages,
    drop_off_pages: dropOffPages,
    funnel,
    conversions,
    session_metrics: sessionMetrics,
  };
  const recommendations = generateBehaviorRecommendations(insights, reportData);

  return {
    status: readiness.ready && warnings.length === 0 ? 'ready' : 'partial',
    generated_at: new Date().toISOString(),
    window_days: opts?.sinceDays ?? 30,
    warnings,
    traffic_sources: trafficSources,
    top_pages: topPages,
    session_metrics: sessionMetrics,
    drop_off_pages: dropOffPages,
    funnel,
    conversions,
    insights,
    recommendations,
    analytics_provenance: {
      source: readiness.last_successful_ingestion_at ? 'ga_canonical_ingestion' : 'fallback_no_analytics',
      readiness_status: readiness.status,
      last_successful_ingestion_at: readiness.last_successful_ingestion_at,
      events_last_30_days: readiness.events_last_30_days,
      confidence: readiness.confidence,
    },
  };
}

export function renderPerformanceReport(
  data: PerformanceReportMappedData,
  meta?: PerformanceRenderMeta,
): string {
  const renderedSections = performanceSections
    .map((sectionKey) => performanceRendererMap[sectionKey](data))
    .join('');

  return renderPerformanceDocument(renderedSections, meta);
}

async function composePerformanceIntelligenceReportInternal(
  companyId: string,
  opts?: PerformanceIntelligenceOptions,
  trace?: PerformanceStageTrace,
): Promise<PerformanceIntelligenceReportResponse> {
  const reportStarted = performance.now();
  const stageTimings: Record<string, number> = {};
  const baseStarted = performance.now();
  // `composeBehaviorReport` carries no timeout wrapper, so it is opened and closed explicitly —
  // an unbounded stage is exactly the one a timeout trace must be able to show as `running`.
  const closeBehaviorReport = beginStage(trace, 'behavior_report');
  const base = await composeBehaviorReport(companyId, opts).then(
    (value) => { closeBehaviorReport('completed'); return value; },
    (error) => { closeBehaviorReport('failed', error); throw error; },
  );
  stageTimings.behavior_report = elapsedSince(baseStarted);

  const closeProviderStage = beginStage(trace, 'provider_and_snapshot');
  const providerStarted = performance.now();
  const [providerReadiness, enterpriseSnapshot] = await Promise.all([
    getGoogleProviderReadiness(companyId).catch(() => null),
    getAnalyticsEnterpriseSnapshot(companyId).catch((error) => {
      console.warn('[performance-report][enterprise-snapshot-failed]', {
        company_id: companyId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }),
  ]);
  stageTimings.provider_and_snapshot = elapsedSince(providerStarted);
  closeProviderStage('completed');
  const analyticsHealth: AnalyticsHealthSummary | null = enterpriseSnapshot ? {
    company_id: companyId,
    generated_at: enterpriseSnapshot.generated_at,
    freshness: enterpriseSnapshot.freshness,
    health: {
      status: enterpriseSnapshot.governance.trust_score >= 70 ? 'healthy' : enterpriseSnapshot.governance.trust_score >= 40 ? 'degraded' : 'failed',
      message: 'Analytics health derived from enterprise GA/GSC intelligence snapshot.',
      confidence: enterpriseSnapshot.governance.trust_score >= 70 ? 'high' : enterpriseSnapshot.governance.trust_score >= 40 ? 'medium' : 'low',
    },
    ingestion_history: [],
    degraded_history: [],
    operational_metrics: {
      ga_events_last_30_days: base.analytics_provenance.events_last_30_days,
      gsc_rows_ingested: 0,
      total_retries_last_10_runs: enterpriseSnapshot.observability.ingestion_history.reduce((sum, run) => sum + run.retry_count, 0),
      avg_duration_ms_last_10_runs: null,
      quota_or_api_errors: enterpriseSnapshot.observability.quota_warnings,
    },
    correlation: enterpriseSnapshot.correlation,
    gsc_intelligence: enterpriseSnapshot.gsc_intelligence,
    enterprise: {
      cache_status: enterpriseSnapshot.cache_status,
      trust_score: enterpriseSnapshot.governance.trust_score,
      completeness_score: enterpriseSnapshot.governance.completeness_score,
      opportunity_count: enterpriseSnapshot.opportunities.length,
      provider_uptime: enterpriseSnapshot.observability.provider_uptime,
      quota_warnings: enterpriseSnapshot.observability.quota_warnings,
    },
  } : await withReportTimeout('analytics_health', getAnalyticsHealthSummary(companyId), 8000, trace);

  if (base.status === 'no_data' || base.status === 'low_data') {
    return {
      report_type: 'performance_intelligence',
      status: base.status,
      message: base.message,
      readiness: base.readiness,
      analytics_provenance: base.analytics_provenance,
      provider_readiness: providerReadiness ?? undefined,
      analytics_health: analyticsHealth ?? undefined,
      enterprise_snapshot: enterpriseSnapshot ?? undefined,
      stage_timings_ms: { ...stageTimings, total: elapsedSince(reportStarted) },
      html: renderPerformanceStateDocument({
        status: base.status,
        message: base.message,
      }),
    };
  }

  if (!isReadyBehaviorReportResponse(base)) {
    throw new Error('Unexpected behavior report status');
  }

  const reportData: ReadyBehaviorReportResponse = base;
  const intelligenceStarted = performance.now();
  const [searchIntelligence, behaviorIntelligence, resolvedInput] = await Promise.all([
    withReportTimeout('search_intelligence', buildPerformanceSearchIntelligence({
      companyId,
      behaviorData: reportData,
      windowDays: reportData.window_days,
    }).catch((error) => {
      console.warn('[performance-report][search-intelligence-failed]', {
        company_id: companyId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }), 15000, trace),
    withReportTimeout('behavior_intelligence', buildPerformanceBehaviorIntelligence({
      companyId,
      currentData: reportData,
      windowDays: reportData.window_days,
    }).catch((error) => {
      console.warn('[performance-report][behavior-intelligence-failed]', {
        company_id: companyId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }), 15000, trace),
    opts?.resolvedInput
      ? Promise.resolve(opts.resolvedInput)
      : withReportTimeout('resolve_competitor_input', resolveInputForCompetitorStrategy({
        companyId,
        reportCategory: 'performance',
        resolvedInput: null,
      }).catch((error) => {
        console.warn('[performance-report][input-resolution-failed]', {
          company_id: companyId,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }), 12000, trace),
  ]);
  stageTimings.parallel_intelligence = elapsedSince(intelligenceStarted);
  const sharedPrimitives = buildSharedPerformanceIntelligencePrimitives({
    behavior: behaviorIntelligence,
    search: searchIntelligence,
  });
  // Pre-drill calibration: condense provider warnings. The trio of "GSC
  // disconnected" / "Search intelligence: limited" / "Search Console
  // unavailable" used to fire together. Suppress the secondary "Search
  // intelligence" line when GSC is already flagged so the warnings panel
  // doesn't repeat the same root cause.
  const providerWarningsRaw = [
    ...(providerReadiness?.google_analytics?.connected ? [] : [`Google Analytics: ${providerReadiness?.google_analytics?.message ?? 'availability could not be verified'}`]),
    ...(providerReadiness?.google_search_console?.connected ? [] : [`Google Search Console: ${providerReadiness?.google_search_console?.message ?? 'availability could not be verified'}`]),
    ...(searchIntelligence && !searchIntelligence.readiness.ready ? [`Search intelligence: ${searchIntelligence.readiness.reason}`] : []),
  ];
  const gscDisconnected = !providerReadiness?.google_search_console?.connected;
  const providerWarnings = gscDisconnected
    ? providerWarningsRaw.filter((w) => !/^Search intelligence:/.test(w))
    : providerWarningsRaw;
  const freshnessWarnings = analyticsHealth
    ? [analyticsHealth.freshness.ga, analyticsHealth.freshness.gsc]
        .filter((snapshot) => ['aging', 'stale', 'failed', 'unavailable'].includes(snapshot.classification))
        .map((snapshot) => `${snapshot.source.toUpperCase()} freshness is ${snapshot.classification}: ${snapshot.reason}`)
    : [];
  const snapshotStarted = performance.now();
  const shouldBuildSnapshotFoundation = process.env.PERFORMANCE_REPORT_SYNC_SNAPSHOT_FOUNDATION === 'true';
  const snapshotFoundation = resolvedInput && shouldBuildSnapshotFoundation
    ? await withReportTimeout('snapshot_foundation', buildSnapshotFoundationForPerformance({
      companyId,
      resolvedInput,
    }), 7000, trace)
    : null;
  stageTimings.snapshot_foundation = elapsedSince(snapshotStarted);
  const competitivePressure = buildCompetitivePressureSafely({
    decisions: [],
    resolvedInput,
  }).pressure;
  const mappedData = mapPerformanceReportData(reportData, {
    competitivePressureAnalysis: competitivePressure,
    searchIntelligence,
    behaviorIntelligence,
    snapshotFoundation,
  });

  const lazyWarnings = resolvedInput && !shouldBuildSnapshotFoundation
    ? ['Snapshot foundation enrichment was deferred to preserve report runtime; analytics-derived sections remain canonical.']
    : [];
  const warnings = uniqueReportWarnings([...reportData.warnings, ...providerWarnings, ...freshnessWarnings, ...lazyWarnings]);
  const response: PerformanceIntelligenceReportResponse = {
    report_type: 'performance_intelligence',
    status: reportData.status,
    generated_at: reportData.generated_at,
    window_days: reportData.window_days,
    warnings,
    sections: performanceSections,
    competitive_pressure_analysis: competitivePressure,
    mapped_data: mappedData,
    html: renderPerformanceDocument(
      [
        performanceSections.map((sectionKey) => performanceRendererMap[sectionKey](mappedData)).join(''),
        renderEnterpriseMarketIntelligence(enterpriseSnapshot),
      ].join(''),
      {
        companyName: resolvedInput?.resolved.companyName ?? resolvedInput?.profile?.name ?? null,
        dateRangeLabel: `Last ${reportData.window_days} days`,
        warning: reportData.status === 'partial' || warnings.length > 0
          ? 'Some sections are incomplete or still syncing. Treat low-confidence findings as directional.'
          : null,
      },
    ),
    provider_readiness: providerReadiness ?? undefined,
    analytics_health: analyticsHealth ?? undefined,
    enterprise_snapshot: enterpriseSnapshot ?? undefined,
    stage_timings_ms: { ...stageTimings, total: elapsedSince(reportStarted) },
    source_data: reportData,
    snapshot_foundation: snapshotFoundation,
    search_intelligence: searchIntelligence ?? undefined,
    behavior_intelligence: behaviorIntelligence ?? undefined,
    shared_intelligence_primitives: sharedPrimitives,
    creator_compatibility: getCreatorIntelligenceCompatibility(),
  };
  return {
    ...response,
    real_user_review_evaluation: evaluatePerformanceReportForRealUserReview(response),
  };
}

export async function composePerformanceIntelligenceReport(
  companyId: string,
  opts?: PerformanceIntelligenceOptions,
): Promise<PerformanceIntelligenceReportResponse> {
  const resolvedKey = opts?.resolvedInput
    ? `${opts.resolvedInput.resolved.companyName ?? opts.resolvedInput.profile?.name ?? 'resolved'}`
    : 'auto';
  // Failure-path instrumentation: the trace lives OUTSIDE the raced promise, so when the boundary
  // below rejects it is still readable. Emitting is synchronous logging only — it adds no await and
  // therefore cannot extend the request past the existing boundary. The failure is re-thrown
  // unchanged: this records what happened, it does not handle it.
  const trace: PerformanceStageTrace = {};
  const startedAt = performance.now();
  try {
    const { result, metadata } = await runDedupedReport({
      key: `performance:${companyId}:${resolvedKey}`,
      timeoutMs: 45_000,
      run: () => composePerformanceIntelligenceReportInternal(companyId, opts, trace),
    });
    return {
      ...result,
      concurrency: metadata,
    } as PerformanceIntelligenceReportResponse;
  } catch (error) {
    console.warn('[performance-report][composition-failed]', {
      company_id: companyId,
      elapsed_ms: elapsedSince(startedAt),
      error: classifyStageError(error),
      // Stages left `running` were still in flight when composition failed — they are NOT
      // completed, and the unaccounted remainder of elapsed_ms belongs to them or to work that
      // never opened a stage at all.
      stages_still_running: Object.entries(trace).filter(([, s]) => s.status === 'running').map(([k]) => k),
      stage_trace: trace,
    });
    throw error;
  }
}
