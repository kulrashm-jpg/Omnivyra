import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { classifyAnalyticsFreshness, type AnalyticsFreshnessSnapshot } from './analyticsFreshnessService';
import { getOmnivyraGscDashboardSummary } from './omnivyraGscAnalyticsService';
import { buildGscSeoIntelligence, type GscSeoIntelligence } from './gscSeoIntelligenceService';
import { buildAnalyticsCorrelationContext, type AnalyticsCorrelationContext, type AnalyticsCorrelationInsight } from './analyticsCorrelationService';
import { evaluateAnalyticsMutationSafety } from './analyticsEnvironmentGuardService';
import { buildAnalyticsCompetitiveIntelligence, type AnalyticsCompetitiveIntelligence } from './analyticsCompetitiveIntelligenceService';
import { buildAnalyticsExecutiveSummary, type AnalyticsExecutiveSummary } from './analyticsExecutiveSummaryService';
import { prioritizeAnalyticsOpportunities, type AnalyticsPrioritizationSummary } from './analyticsPrioritizationService';
import { buildAnalyticsObservabilityExpansion, type AnalyticsObservabilityExpansion } from './analyticsObservabilityExpansionService';
import { buildAnalyticsLineage, type AnalyticsLineageSummary } from './analyticsLineageService';
import { normalizeProviderProvenance, type NormalizedProviderProvenance } from './analyticsProviderNormalizationService';
import {
  assertSnapshotPayloadSafe,
  buildSnapshotLifecycleMetadata,
  type SnapshotLifecycleMetadata,
} from './analyticsSnapshotGovernanceService';
import { buildExternalCompetitiveIntelligence, type ExternalCompetitiveIntelligence } from './externalCompetitiveIntelligenceService';
import { discoverAndPersistCompetitorDomains, type CompetitorDiscoveryResult } from './competitorDiscoveryEngineService';
import { bootstrapCompetitorDataset, type CompetitorBootstrapResult } from './competitiveDatasetBootstrapService';
import { seedSerpQueryQueue, type SerpQuerySeed } from './serpAcquisitionService';
import { buildPredictiveStrategicIntelligence, type PredictiveStrategicIntelligence } from './predictiveStrategicIntelligenceService';
import { buildAuthorityMarketPosition, type AuthorityMarketPosition } from './authorityMarketPositionService';
// PRODUCT-RESTORE-001 Phase 1: explicit domain name (was the ambiguous `RecommendationIntelligence`).
import { buildRecommendationIntelligence, type SeoGrowthRecommendationIntelligence } from './recommendationIntelligenceService';
import {
  buildLeadGenerationAuthorityIntelligence,
  type LeadGenerationAuthorityIntelligence,
} from './leadGenerationAuthorityIntelligenceService';
import {
  buildUnifiedCompetitorIntelligence,
  type UnifiedCompetitorIntelligence,
} from './unifiedCompetitorIntelligenceService';

export type EnterpriseOpportunity = {
  id: string;
  category: 'seo' | 'engagement' | 'conversion' | 'discoverability' | 'attribution';
  title: string;
  page_url: string | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
  provenance: {
    ga: 'ga_canonical_ingestion' | 'missing';
    gsc: 'gsc_canonical_ingestion' | 'missing';
  };
};

export type AttributionIntelligence = {
  organic_conversion_pages: EnterpriseOpportunity[];
  low_conversion_high_traffic_pages: EnterpriseOpportunity[];
  assisted_conversion_visibility: EnterpriseOpportunity[];
};

export type AnalyticsTrustGovernance = {
  trust_score: number;
  completeness_score: number;
  unsupported_claim_policy: 'suppress_weak_claims';
  stale_data_governance: string;
  evidence_required: true;
};

export type AnalyticsEnterpriseSnapshot = {
  company_id: string;
  generated_at: string;
  expires_at: string;
  canonical_fingerprint: string;
  cache_status: 'computed' | 'memory_hit' | 'database_hit';
  lifecycle: SnapshotLifecycleMetadata;
  provider_provenance: NormalizedProviderProvenance[];
  freshness: {
    ga: AnalyticsFreshnessSnapshot;
    gsc: AnalyticsFreshnessSnapshot;
  };
  correlation: AnalyticsCorrelationContext;
  gsc_intelligence: GscSeoIntelligence | null;
  competitive_intelligence: AnalyticsCompetitiveIntelligence;
  external_competitive_intelligence: ExternalCompetitiveIntelligence;
  unified_competitor_intelligence: UnifiedCompetitorIntelligence;
  competitor_discovery: CompetitorDiscoveryResult;
  competitor_bootstrap: CompetitorBootstrapResult;
  serp_query_seeding: {
    status: 'ready' | 'skipped' | 'failed';
    seeded: number;
    errors: string[];
    seeds: SerpQuerySeed[];
  };
  predictive_intelligence: PredictiveStrategicIntelligence;
  authority_market_position: AuthorityMarketPosition;
  recommendation_intelligence: SeoGrowthRecommendationIntelligence;
  lead_generation_authority_intelligence: LeadGenerationAuthorityIntelligence;
  executive_summary: AnalyticsExecutiveSummary;
  opportunities: EnterpriseOpportunity[];
  prioritization: AnalyticsPrioritizationSummary;
  attribution: AttributionIntelligence;
  governance: AnalyticsTrustGovernance;
  lineage: AnalyticsLineageSummary;
  observability: {
    ingestion_history: Array<{
      source: 'ga4' | 'gsc';
      status: string;
      started_at: string | null;
      completed_at: string | null;
      retry_count: number;
      records_processed: number;
      error_message: string | null;
    }>;
    provider_uptime: {
      ga_success_rate: number;
      gsc_success_rate: number;
    };
    quota_warnings: string[];
    expansion: AnalyticsObservabilityExpansion;
  };
};

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const memoryCache = new Map<string, AnalyticsEnterpriseSnapshot>();
const inflightSnapshots = new Map<string, Promise<AnalyticsEnterpriseSnapshot>>();

function hashFingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function nowIsoPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function confidenceRank(value: string): number {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function normalizeConfidence(value: string): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'medium') return value;
  return 'low';
}

function opportunityFromCorrelation(insight: AnalyticsCorrelationInsight): EnterpriseOpportunity {
  const category: EnterpriseOpportunity['category'] =
    insight.type === 'engagement_without_discovery' ? 'discoverability'
      : insight.type === 'ctr_without_conversion' ? 'conversion'
        : insight.type === 'ranking_opportunity' ? 'seo'
          : 'engagement';
  return {
    id: `${insight.type}:${insight.page_url}`,
    category,
    title: insight.title,
    page_url: insight.page_url,
    score: insight.opportunity_score,
    confidence: normalizeConfidence(insight.confidence),
    evidence: insight.evidence,
    provenance: insight.provenance,
  };
}

function buildSeoOpportunities(gsc: GscSeoIntelligence | null): EnterpriseOpportunity[] {
  if (!gsc) return [];
  return [
    ...gsc.ctr_opportunities.map((page) => ({
      id: `gsc-page:${page.issue}:${page.page_url}`,
      category: 'seo' as const,
      title: page.issue === 'ranking_threshold'
        ? 'SEO page is near a ranking improvement threshold'
        : 'Search visibility has weak click-through performance',
      page_url: page.page_url,
      score: page.opportunity_score,
      confidence: page.confidence,
      evidence: {
        impressions: page.impressions,
        clicks: page.clicks,
        ctr: page.ctr,
        avg_position: page.avg_position,
        movement: page.movement,
      },
      provenance: { ga: 'missing' as const, gsc: 'gsc_canonical_ingestion' as const },
    })),
    ...gsc.top_queries
      .filter((query) => query.opportunity_score >= 50)
      .map((query) => ({
        id: `gsc-query:${query.query}`,
        category: 'seo' as const,
        title: `Search query opportunity: ${query.query}`,
        page_url: null,
        score: query.opportunity_score,
        confidence: query.confidence,
        evidence: {
          query: query.query,
          classification: query.classification,
          impressions: query.impressions,
          clicks: query.clicks,
          ctr: query.ctr,
          avg_position: query.avg_position,
          movement: query.movement,
        },
        provenance: { ga: 'missing' as const, gsc: 'gsc_canonical_ingestion' as const },
      })),
  ];
}

function suppressAndRankOpportunities(items: EnterpriseOpportunity[]): EnterpriseOpportunity[] {
  const seen = new Set<string>();
  return items
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score || confidenceRank(b.confidence) - confidenceRank(a.confidence))
    .filter((item) => {
      const key = `${item.category}:${item.page_url ?? item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 15);
}

function buildAttribution(opportunities: EnterpriseOpportunity[]): AttributionIntelligence {
  return {
    organic_conversion_pages: opportunities.filter((item) =>
      item.category === 'attribution' || /conversion/i.test(item.title),
    ).slice(0, 5),
    low_conversion_high_traffic_pages: opportunities.filter((item) =>
      item.category === 'conversion' && item.provenance.ga === 'ga_canonical_ingestion',
    ).slice(0, 5),
    assisted_conversion_visibility: opportunities.filter((item) =>
      item.provenance.ga === 'ga_canonical_ingestion' && item.provenance.gsc === 'gsc_canonical_ingestion',
    ).slice(0, 5),
  };
}

function buildGovernance(params: {
  ga: AnalyticsFreshnessSnapshot;
  gsc: AnalyticsFreshnessSnapshot;
  opportunities: EnterpriseOpportunity[];
}): AnalyticsTrustGovernance {
  const freshnessScore = Math.round((params.ga.freshness_score + params.gsc.freshness_score) / 2);
  const evidenceScore = params.opportunities.length > 0 ? 90 : 55;
  const completenessScore = Math.round((Number(params.ga.trust_level !== 'none') + Number(params.gsc.trust_level !== 'none')) * 50);
  return {
    trust_score: Math.max(0, Math.min(100, Math.round(freshnessScore * 0.6 + evidenceScore * 0.25 + completenessScore * 0.15))),
    completeness_score: completenessScore,
    unsupported_claim_policy: 'suppress_weak_claims',
    stale_data_governance: freshnessScore < 50
      ? 'Stale or failed analytics must be labeled directional and suppressed from high-confidence recommendations.'
      : 'Insights may be used with visible provenance and confidence metadata.',
    evidence_required: true,
  };
}

async function loadRunHistory(companyId: string): Promise<AnalyticsEnterpriseSnapshot['observability']['ingestion_history']> {
  const { data } = await supabase
    .from('ingestion_runs')
    .select('source, status, started_at, completed_at, retry_count, records_processed, error_message')
    .eq('company_id', companyId)
    .in('source', ['ga4', 'gsc'])
    .order('started_at', { ascending: false })
    .limit(20);

  return ((data ?? []) as any[]).map((row) => ({
    source: row.source === 'gsc' ? 'gsc' : 'ga4',
    status: String(row.status ?? 'unknown'),
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    retry_count: Number(row.retry_count ?? 0),
    records_processed: Number(row.records_processed ?? 0),
    error_message: row.error_message ?? null,
  }));
}

function successRate(rows: AnalyticsEnterpriseSnapshot['observability']['ingestion_history'], source: 'ga4' | 'gsc'): number {
  const scoped = rows.filter((row) => row.source === source);
  if (!scoped.length) return 0;
  const ok = scoped.filter((row) => row.status === 'completed' || row.status === 'success').length;
  return Number((ok / scoped.length).toFixed(3));
}

async function latestCanonicalFingerprint(companyId: string): Promise<{
  fingerprint: string;
  gaReadiness: Awaited<ReturnType<typeof getAnalyticsReadiness>> | null;
  gscSummary: Awaited<ReturnType<typeof getOmnivyraGscDashboardSummary>> | null;
}> {
  const [gaReadiness, gscSummary] = await Promise.all([
    getAnalyticsReadiness(companyId).catch(() => null),
    getOmnivyraGscDashboardSummary(30).catch(() => null),
  ]);
  return {
    fingerprint: hashFingerprint({
      companyId,
      ga: {
        sync: gaReadiness?.last_successful_ingestion_at ?? null,
        events: gaReadiness?.events_last_30_days ?? 0,
        status: gaReadiness?.status ?? null,
      },
      gsc: {
        sync: gscSummary?.status.last_sync ?? null,
        rows: gscSummary?.status.rows_ingested ?? 0,
        property: gscSummary?.provenance.property_url ?? null,
        status: gscSummary?.status.status ?? null,
      },
    }),
    gaReadiness,
    gscSummary,
  };
}

async function readSnapshot(companyId: string, fingerprint: string): Promise<AnalyticsEnterpriseSnapshot | null> {
  const memory = memoryCache.get(companyId);
  if (memory && memory.canonical_fingerprint === fingerprint && new Date(memory.expires_at).getTime() > Date.now()) {
    return { ...memory, cache_status: 'memory_hit' };
  }

  const { data } = await ownedDbTable('analytics_intelligence_snapshots')
    .select('snapshot_payload, expires_at, canonical_fingerprint')
    .eq('company_id', companyId)
    .eq('snapshot_type', 'ga_gsc_enterprise')
    .eq('canonical_fingerprint', fingerprint)
    .gt('expires_at', new Date().toISOString())
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = data?.snapshot_payload as AnalyticsEnterpriseSnapshot | null | undefined;
  if (!payload) return null;
  const snapshot = { ...payload, cache_status: 'database_hit' as const };
  memoryCache.set(companyId, snapshot);
  return snapshot;
}

async function persistSnapshot(snapshot: AnalyticsEnterpriseSnapshot): Promise<void> {
  const decision = evaluateAnalyticsMutationSafety('snapshot_write');
  if (!decision.allowed) {
    console.warn('[analytics-enterprise-snapshot][persist-skipped]', {
      company_id: snapshot.company_id,
      reason: decision.reason,
    });
    return;
  }

  await ownedDbTable('analytics_intelligence_snapshots')
    .upsert({
      company_id: snapshot.company_id,
      snapshot_type: 'ga_gsc_enterprise',
      canonical_fingerprint: snapshot.canonical_fingerprint,
      computed_at: snapshot.generated_at,
      expires_at: snapshot.expires_at,
      snapshot_payload: snapshot,
      provenance: {
        ga: snapshot.correlation.provenance.ga,
        gsc: snapshot.correlation.provenance.gsc,
      },
    }, { onConflict: 'company_id,snapshot_type,canonical_fingerprint' });
}

export async function getAnalyticsEnterpriseSnapshot(companyId: string): Promise<AnalyticsEnterpriseSnapshot> {
  const canonical = await latestCanonicalFingerprint(companyId);
  const cached = await readSnapshot(companyId, canonical.fingerprint);
  if (cached) return cached;

  const inflightKey = `${companyId}:${canonical.fingerprint}`;
  const existing = inflightSnapshots.get(inflightKey);
  if (existing) {
    const snapshot = await existing;
    return { ...snapshot, cache_status: 'memory_hit' };
  }

  const computePromise = computeAnalyticsEnterpriseSnapshot(companyId, canonical);
  inflightSnapshots.set(inflightKey, computePromise);
  try {
    return await computePromise;
  } finally {
    inflightSnapshots.delete(inflightKey);
  }
}

async function computeAnalyticsEnterpriseSnapshot(
  companyId: string,
  canonical: Awaited<ReturnType<typeof latestCanonicalFingerprint>>,
): Promise<AnalyticsEnterpriseSnapshot> {
  const [correlation, gscIntelligence, ingestionHistory] = await Promise.all([
    buildAnalyticsCorrelationContext(companyId).catch(() => ({ provenance: { ga: 'missing' as const, gsc: 'missing' as const }, insights: [] })),
    buildGscSeoIntelligence(companyId, 30).catch(() => null),
    loadRunHistory(companyId),
  ]);

  const gaFreshness = classifyAnalyticsFreshness({
    source: 'ga',
    lastSuccessfulSyncAt: canonical.gaReadiness?.last_successful_ingestion_at ?? null,
    status: canonical.gaReadiness?.status ?? null,
    rowsOrEvents: canonical.gaReadiness?.events_last_30_days ?? 0,
  });
  const gscFreshness = classifyAnalyticsFreshness({
    source: 'gsc',
    lastSuccessfulSyncAt: canonical.gscSummary?.status.last_sync ?? null,
    status: canonical.gscSummary?.status.status ?? null,
    errorMessage: canonical.gscSummary?.status.error_message ?? null,
    rowsOrEvents: canonical.gscSummary?.status.rows_ingested ?? 0,
  });
  const opportunities = suppressAndRankOpportunities([
    ...correlation.insights.map(opportunityFromCorrelation),
    ...buildSeoOpportunities(gscIntelligence),
  ]);
  const competitorDiscovery = await discoverAndPersistCompetitorDomains({ companyId, gsc: gscIntelligence }).catch(() => ({
    status: 'unavailable' as const,
    discovered: [],
    suppressed: 0,
  }));
  const [competitorBootstrap, serpQuerySeeding] = await Promise.all([
    bootstrapCompetitorDataset({ companyId, gsc: gscIntelligence }).catch((error) => ({
      status: 'failed' as const,
      persisted: [],
      suppressed: [],
      errors: [error instanceof Error ? error.message : String(error)],
    })),
    seedSerpQueryQueue({ companyId, gsc: gscIntelligence, limit: 20 }).catch((error) => ({
      status: 'failed' as const,
      seeded: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      seeds: [],
    })),
  ]);
  const [externalCompetitiveIntelligence] = await Promise.all([
    buildExternalCompetitiveIntelligence({ companyId, gsc: gscIntelligence }).catch(() => ({
      status: 'unavailable' as const,
      summary: 'External competitive intelligence could not be loaded.',
      freshness: {
        latest_serp_snapshot_at: null,
        serp_snapshot_count: 0,
        competitor_domain_count: 0,
      },
      signals: [],
    })),
  ]);
  const unifiedCompetitorIntelligence = await buildUnifiedCompetitorIntelligence({
    companyId,
    gsc: gscIntelligence,
  }).catch(() => ({
    status: 'unavailable' as const,
    generated_at: new Date().toISOString(),
    summary: 'Unified competitor intelligence could not be loaded.',
    competitors: [],
    opportunities: [],
    quality: {
      total_candidates: 0,
      suppressed_low_confidence: 0,
      stale_suppressed: 0,
      duplicate_domains_consolidated: 0,
      serp_evidence_rows: 0,
    },
  }));
  const competitiveIntelligence = buildAnalyticsCompetitiveIntelligence(gscIntelligence);
  const governance = buildGovernance({ ga: gaFreshness, gsc: gscFreshness, opportunities });
  const prioritization = prioritizeAnalyticsOpportunities(opportunities);
  const predictiveIntelligence = buildPredictiveStrategicIntelligence({
    opportunities,
    gsc: gscIntelligence,
    competitive: competitiveIntelligence,
  });
  const authorityMarketPosition = buildAuthorityMarketPosition({
    opportunities,
    gsc: gscIntelligence,
    external: externalCompetitiveIntelligence,
  });
  const recommendationIntelligence = buildRecommendationIntelligence({
    opportunities,
    authority: authorityMarketPosition,
    predictive: predictiveIntelligence,
  });
  const leadGenerationAuthorityIntelligence = buildLeadGenerationAuthorityIntelligence({
    opportunities,
    gsc: gscIntelligence,
    external: externalCompetitiveIntelligence,
    authority: authorityMarketPosition,
    recommendations: recommendationIntelligence,
  });
  const providerProvenance = [
    normalizeProviderProvenance({
      provider: 'google_analytics',
      sourceTable: 'canonical_events',
      source: correlation.provenance.ga,
      connected: correlation.provenance.ga === 'ga_canonical_ingestion',
      freshness: gaFreshness.classification,
      trustLevel: gaFreshness.trust_level,
    }),
    normalizeProviderProvenance({
      provider: 'google_search_console',
      sourceTable: 'platform_gsc_query_metrics',
      source: correlation.provenance.gsc,
      connected: correlation.provenance.gsc === 'gsc_canonical_ingestion',
      freshness: gscFreshness.classification,
      trustLevel: gscFreshness.trust_level,
    }),
  ];
  const lineage = buildAnalyticsLineage({
    companyId,
    canonicalFingerprint: canonical.fingerprint,
    snapshotVersion: 'ga_gsc_enterprise_v2',
    freshness: { ga: gaFreshness, gsc: gscFreshness },
    correlation,
    gsc: gscIntelligence,
  });

  const baseSnapshot = {
    company_id: companyId,
    generated_at: new Date().toISOString(),
    expires_at: nowIsoPlus(SNAPSHOT_TTL_MS),
    canonical_fingerprint: canonical.fingerprint,
    cache_status: 'computed' as const,
    lifecycle: buildSnapshotLifecycleMetadata({
      payload: {
        company_id: companyId,
        canonical_fingerprint: canonical.fingerprint,
        opportunities,
        competitiveIntelligence,
        competitorDiscovery,
        competitorBootstrap,
        serpQuerySeeding,
        externalCompetitiveIntelligence,
        unifiedCompetitorIntelligence,
        predictiveIntelligence,
        authorityMarketPosition,
        recommendationIntelligence,
        leadGenerationAuthorityIntelligence,
        prioritization,
        lineage,
      },
      parentFingerprint: null,
      warmed: false,
    }),
    provider_provenance: providerProvenance,
    freshness: { ga: gaFreshness, gsc: gscFreshness },
    correlation,
    gsc_intelligence: gscIntelligence,
    competitive_intelligence: competitiveIntelligence,
    competitor_discovery: competitorDiscovery,
    competitor_bootstrap: competitorBootstrap,
    serp_query_seeding: serpQuerySeeding,
    external_competitive_intelligence: externalCompetitiveIntelligence,
    unified_competitor_intelligence: unifiedCompetitorIntelligence,
    predictive_intelligence: predictiveIntelligence,
    authority_market_position: authorityMarketPosition,
    recommendation_intelligence: recommendationIntelligence,
    lead_generation_authority_intelligence: leadGenerationAuthorityIntelligence,
    executive_summary: buildAnalyticsExecutiveSummary({ governance, freshness: { ga: gaFreshness, gsc: gscFreshness }, opportunities }),
    opportunities,
    prioritization,
    attribution: buildAttribution(opportunities),
    governance,
    lineage,
    observability: {
      ingestion_history: ingestionHistory,
      provider_uptime: {
        ga_success_rate: successRate(ingestionHistory, 'ga4'),
        gsc_success_rate: successRate(ingestionHistory, 'gsc'),
      },
      quota_warnings: ingestionHistory
        .map((row) => row.error_message)
        .filter((message): message is string => Boolean(message && /(quota|429|rate|timeout|api)/i.test(message)))
        .slice(0, 5),
      expansion: {
        alerts: [],
        provider_sla: {
          ga_success_rate: successRate(ingestionHistory, 'ga4'),
          gsc_success_rate: successRate(ingestionHistory, 'gsc'),
          status: 'healthy',
        },
        cache_health: {
          status: 'miss',
          cache_status: 'computed',
        },
      },
    },
  };
  const snapshot: AnalyticsEnterpriseSnapshot = {
    ...baseSnapshot,
    observability: {
      ...baseSnapshot.observability,
      expansion: buildAnalyticsObservabilityExpansion(baseSnapshot as AnalyticsEnterpriseSnapshot),
    },
  };
  snapshot.lifecycle = buildSnapshotLifecycleMetadata({
    payload: snapshot,
    parentFingerprint: null,
    warmed: false,
  });
  assertSnapshotPayloadSafe(snapshot.lifecycle);

  memoryCache.set(companyId, snapshot);
  void persistSnapshot(snapshot).catch((error) => {
    console.warn('[analytics-enterprise-snapshot][persist-failed]', {
      company_id: companyId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return snapshot;
}

export async function refreshAnalyticsEnterpriseSnapshot(companyId: string): Promise<AnalyticsEnterpriseSnapshot> {
  memoryCache.delete(companyId);
  return getAnalyticsEnterpriseSnapshot(companyId);
}
