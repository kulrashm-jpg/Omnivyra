import { composeReport } from './reportComposerService';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
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
  type PerformanceReportMappedData,
} from './performanceReportMapper';

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
        reason: string;
        last_successful_ingestion_at: string | null;
        events_last_30_days: number;
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
        reason: string;
        last_successful_ingestion_at: string | null;
        events_last_30_days: number;
      };
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
      source_data: BehaviorReportData;
    };

type ReadyBehaviorReportResponse = Extract<BehaviorReportResponse, { status: 'ready' | 'partial' }>;

function isReadyBehaviorReportResponse(value: BehaviorReportResponse): value is ReadyBehaviorReportResponse {
  return value.status === 'ready' || value.status === 'partial';
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
  if (!readiness.ready) {
    return {
      status: readiness.events_last_30_days === 0 ? 'no_data' : 'low_data',
      message: readiness.events_last_30_days === 0 ? 'No analytics data available' : 'Not enough data yet',
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
    status: warnings.length > 0 ? 'partial' : 'ready',
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

  if (base.status === 'no_data' || base.status === 'low_data') {
    return {
      report_type: 'performance_intelligence',
      status: base.status,
      message: base.message,
      readiness: base.readiness,
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
  const resolvedInput = await resolveInputForCompetitorStrategy({
    companyId,
    reportCategory: 'performance',
    resolvedInput: opts?.resolvedInput ?? null,
  });
  const competitivePressure = buildCompetitivePressureSafely({
    decisions: [],
    resolvedInput,
  }).pressure;
  const mappedData = mapPerformanceReportData(reportData, {
    competitivePressureAnalysis: competitivePressure,
  });

  return {
    report_type: 'performance_intelligence',
    status: reportData.status,
    generated_at: reportData.generated_at,
    window_days: reportData.window_days,
    warnings: reportData.warnings,
    sections: performanceSections,
    competitive_pressure_analysis: competitivePressure,
    mapped_data: mappedData,
    html: renderPerformanceDocument(
      performanceSections.map((sectionKey) => performanceRendererMap[sectionKey](mappedData)).join(''),
      {
        dateRangeLabel: `Last ${reportData.window_days} days`,
        warning: reportData.status === 'partial'
          ? 'Some sections are incomplete. Review the warnings before acting on this report.'
          : null,
      },
    ),
    source_data: reportData,
  };
}
