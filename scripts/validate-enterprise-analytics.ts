import { resolveOmnivyraWebsiteCompany } from '../backend/services/omnivyraWebsiteCompanyService';
import { getAnalyticsEnterpriseSnapshot } from '../backend/services/analyticsEnterpriseSnapshotService';
import { pruneExpiredAnalyticsSnapshots } from '../backend/services/analyticsSnapshotGovernanceService';
import { composeGrowthReport } from '../backend/services/growthReportService';
import { composePerformanceIntelligenceReport } from '../backend/services/performanceReportService';
import { evaluateAnalyticsMutationSafety } from '../backend/services/analyticsEnvironmentGuardService';
import { ENTERPRISE_PROVIDER_CONTRACTS } from '../backend/services/analyticsProviderNormalizationService';
import { getConfiguredSerpProviderHealth } from '../backend/services/serpAcquisitionService';

async function timed<T>(label: string, run: () => Promise<T>): Promise<{ label: string; ms: number; result: T }> {
  const start = performance.now();
  const result = await run();
  return { label, ms: Math.round(performance.now() - start), result };
}

async function main() {
  const company = await resolveOmnivyraWebsiteCompany();
  if (!company) throw new Error('No Omnivyra website company configured');

  const snapshotFirst = await timed('enterprise_snapshot_first', () => getAnalyticsEnterpriseSnapshot(company.id));
  const snapshotSecond = await timed('enterprise_snapshot_cached', () => getAnalyticsEnterpriseSnapshot(company.id));
  const concurrentSnapshots = await timed('enterprise_snapshot_concurrent', () => Promise.all([
    getAnalyticsEnterpriseSnapshot(company.id),
    getAnalyticsEnterpriseSnapshot(company.id),
    getAnalyticsEnterpriseSnapshot(company.id),
  ]));
  const growth = await timed('growth_report', () => composeGrowthReport(company.id));
  const performanceReport = await timed('performance_report', () => composePerformanceIntelligenceReport(company.id));
  const concurrentReports = await timed('performance_report_concurrent', () => Promise.all([
    composePerformanceIntelligenceReport(company.id),
    composePerformanceIntelligenceReport(company.id),
  ]));
  const prune = await timed('snapshot_prune', () => pruneExpiredAnalyticsSnapshots());

  const performance = performanceReport.result;
  const payload = {
    company_id: company.id,
    environment_guards: {
      ga4_ingestion: evaluateAnalyticsMutationSafety('ga4_ingestion'),
      gsc_ingestion: evaluateAnalyticsMutationSafety('gsc_ingestion'),
      snapshot_write: evaluateAnalyticsMutationSafety('snapshot_write'),
      competitor_bootstrap: evaluateAnalyticsMutationSafety('competitor_bootstrap'),
      serp_acquisition: evaluateAnalyticsMutationSafety('serp_acquisition'),
    },
    runtimes_ms: {
      enterprise_snapshot_first: snapshotFirst.ms,
      enterprise_snapshot_cached: snapshotSecond.ms,
      enterprise_snapshot_concurrent: concurrentSnapshots.ms,
      growth_report: growth.ms,
      performance_report: performanceReport.ms,
      performance_report_concurrent: concurrentReports.ms,
      performance_stages: performance.stage_timings_ms ?? null,
    },
    cache_validation: {
      first_status: snapshotFirst.result.cache_status,
      second_status: snapshotSecond.result.cache_status,
      same_fingerprint: snapshotFirst.result.canonical_fingerprint === snapshotSecond.result.canonical_fingerprint,
      concurrent_same_fingerprint: concurrentSnapshots.result.every((item) => item.canonical_fingerprint === snapshotSecond.result.canonical_fingerprint),
      lifecycle_integrity_valid: snapshotSecond.result.lifecycle.integrity_valid,
      payload_bytes: snapshotSecond.result.lifecycle.payload_bytes,
      prune,
    },
    governance: snapshotSecond.result.governance,
    executive_summary: snapshotSecond.result.executive_summary,
    competitive_intelligence: {
      status: snapshotSecond.result.competitive_intelligence.status,
      signal_count: snapshotSecond.result.competitive_intelligence.signals.length,
    },
    external_competitive_intelligence: {
      status: snapshotSecond.result.external_competitive_intelligence.status,
      signal_count: snapshotSecond.result.external_competitive_intelligence.signals.length,
      serp_snapshot_count: snapshotSecond.result.external_competitive_intelligence.freshness.serp_snapshot_count,
      competitor_domain_count: snapshotSecond.result.external_competitive_intelligence.freshness.competitor_domain_count,
    },
    unified_competitor_intelligence: {
      status: snapshotSecond.result.unified_competitor_intelligence.status,
      competitor_count: snapshotSecond.result.unified_competitor_intelligence.competitors.length,
      opportunity_count: snapshotSecond.result.unified_competitor_intelligence.opportunities.length,
      quality: snapshotSecond.result.unified_competitor_intelligence.quality,
      top_competitor: snapshotSecond.result.unified_competitor_intelligence.competitors[0] ?? null,
    },
    competitor_discovery: {
      status: snapshotSecond.result.competitor_discovery.status,
      discovered_count: snapshotSecond.result.competitor_discovery.discovered.length,
      suppressed: snapshotSecond.result.competitor_discovery.suppressed,
    },
    competitor_bootstrap: {
      status: snapshotSecond.result.competitor_bootstrap.status,
      persisted_count: snapshotSecond.result.competitor_bootstrap.persisted.length,
      suppressed_count: snapshotSecond.result.competitor_bootstrap.suppressed.length,
      error_count: snapshotSecond.result.competitor_bootstrap.errors.length,
    },
    serp_query_seeding: {
      status: snapshotSecond.result.serp_query_seeding.status,
      seeded: snapshotSecond.result.serp_query_seeding.seeded,
      candidate_seed_count: snapshotSecond.result.serp_query_seeding.seeds.length,
      error_count: snapshotSecond.result.serp_query_seeding.errors.length,
    },
    predictive_intelligence: {
      status: snapshotSecond.result.predictive_intelligence.status,
      signal_count: snapshotSecond.result.predictive_intelligence.signals.length,
      low_confidence_visible: snapshotSecond.result.predictive_intelligence.signals.some((signal) => signal.confidence === 'low' || signal.confidence === 'none'),
    },
    authority_market_position: {
      status: snapshotSecond.result.authority_market_position.status,
      authority_score: snapshotSecond.result.authority_market_position.domain_authority_trajectory_score,
      market_position_score: snapshotSecond.result.authority_market_position.market_position_score,
      visibility_moat: snapshotSecond.result.authority_market_position.visibility_moat,
    },
    recommendation_intelligence: {
      status: snapshotSecond.result.recommendation_intelligence.status,
      recommendation_count: snapshotSecond.result.recommendation_intelligence.recommendations.length,
      top_recommendation: snapshotSecond.result.recommendation_intelligence.recommendations[0] ?? null,
    },
    lead_generation_authority_intelligence: {
      status: snapshotSecond.result.lead_generation_authority_intelligence.status,
      organic_acquisition_opportunity_score: snapshotSecond.result.lead_generation_authority_intelligence.organic_acquisition_opportunity_score,
      signal_count: snapshotSecond.result.lead_generation_authority_intelligence.signals.length,
      external_serp_backed: snapshotSecond.result.lead_generation_authority_intelligence.signals
        .some((signal) => signal.provenance.serp === 'external_serp_warehouse'),
    },
    prioritization: {
      prioritized_count: snapshotSecond.result.prioritization.prioritized.length,
      suppressed_count: snapshotSecond.result.prioritization.suppressed_count,
      top_reason: snapshotSecond.result.prioritization.prioritized[0]?.priority_reason ?? null,
    },
    observability_expansion: snapshotSecond.result.observability.expansion,
    lineage: {
      lineage_id: snapshotSecond.result.lineage.lineage_id,
      evidence_refs: snapshotSecond.result.lineage.evidence_refs.length,
      ruleset: snapshotSecond.result.lineage.reproducibility.deterministic_ruleset,
    },
    provider_contracts: Object.fromEntries(
      Object.entries(ENTERPRISE_PROVIDER_CONTRACTS).map(([key, value]) => [key, value.canonical_status]),
    ),
    serp_provider_health: getConfiguredSerpProviderHealth(),
    opportunity_count: snapshotSecond.result.opportunities.length,
    attribution: {
      organic_conversion_pages: snapshotSecond.result.attribution.organic_conversion_pages.length,
      low_conversion_high_traffic_pages: snapshotSecond.result.attribution.low_conversion_high_traffic_pages.length,
      assisted_conversion_visibility: snapshotSecond.result.attribution.assisted_conversion_visibility.length,
    },
    growth_report: {
      search_source: growth.result.search_analytics.source,
      has_enterprise_snapshot: Boolean(growth.result.enterprise_snapshot),
      health_status: growth.result.analytics_health?.health.status ?? null,
      enterprise_sections: growth.result.sections
        .map((section) => section.section_name)
        .filter((name) => /Enterprise|Predictive|Lead-Generation|Competitor/i.test(name)),
    },
    performance_report: {
      status: performance.status,
      has_enterprise_snapshot: Boolean(performance.enterprise_snapshot),
      has_health: Boolean(performance.analytics_health),
      has_enterprise_market_html: /Enterprise Market Intelligence/.test(performance.html),
      concurrency: performance.concurrency ?? null,
      concurrent_reused: concurrentReports.result.some((item) => item.concurrency?.reused_inflight),
      warning_count: performance.status === 'ready' || performance.status === 'partial' ? performance.warnings.length : 0,
    },
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
