import { createHash } from 'crypto';
import type { AnalyticsFreshnessSnapshot } from './analyticsFreshnessService';
import type { AnalyticsCorrelationContext } from './analyticsCorrelationService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';
import type { NormalizedProviderProvenance } from './analyticsProviderNormalizationService';

export type AnalyticsLineageEvidenceRef = {
  id: string;
  provider: NormalizedProviderProvenance['provider'];
  source_table: string;
  source_field: string;
  metric_window: string;
  freshness: AnalyticsFreshnessSnapshot['classification'];
};

export type AnalyticsLineageSummary = {
  lineage_id: string;
  generated_at: string;
  canonical_fingerprint: string;
  evidence_refs: AnalyticsLineageEvidenceRef[];
  reproducibility: {
    snapshot_version: string;
    deterministic_ruleset: string;
    unsupported_claim_policy: 'suppress_weak_claims';
  };
};

function lineageId(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24);
}

export function buildAnalyticsLineage(input: {
  companyId: string;
  canonicalFingerprint: string;
  snapshotVersion: string;
  freshness: { ga: AnalyticsFreshnessSnapshot; gsc: AnalyticsFreshnessSnapshot };
  correlation: AnalyticsCorrelationContext;
  gsc: GscSeoIntelligence | null;
}): AnalyticsLineageSummary {
  const refs: AnalyticsLineageEvidenceRef[] = [
    {
      id: 'ga-events-30d',
      provider: 'google_analytics',
      source_table: 'canonical_events',
      source_field: 'event_name,event_count,page_url,session_id',
      metric_window: 'last_30_days',
      freshness: input.freshness.ga.classification,
    },
    {
      id: 'gsc-query-page-30d',
      provider: 'google_search_console',
      source_table: 'platform_gsc_query_metrics',
      source_field: 'query,page_url,clicks,impressions,ctr,avg_position',
      metric_window: 'last_30_days',
      freshness: input.freshness.gsc.classification,
    },
  ];

  if (input.correlation.insights.length > 0) {
    refs.push({
      id: 'ga-gsc-correlation',
      provider: 'google_analytics',
      source_table: 'derived:analyticsCorrelationService',
      source_field: 'page_url,visits,events,conversions,impressions,clicks',
      metric_window: 'last_30_days',
      freshness: input.freshness.ga.classification,
    });
  }

  if (input.gsc?.top_queries.length) {
    refs.push({
      id: 'gsc-seo-intelligence',
      provider: 'google_search_console',
      source_table: 'derived:gscSeoIntelligenceService',
      source_field: 'query_classification,movement,opportunity_score',
      metric_window: 'rolling_30_days_vs_previous',
      freshness: input.freshness.gsc.classification,
    });
  }

  return {
    lineage_id: lineageId({
      companyId: input.companyId,
      canonicalFingerprint: input.canonicalFingerprint,
      refs: refs.map((ref) => ref.id),
    }),
    generated_at: new Date().toISOString(),
    canonical_fingerprint: input.canonicalFingerprint,
    evidence_refs: refs,
    reproducibility: {
      snapshot_version: input.snapshotVersion,
      deterministic_ruleset: 'ga_gsc_enterprise_v2',
      unsupported_claim_policy: 'suppress_weak_claims',
    },
  };
}
