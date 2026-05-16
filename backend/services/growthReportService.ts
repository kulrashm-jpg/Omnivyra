import { composeReport } from './reportComposerService';
import {
  listCompanyIntelligenceUnits,
  mapDecisionToIntelligenceUnit,
  type IntelligenceUnitWithConfig,
} from './intelligenceUnitService';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { ResolvedReportInput } from './reportInputResolver';
import { resolveAnalyticsReportInput } from './analyticsInputResolver';
import { buildCompetitorIntelligence } from './reportCompetitorIntelligenceService';
import {
  buildCompetitiveStrategyMap,
  type CompetitiveStrategyMap,
  type StrategicPositionBlock,
} from './reportCompetitorStrategyService';
import {
  impactScore,
  rankByImpactConfidence,
  isOpportunitySignal,
} from './reportDecisionUtils';
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { getAnalyticsHealthSummary, type AnalyticsHealthSummary } from './analyticsHealthService';
import { getAnalyticsEnterpriseSnapshot, type AnalyticsEnterpriseSnapshot } from './analyticsEnterpriseSnapshotService';
import {
  getSessionMetrics,
  getTrafficSources,
  getTopPages,
  type SessionMetrics,
  type TrafficSourceRow,
  type TopPageRow,
} from './behaviorAnalyticsService';
import { buildOmnivyraGscReportContext, type OmnivyraGscDashboardSummary } from './omnivyraGscAnalyticsService';

const GROWTH_SECTION_DEFINITIONS = [
  {
    section_name: 'Expansion Opportunities',
    IU_ids: ['IU-11', 'IU-13'],
  },
  {
    section_name: 'Strategic Positioning',
    IU_ids: ['IU-15'],
  },
  {
    section_name: 'Authority and Revenue Scaling',
    IU_ids: ['IU-04', 'IU-05'],
  },
] as const;

const GROWTH_IU_IDS: Set<string> = new Set(
  GROWTH_SECTION_DEFINITIONS.flatMap((section) => section.IU_ids),
);

type GrowthInsight = {
  decision_id: string;
  title: string;
  description: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  recommendation: string;
  action_type: string;
  confidence_label?: 'high' | 'medium' | 'low';
  evidence?: Record<string, unknown>;
};

type GrowthOpportunity = {
  decision_id: string;
  title: string;
  recommendation: string;
  confidence_score: number;
  action_type: string;
};

type GrowthAction = {
  decision_id: string;
  title: string;
  recommendation: string;
  action_type: string;
  action_payload: Record<string, unknown>;
};

export interface GrowthReportSection {
  section_name: string;
  IU_ids: string[];
  insights: GrowthInsight[];
  opportunities: GrowthOpportunity[];
  actions: GrowthAction[];
}

export interface GrowthMarketAnalyticsSummary {
  source: 'ga_canonical_ingestion' | 'fallback_no_analytics';
  readiness_status: string;
  reason: string;
  last_successful_ingestion_at: string | null;
  events_last_30_days: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  session_metrics: SessionMetrics;
  top_traffic_sources: TrafficSourceRow[];
  top_pages: TopPageRow[];
}

export interface GrowthSearchAnalyticsSummary {
  source: 'gsc_canonical_ingestion' | 'fallback_no_gsc';
  readiness_status: string;
  degraded_state: string;
  reason: string;
  property_url: string | null;
  last_successful_ingestion_at: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  top_queries: OmnivyraGscDashboardSummary['top_queries'];
  top_pages: OmnivyraGscDashboardSummary['top_pages'];
  devices: OmnivyraGscDashboardSummary['devices'];
  countries: OmnivyraGscDashboardSummary['countries'];
}

export interface GrowthReport {
  report_type: 'growth';
  score: {
    available: true;
    value: null;
    label: null;
  };
  market_analytics: GrowthMarketAnalyticsSummary;
  search_analytics: GrowthSearchAnalyticsSummary;
  analytics_health?: AnalyticsHealthSummary;
  enterprise_snapshot?: AnalyticsEnterpriseSnapshot;
  competitive_strategy_map: CompetitiveStrategyMap | null;
  strategic_position: StrategicPositionBlock | null;
  sections: GrowthReportSection[];
}

type GrowthReportOptions = {
  resolvedInput?: ResolvedReportInput | null;
};

function toInsight(decision: PersistedDecisionObject): GrowthInsight {
  return {
    decision_id: decision.id,
    title: decision.title,
    description: decision.description,
    issue_type: decision.issue_type,
    confidence_score: Number(decision.confidence_score ?? 0),
    impact_score: impactScore(decision),
    recommendation: decision.recommendation,
    action_type: decision.action_type,
  };
}

function toOpportunity(decision: PersistedDecisionObject): GrowthOpportunity {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    confidence_score: Number(decision.confidence_score ?? 0),
    action_type: decision.action_type,
  };
}

function toAction(decision: PersistedDecisionObject): GrowthAction {
  return {
    decision_id: decision.id,
    title: decision.title,
    recommendation: decision.recommendation,
    action_type: decision.action_type,
    action_payload: decision.action_payload ?? {},
  };
}

function mapDecisionsToGrowthGroups(
  decisions: PersistedDecisionObject[],
  growthUnits: IntelligenceUnitWithConfig[],
): Map<string, PersistedDecisionObject[]> {
  const groups = new Map<string, PersistedDecisionObject[]>();

  for (const decision of decisions) {
    const unit = mapDecisionToIntelligenceUnit(decision, growthUnits);
    if (!unit) continue;
    const current = groups.get(unit.id) ?? [];
    current.push(decision);
    groups.set(unit.id, current);
  }

  return groups;
}

function mergeUniqueDecisions(...decisionLists: PersistedDecisionObject[][]): PersistedDecisionObject[] {
  const byId = new Map<string, PersistedDecisionObject>();
  for (const list of decisionLists) {
    for (const decision of list) {
      byId.set(decision.id, decision);
    }
  }
  return [...byId.values()];
}

async function resolveGrowthInput(companyId: string, resolvedInput?: ResolvedReportInput | null): Promise<ResolvedReportInput | null> {
  if (resolvedInput) return resolvedInput;
  try {
    return await resolveAnalyticsReportInput({
      companyId,
      reportCategory: 'growth',
    });
  } catch (error) {
    console.warn('[competitor-strategy][growth-input-resolution-failed]', {
      company_id: companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildGrowthCompetitorStrategy(params: {
  decisions: PersistedDecisionObject[];
  resolvedInput: ResolvedReportInput | null;
}): {
  competitiveStrategyMap: CompetitiveStrategyMap | null;
  strategicPosition: StrategicPositionBlock | null;
} {
  if (!params.resolvedInput) return { competitiveStrategyMap: null, strategicPosition: null };
  try {
    const intelligence = buildCompetitorIntelligence({
      decisions: params.decisions,
      resolvedInput: params.resolvedInput,
    });
    const strategy = buildCompetitiveStrategyMap(intelligence);
    return {
      competitiveStrategyMap: strategy.competitive_strategy_map,
      strategicPosition: strategy.strategic_position,
    };
  } catch (error) {
    console.warn('[competitor-strategy][growth-build-failed]', {
      company_id: params.resolvedInput.companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { competitiveStrategyMap: null, strategicPosition: null };
  }
}

function buildCompetitiveStrategySection(
  strategyMap: CompetitiveStrategyMap | null,
  strategicPosition: StrategicPositionBlock | null,
): GrowthReportSection[] {
  if (!strategyMap || !strategicPosition) return [];

  const tierInsight = (label: string, items: CompetitiveStrategyMap['tier_breakdown']['tier_1']) => ({
    decision_id: `competitive_strategy_${label.toLowerCase().replace(/\s+/g, '_')}`,
    title: `${label} competitor pressure`,
    description: items.length
      ? items.map((item) => `${item.name}: ${item.threat_level} threat, ${item.differentiation}`).join(' ')
      : `${label} has no final-gated competitors in this report.`,
    issue_type: 'competitor_strategy',
    confidence_score: 0.9,
    impact_score: items.some((item) => item.threat_level === 'high') ? 86 : 68,
    recommendation: label === 'Tier 1'
      ? strategyMap.strategic_actions.how_to_beat_tier_1
      : label === 'Tier 2'
        ? strategyMap.strategic_actions.how_to_differentiate_from_tier_2
        : strategyMap.strategic_actions.how_to_ignore_tier_3,
    action_type: 'improve_content',
  });

  return [
    {
      section_name: 'Competitive Strategy Map',
      IU_ids: ['IU-15'],
      insights: [
        tierInsight('Tier 1', strategyMap.tier_breakdown.tier_1),
        tierInsight('Tier 2', strategyMap.tier_breakdown.tier_2),
        tierInsight('Tier 3', strategyMap.tier_breakdown.tier_3),
      ],
      opportunities: [
        ...strategyMap.opportunity_map.whitespace_opportunities.slice(0, 2).map((item, index) => ({
          decision_id: `competitive_whitespace_${index}`,
          title: item,
          recommendation: 'Turn this into a comparison, proof, or answer-ready asset.',
          confidence_score: 0.84,
          action_type: 'improve_content',
        })),
        ...strategyMap.opportunity_map.underexploited_icp_segments.slice(0, 2).map((item, index) => ({
          decision_id: `competitive_icp_${index}`,
          title: item,
          recommendation: 'Use this ICP angle in landing page messaging and campaign targeting.',
          confidence_score: 0.82,
          action_type: 'improve_content',
        })),
      ],
      actions: [
        {
          decision_id: 'competitive_action_tier_1',
          title: 'How to beat Tier 1 competitors',
          recommendation: strategyMap.strategic_actions.how_to_beat_tier_1,
          action_type: 'improve_content',
          action_payload: { tier: 'Tier 1', focus: 'direct_competitors' },
        },
        {
          decision_id: 'competitive_action_tier_2',
          title: 'How to differentiate from Tier 2',
          recommendation: strategyMap.strategic_actions.how_to_differentiate_from_tier_2,
          action_type: 'improve_content',
          action_payload: { tier: 'Tier 2', focus: 'alternatives' },
        },
        {
          decision_id: 'competitive_action_tier_3',
          title: 'How to ignore Tier 3',
          recommendation: strategyMap.strategic_actions.how_to_ignore_tier_3,
          action_type: 'improve_content',
          action_payload: { tier: 'Tier 3', focus: 'substitutes' },
        },
      ],
    },
    {
      section_name: 'Your Strategic Position',
      IU_ids: ['IU-15'],
      insights: [
        {
          decision_id: 'strategic_position_statement',
          title: 'Your Strategic Position',
          description: strategicPosition.positioning_statement,
          issue_type: 'competitor_positioning',
          confidence_score: 0.9,
          impact_score: 88,
          recommendation: strategicPosition.messaging_angle,
          action_type: 'improve_content',
        },
      ],
      opportunities: [
        {
          decision_id: 'strategic_position_battlefield',
          title: `Primary battlefield: ${strategicPosition.primary_battlefield}`,
          recommendation: `Compete here with proof, comparison pages, and sharper ICP messaging. Avoid ${strategicPosition.avoidance_zone}.`,
          confidence_score: 0.88,
          action_type: 'improve_content',
        },
      ],
      actions: [
        {
          decision_id: 'strategic_position_messaging',
          title: 'Messaging angle',
          recommendation: strategicPosition.messaging_angle,
          action_type: 'improve_content',
          action_payload: {
            primary_battlefield: strategicPosition.primary_battlefield,
            avoidance_zone: strategicPosition.avoidance_zone,
          },
        },
      ],
    },
  ];
}

export async function buildGrowthMarketAnalyticsSummary(companyId: string): Promise<GrowthMarketAnalyticsSummary> {
  const readiness = await getAnalyticsReadiness(companyId);
  const emptySessionMetrics: SessionMetrics = {
    total_sessions: 0,
    avg_events_per_session: 0,
    conversion_rate: 0,
  };

  if (!readiness.ready && readiness.events_last_30_days === 0) {
    return {
      source: 'fallback_no_analytics',
      readiness_status: readiness.status,
      reason: readiness.reason,
      last_successful_ingestion_at: readiness.last_successful_ingestion_at,
      events_last_30_days: readiness.events_last_30_days,
      confidence: readiness.confidence,
      session_metrics: emptySessionMetrics,
      top_traffic_sources: [],
      top_pages: [],
    };
  }

  const [sessionMetrics, trafficSources, topPages] = await Promise.all([
    getSessionMetrics(companyId, { sinceDays: 30 }),
    getTrafficSources(companyId, { sinceDays: 30 }),
    getTopPages(companyId, { sinceDays: 30 }),
  ]);

  return {
    source: readiness.last_successful_ingestion_at ? 'ga_canonical_ingestion' : 'fallback_no_analytics',
    readiness_status: readiness.status,
    reason: readiness.reason,
    last_successful_ingestion_at: readiness.last_successful_ingestion_at,
    events_last_30_days: readiness.events_last_30_days,
    confidence: readiness.confidence,
    session_metrics: sessionMetrics,
    top_traffic_sources: trafficSources.slice(0, 8),
    top_pages: topPages.slice(0, 8),
  };
}

function buildGrowthAnalyticsSection(analytics: GrowthMarketAnalyticsSummary): GrowthReportSection[] {
  if (analytics.source !== 'ga_canonical_ingestion' || analytics.session_metrics.total_sessions <= 0) {
    return [];
  }

  const topSource = analytics.top_traffic_sources[0] ?? null;
  const topPage = analytics.top_pages[0] ?? null;
  const conversionRatePct = `${(analytics.session_metrics.conversion_rate * 100).toFixed(2)}%`;

  return [{
    section_name: 'Google Analytics Market Signals',
    IU_ids: ['IU-13'],
    insights: [
      {
        decision_id: 'ga_market_sessions_30d',
        title: 'GA traffic is feeding the growth read',
        description: `${analytics.session_metrics.total_sessions.toLocaleString()} sessions in the last 30 days with ${analytics.session_metrics.avg_events_per_session.toFixed(2)} average events per session and ${conversionRatePct} conversion rate.`,
        issue_type: 'ga_market_signal',
        confidence_score: analytics.confidence === 'high' ? 0.9 : analytics.confidence === 'medium' ? 0.75 : 0.55,
        impact_score: analytics.session_metrics.total_sessions >= 500 ? 82 : 68,
        recommendation: 'Use the measured traffic mix when prioritizing expansion and acquisition opportunities.',
        action_type: 'analyze_market',
      },
      ...(topSource ? [{
        decision_id: 'ga_market_top_source',
        title: `Top acquisition source: ${topSource.traffic_source}`,
        description: `${topSource.traffic_source} / ${topSource.source_medium} contributed ${topSource.sessions.toLocaleString()} sessions, ${topSource.events.toLocaleString()} events, and ${topSource.conversions.toLocaleString()} conversions.`,
        issue_type: 'ga_channel_mix',
        confidence_score: 0.82,
        impact_score: 76,
        recommendation: 'Compare this channel against competitor and market-positioning signals before shifting budget or content focus.',
        action_type: 'analyze_market',
      }] : []),
      ...(topPage ? [{
        decision_id: 'ga_market_top_page',
        title: 'Top demand page from GA',
        description: `${topPage.page_url} produced ${topPage.visits.toLocaleString()} visits and ${topPage.events.toLocaleString()} events in the reporting window.`,
        issue_type: 'ga_demand_signal',
        confidence_score: 0.82,
        impact_score: 74,
        recommendation: 'Use high-demand pages as evidence for market messaging, comparison angles, and expansion priorities.',
        action_type: 'improve_content',
      }] : []),
    ],
    opportunities: analytics.top_pages.slice(0, 3).map((page, index) => ({
      decision_id: `ga_growth_page_opportunity_${index}`,
      title: page.page_url,
      recommendation: `Turn this observed GA demand into a stronger growth asset; current visits: ${page.visits.toLocaleString()}, events: ${page.events.toLocaleString()}.`,
      confidence_score: 0.78,
      action_type: 'improve_content',
    })),
    actions: analytics.top_traffic_sources.slice(0, 3).map((source, index) => ({
      decision_id: `ga_growth_source_action_${index}`,
      title: `Review ${source.traffic_source} / ${source.source_medium}`,
      recommendation: `Use this observed channel mix in the growth plan; current sessions: ${source.sessions.toLocaleString()}, conversions: ${source.conversions.toLocaleString()}.`,
      action_type: 'analyze_market',
      action_payload: {
        source: source.traffic_source,
        medium: source.source_medium,
        sessions: source.sessions,
        events: source.events,
        conversions: source.conversions,
      },
    })),
  }];
}

export async function buildGrowthSearchAnalyticsSummary(companyId: string): Promise<GrowthSearchAnalyticsSummary> {
  const context = await buildOmnivyraGscReportContext(companyId).catch(() => null);
  if (!context || context.provenance.source !== 'gsc_canonical_ingestion') {
    return {
      source: 'fallback_no_gsc',
      readiness_status: context?.status.status ?? 'not_available',
      degraded_state: context?.status.degraded_state ?? 'no_analytics',
      reason: context?.status.message ?? 'No canonical GSC analytics available for this report.',
      property_url: context?.provenance.property_url ?? null,
      last_successful_ingestion_at: context?.status.last_sync ?? null,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      avg_position: 0,
      top_queries: [],
      top_pages: [],
      devices: [],
      countries: [],
    };
  }

  return {
    source: 'gsc_canonical_ingestion',
    readiness_status: context.status.status,
    degraded_state: context.status.degraded_state,
    reason: context.status.message,
    property_url: context.provenance.property_url,
    last_successful_ingestion_at: context.status.last_sync,
    clicks: context.summary.clicks,
    impressions: context.summary.impressions,
    ctr: context.summary.ctr,
    avg_position: context.summary.avg_position,
    top_queries: context.top_queries.slice(0, 8),
    top_pages: context.top_pages.slice(0, 8),
    devices: context.devices.slice(0, 6),
    countries: context.countries.slice(0, 6),
  };
}

function growthConfidenceForImpressions(impressions: number): 'high' | 'medium' | 'low' {
  if (impressions >= 500) return 'high';
  if (impressions >= 50) return 'medium';
  return 'low';
}

function buildGrowthSearchSection(search: GrowthSearchAnalyticsSummary): GrowthReportSection[] {
  if (search.source !== 'gsc_canonical_ingestion' || search.impressions < 10) {
    return [];
  }

  const topQuery = search.top_queries[0] ?? null;
  const topPage = search.top_pages[0] ?? null;
  const confidenceLabel = growthConfidenceForImpressions(search.impressions);

  return [{
    section_name: 'Search Console Growth Signals',
    IU_ids: ['IU-13'],
    insights: [
      {
        decision_id: 'gsc_growth_visibility',
        title: 'Organic visibility is measurable from Search Console',
        description: `${search.impressions.toLocaleString()} impressions and ${search.clicks.toLocaleString()} clicks at ${(search.ctr * 100).toFixed(2)}% CTR and ${search.avg_position.toFixed(1)} average position.`,
        issue_type: 'gsc_search_visibility',
        confidence_score: search.degraded_state === 'live' ? 0.9 : 0.72,
        confidence_label: confidenceLabel,
        impact_score: search.impressions >= 1000 ? 84 : 68,
        recommendation: 'Use observed organic search demand when prioritizing discoverability and landing-page opportunities.',
        action_type: 'analyze_market',
        evidence: {
          source: 'gsc_canonical_ingestion',
          property_url: search.property_url,
          clicks: search.clicks,
          impressions: search.impressions,
          ctr: search.ctr,
          avg_position: search.avg_position,
          last_successful_ingestion_at: search.last_successful_ingestion_at,
        },
      },
      ...(topQuery ? [{
        decision_id: 'gsc_growth_top_query',
        title: `Top organic query: ${topQuery.label}`,
        description: `${topQuery.label} produced ${topQuery.impressions.toLocaleString()} impressions and ${topQuery.clicks.toLocaleString()} clicks at ${(topQuery.ctr * 100).toFixed(2)}% CTR.`,
        issue_type: 'gsc_keyword_opportunity',
        confidence_score: 0.84,
        confidence_label: growthConfidenceForImpressions(topQuery.impressions),
        impact_score: topQuery.impressions >= 500 ? 80 : 66,
        recommendation: 'Use this observed search query as evidence for keyword opportunity and content-market fit.',
        action_type: 'improve_content',
        evidence: {
          source: 'gsc_canonical_ingestion',
          query: topQuery.label,
          clicks: topQuery.clicks,
          impressions: topQuery.impressions,
          ctr: topQuery.ctr,
          avg_position: topQuery.avg_position,
        },
      }] : []),
      ...(topPage ? [{
        decision_id: 'gsc_growth_top_page',
        title: 'Top SEO landing page',
        description: `${topPage.label} produced ${topPage.impressions.toLocaleString()} impressions and ${topPage.clicks.toLocaleString()} clicks from organic search.`,
        issue_type: 'gsc_landing_page_performance',
        confidence_score: 0.84,
        confidence_label: growthConfidenceForImpressions(topPage.impressions),
        impact_score: topPage.impressions >= 500 ? 78 : 64,
        recommendation: 'Use this landing-page pattern to shape search discoverability and content expansion.',
        action_type: 'improve_content',
        evidence: {
          source: 'gsc_canonical_ingestion',
          page_url: topPage.label,
          clicks: topPage.clicks,
          impressions: topPage.impressions,
          ctr: topPage.ctr,
          avg_position: topPage.avg_position,
        },
      }] : []),
    ],
    opportunities: search.top_queries.slice(0, 3).map((query, index) => ({
      decision_id: `gsc_growth_query_opportunity_${index}`,
      title: query.label,
      recommendation: `Evaluate this query for content expansion; observed impressions: ${query.impressions.toLocaleString()}, CTR: ${(query.ctr * 100).toFixed(2)}%.`,
      confidence_score: 0.78,
      action_type: 'improve_content',
    })),
    actions: search.top_pages.slice(0, 3).map((page, index) => ({
      decision_id: `gsc_growth_page_action_${index}`,
      title: page.label,
      recommendation: `Review SEO landing-page performance; clicks: ${page.clicks.toLocaleString()}, impressions: ${page.impressions.toLocaleString()}, average position: ${page.avg_position.toFixed(1)}.`,
      action_type: 'improve_content',
      action_payload: {
        page_url: page.label,
        clicks: page.clicks,
        impressions: page.impressions,
        ctr: page.ctr,
        avg_position: page.avg_position,
        source: 'gsc_canonical_ingestion',
      },
    })),
  }];
}

function buildEnterpriseStrategicSections(snapshot: AnalyticsEnterpriseSnapshot | null): GrowthReportSection[] {
  if (!snapshot) return [];
  const recommendations = snapshot.recommendation_intelligence.recommendations.slice(0, 5);
  const predictions = snapshot.predictive_intelligence.signals.filter((signal) => signal.confidence !== 'none').slice(0, 3);
  const competitive = snapshot.external_competitive_intelligence.signals.slice(0, 4);
  const leadGen = snapshot.lead_generation_authority_intelligence.signals.slice(0, 5);
  const unifiedCompetitors = snapshot.unified_competitor_intelligence.competitors.slice(0, 5);
  const competitorOpportunities = snapshot.unified_competitor_intelligence.opportunities.slice(0, 4);
  const sections: GrowthReportSection[] = [];

  if (recommendations.length) {
    sections.push({
      section_name: 'Enterprise Recommendation Intelligence',
      IU_ids: ['IU-13'],
      insights: recommendations.map((rec) => ({
        decision_id: rec.id,
        title: rec.title,
        description: `${rec.action} Business impact: ${rec.business_impact}; urgency: ${rec.strategic_urgency}.`,
        issue_type: `recommendation_${rec.category}`,
        confidence_score: rec.confidence === 'high' ? 0.9 : rec.confidence === 'medium' ? 0.74 : 0.55,
        confidence_label: rec.confidence,
        impact_score: rec.priority_score,
        recommendation: rec.action,
        action_type: 'improve_content',
        evidence: {
          evidence_refs: rec.evidence_refs,
          estimated_seo_impact: rec.estimated_seo_impact,
          estimated_discoverability_impact: rec.estimated_discoverability_impact,
          expected_authority_gain: rec.expected_authority_gain,
          source: 'enterprise_snapshot',
        },
      })),
      opportunities: recommendations.slice(0, 3).map((rec) => ({
        decision_id: `${rec.id}:opportunity`,
        title: rec.title,
        recommendation: rec.action,
        confidence_score: rec.confidence === 'high' ? 0.9 : rec.confidence === 'medium' ? 0.74 : 0.55,
        action_type: 'improve_content',
      })),
      actions: recommendations.slice(0, 3).map((rec) => ({
        decision_id: `${rec.id}:action`,
        title: rec.title,
        recommendation: rec.action,
        action_type: 'improve_content',
        action_payload: {
          priority_score: rec.priority_score,
          business_impact: rec.business_impact,
          implementation_difficulty: rec.implementation_difficulty,
          evidence_refs: rec.evidence_refs,
        },
      })),
    });
  }

  if (predictions.length || competitive.length) {
    sections.push({
      section_name: 'Predictive and Competitive Search Intelligence',
      IU_ids: ['IU-13'],
      insights: [
        ...predictions.map((signal) => ({
          decision_id: `prediction_${signal.type}`,
          title: signal.label,
          description: `${signal.prediction} prediction with ${signal.confidence} confidence; interval ${signal.confidence_interval.low}-${signal.confidence_interval.high}.`,
          issue_type: `prediction_${signal.type}`,
          confidence_score: signal.confidence === 'high' ? 0.9 : signal.confidence === 'medium' ? 0.72 : 0.5,
          confidence_label: signal.confidence === 'none' ? 'low' as const : signal.confidence,
          impact_score: signal.score,
          recommendation: signal.explanation,
          action_type: 'analyze_market',
          evidence: { evidence_refs: signal.evidence_refs, source: 'enterprise_snapshot' },
        })),
        ...competitive.map((signal, index) => ({
          decision_id: `external_competitive_${index}`,
          title: signal.title,
          description: `${signal.provenance} signal scored ${signal.score}.`,
          issue_type: `external_${signal.type}`,
          confidence_score: signal.confidence === 'high' ? 0.9 : signal.confidence === 'medium' ? 0.72 : 0.5,
          confidence_label: signal.confidence === 'none' ? 'low' as const : signal.confidence,
          impact_score: signal.score,
          recommendation: 'Use this external search signal only where provenance and confidence are sufficient.',
          action_type: 'analyze_market',
          evidence: signal.evidence,
        })),
      ],
      opportunities: [],
      actions: [],
    });
  }

  if (leadGen.length) {
    sections.push({
      section_name: 'Lead-Generation Authority Intelligence',
      IU_ids: ['IU-13'],
      insights: leadGen.map((signal) => ({
        decision_id: signal.id,
        title: signal.title,
        description: `${signal.recommendation} Organic acquisition score: ${snapshot.lead_generation_authority_intelligence.organic_acquisition_opportunity_score}.`,
        issue_type: signal.type,
        confidence_score: signal.confidence === 'high' ? 0.9 : signal.confidence === 'medium' ? 0.72 : 0.52,
        confidence_label: signal.confidence,
        impact_score: signal.priority_score,
        recommendation: signal.recommendation,
        action_type: 'improve_content',
        evidence: {
          source: 'enterprise_snapshot',
          evidence_refs: signal.evidence_refs,
          provenance: signal.provenance,
          evidence: signal.evidence,
        },
      })),
      opportunities: leadGen.slice(0, 3).map((signal) => ({
        decision_id: `${signal.id}:opportunity`,
        title: signal.title,
        recommendation: signal.recommendation,
        confidence_score: signal.confidence === 'high' ? 0.9 : signal.confidence === 'medium' ? 0.72 : 0.52,
        action_type: 'improve_content',
      })),
      actions: leadGen.slice(0, 3).map((signal) => ({
        decision_id: `${signal.id}:action`,
        title: signal.title,
        recommendation: signal.recommendation,
        action_type: 'improve_content',
        action_payload: {
          priority_score: signal.priority_score,
          evidence_refs: signal.evidence_refs,
          provenance: signal.provenance,
        },
      })),
    });
  }

  if (unifiedCompetitors.length || competitorOpportunities.length) {
    sections.push({
      section_name: 'Unified Competitor Intelligence',
      IU_ids: ['IU-15'],
      insights: [
        ...unifiedCompetitors.map((competitor) => ({
          decision_id: `unified_competitor_${competitor.domain ?? competitor.name}`,
          title: `${competitor.name} competitor priority`,
          description: `Strategic priority ${competitor.scores.strategic_priority}; visibility ${competitor.scores.visibility_share}; authority gap ${competitor.scores.authority_gap}; lead intent ${competitor.scores.commercial_overlap}.`,
          issue_type: 'unified_competitor_intelligence',
          confidence_score: competitor.confidence === 'high' ? 0.9 : competitor.confidence === 'medium' ? 0.72 : 0.5,
          confidence_label: competitor.confidence,
          impact_score: competitor.scores.strategic_priority,
          recommendation: 'Use this reconciled competitor ranking to focus market-position, authority, and lead-generation actions.',
          action_type: 'analyze_market',
          evidence: {
            evidence_refs: competitor.evidence_refs,
            sources: competitor.sources,
            freshness: competitor.freshness,
            evidence: competitor.evidence,
          },
        })),
        ...competitorOpportunities.map((opportunity) => ({
          decision_id: opportunity.id,
          title: opportunity.title,
          description: opportunity.recommendation,
          issue_type: `competitor_${opportunity.type}`,
          confidence_score: opportunity.confidence === 'high' ? 0.9 : opportunity.confidence === 'medium' ? 0.72 : 0.5,
          confidence_label: opportunity.confidence,
          impact_score: opportunity.priority_score,
          recommendation: opportunity.recommendation,
          action_type: 'improve_content',
          evidence: {
            evidence_refs: opportunity.evidence_refs,
            competitor_domain: opportunity.competitor_domain,
            evidence: opportunity.evidence,
          },
        })),
      ],
      opportunities: competitorOpportunities.slice(0, 3).map((opportunity) => ({
        decision_id: `${opportunity.id}:opportunity`,
        title: opportunity.title,
        recommendation: opportunity.recommendation,
        confidence_score: opportunity.confidence === 'high' ? 0.9 : opportunity.confidence === 'medium' ? 0.72 : 0.5,
        action_type: 'improve_content',
      })),
      actions: competitorOpportunities.slice(0, 3).map((opportunity) => ({
        decision_id: `${opportunity.id}:action`,
        title: opportunity.title,
        recommendation: opportunity.recommendation,
        action_type: 'improve_content',
        action_payload: {
          priority_score: opportunity.priority_score,
          competitor_domain: opportunity.competitor_domain,
          evidence_refs: opportunity.evidence_refs,
        },
      })),
    });
  }

  return sections;
}

export async function composeGrowthReport(companyId: string, options?: GrowthReportOptions): Promise<GrowthReport> {
  const [growthComposed, deepComposed, units, marketAnalytics, searchAnalytics, enterpriseSnapshot] = await Promise.all([
    composeReport({
      companyId,
      reportTier: 'growth',
      status: ['open'],
    }),
    composeReport({
      companyId,
      reportTier: 'deep',
      status: ['open'],
    }),
    listCompanyIntelligenceUnits(companyId),
    buildGrowthMarketAnalyticsSummary(companyId),
    buildGrowthSearchAnalyticsSummary(companyId),
    getAnalyticsEnterpriseSnapshot(companyId).catch(() => null),
  ]);

  const growthUnits = units.filter((unit) => unit.enabled && GROWTH_IU_IDS.has(unit.id));
  const mergedDecisions = mergeUniqueDecisions(growthComposed.decisions, deepComposed.decisions);
  const resolvedInput = await resolveGrowthInput(companyId, options?.resolvedInput ?? null);
  const growthStrategy = buildGrowthCompetitorStrategy({
    decisions: mergedDecisions,
    resolvedInput,
  });
  const grouped = mapDecisionsToGrowthGroups(mergedDecisions, growthUnits);

  const sections: GrowthReportSection[] = GROWTH_SECTION_DEFINITIONS.map((section) => {
    const sectionDecisions = section.IU_ids
      .flatMap((iuId) => grouped.get(iuId) ?? [])
      .sort(rankByImpactConfidence);

    const insights = sectionDecisions
      .slice(0, 8)
      .map(toInsight);

    const opportunities = sectionDecisions
      .filter(isOpportunitySignal)
      .slice(0, 6)
      .map(toOpportunity);

    const actions = sectionDecisions
      .slice(0, 6)
      .map(toAction);

    return {
      section_name: section.section_name,
      IU_ids: [...section.IU_ids],
      insights,
      opportunities,
      actions,
    };
  });

  const competitiveSections = buildCompetitiveStrategySection(
    growthStrategy.competitiveStrategyMap,
    growthStrategy.strategicPosition,
  );
  const analyticsSections = buildGrowthAnalyticsSection(marketAnalytics);
  const searchSections = buildGrowthSearchSection(searchAnalytics);
  const enterpriseSections = buildEnterpriseStrategicSections(enterpriseSnapshot);

  return {
    report_type: 'growth',
    score: {
      available: true,
      value: null,
      label: null,
    },
    market_analytics: marketAnalytics,
    search_analytics: searchAnalytics,
    analytics_health: enterpriseSnapshot ? {
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
        ga_events_last_30_days: marketAnalytics.events_last_30_days,
        gsc_rows_ingested: searchAnalytics.top_queries.length + searchAnalytics.top_pages.length,
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
    } : await getAnalyticsHealthSummary(companyId).catch(() => undefined),
    enterprise_snapshot: enterpriseSnapshot ?? undefined,
    competitive_strategy_map: growthStrategy.competitiveStrategyMap,
    strategic_position: growthStrategy.strategicPosition,
    sections: [...analyticsSections, ...searchSections, ...enterpriseSections, ...sections, ...competitiveSections],
  };
}
