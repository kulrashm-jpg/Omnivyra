import { composeReport } from './reportComposerService';
import { supabase } from '../db/supabaseClient';
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
      provider_readiness?: Awaited<ReturnType<typeof getGoogleProviderReadiness>>;
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

async function buildSnapshotFoundationForPerformance(params: {
  companyId: string;
  resolvedInput?: ResolvedReportInput | null;
}): Promise<PerformanceSnapshotFoundation | null> {
  try {
    const { composeSnapshotReport } = await import('./snapshotReportService');
    const snapshot = await composeSnapshotReport(params.companyId, {
      resolvedInput: params.resolvedInput ?? null,
      readiness: null,
    });
    const canonical = snapshot.canonical;
    const overview = canonical?.authority_overview;
    const executive = canonical?.executive_insights;

    return {
      authority_score: overview?.overall_score?.value ?? snapshot.score?.value ?? null,
      authority_band: overview?.overall_score?.band ?? snapshot.score?.label ?? 'insufficient',
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
      top_priorities: (snapshot.top_priorities ?? []).slice(0, 3).map((item) => ({
        title: item.title || 'Priority action',
        why_now: item.why_now || item.expected_outcome || 'This action came from the Digital Snapshot foundation.',
        impact: item.impact || item.expected_upside || 'Authority and conversion readiness',
        confidence: (() => {
          const value = Number(item.confidence_score ?? item.impact_score ?? 0);
          return value > 0 && value <= 1 ? value * 100 : value;
        })(),
      })),
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

export async function composePerformanceIntelligenceReport(
  companyId: string,
  opts?: PerformanceIntelligenceOptions,
): Promise<PerformanceIntelligenceReportResponse> {
  const base = await composeBehaviorReport(companyId, opts);
  const providerReadiness = await getGoogleProviderReadiness(companyId).catch(() => null);

  if (base.status === 'no_data' || base.status === 'low_data') {
    return {
      report_type: 'performance_intelligence',
      status: base.status,
      message: base.message,
      readiness: base.readiness,
      provider_readiness: providerReadiness ?? undefined,
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
  const searchIntelligence = await buildPerformanceSearchIntelligence({
    companyId,
    behaviorData: reportData,
    windowDays: reportData.window_days,
  }).catch((error) => {
    console.warn('[performance-report][search-intelligence-failed]', {
      company_id: companyId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  const behaviorIntelligence = await buildPerformanceBehaviorIntelligence({
    companyId,
    currentData: reportData,
    windowDays: reportData.window_days,
  }).catch((error) => {
    console.warn('[performance-report][behavior-intelligence-failed]', {
      company_id: companyId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
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
  const resolvedInput = await resolveInputForCompetitorStrategy({
    companyId,
    reportCategory: 'performance',
    resolvedInput: opts?.resolvedInput ?? null,
  });
  const snapshotFoundation = await buildSnapshotFoundationForPerformance({
    companyId,
    resolvedInput,
  });
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

  const warnings = uniqueReportWarnings([...reportData.warnings, ...providerWarnings]);
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
      performanceSections.map((sectionKey) => performanceRendererMap[sectionKey](mappedData)).join(''),
      {
        companyName: resolvedInput?.resolved.companyName ?? resolvedInput?.profile?.name ?? null,
        dateRangeLabel: `Last ${reportData.window_days} days`,
        warning: reportData.status === 'partial' || warnings.length > 0
          ? 'Some sections are incomplete or still syncing. Treat low-confidence findings as directional.'
          : null,
      },
    ),
    provider_readiness: providerReadiness ?? undefined,
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
