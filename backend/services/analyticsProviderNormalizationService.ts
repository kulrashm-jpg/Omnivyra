import type { AnalyticsFreshnessClassification, AnalyticsTrustLevel } from './analyticsFreshnessService';

export type AnalyticsProviderKey =
  | 'google_analytics'
  | 'google_search_console'
  | 'google_ads'
  | 'meta_ads'
  | 'bing_webmaster'
  | 'linkedin'
  | 'youtube_analytics';

export type NormalizedProviderProvenance = {
  provider: AnalyticsProviderKey;
  source_table: string | null;
  source: string;
  connected: boolean;
  freshness: AnalyticsFreshnessClassification;
  trust_level: AnalyticsTrustLevel;
  degraded_state: 'live' | 'fresh' | 'aging' | 'stale' | 'failed' | 'unavailable';
  evidence_scope: 'behavior' | 'search' | 'paid_media' | 'social' | 'video' | 'unknown';
};

export type NormalizedOpportunityContract = {
  id: string;
  provider: AnalyticsProviderKey;
  category: string;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  evidence: Record<string, unknown>;
  provenance: NormalizedProviderProvenance[];
};

export const ENTERPRISE_PROVIDER_CONTRACTS: Record<AnalyticsProviderKey, {
  display_name: string;
  evidence_scope: NormalizedProviderProvenance['evidence_scope'];
  canonical_status: 'implemented' | 'foundation_only';
}> = {
  google_analytics: {
    display_name: 'Google Analytics',
    evidence_scope: 'behavior',
    canonical_status: 'implemented',
  },
  google_search_console: {
    display_name: 'Google Search Console',
    evidence_scope: 'search',
    canonical_status: 'implemented',
  },
  google_ads: {
    display_name: 'Google Ads',
    evidence_scope: 'paid_media',
    canonical_status: 'foundation_only',
  },
  meta_ads: {
    display_name: 'Meta Ads',
    evidence_scope: 'paid_media',
    canonical_status: 'foundation_only',
  },
  bing_webmaster: {
    display_name: 'Bing Webmaster',
    evidence_scope: 'search',
    canonical_status: 'foundation_only',
  },
  linkedin: {
    display_name: 'LinkedIn',
    evidence_scope: 'social',
    canonical_status: 'foundation_only',
  },
  youtube_analytics: {
    display_name: 'YouTube Analytics',
    evidence_scope: 'video',
    canonical_status: 'foundation_only',
  },
};

export function normalizeProviderProvenance(input: {
  provider: AnalyticsProviderKey;
  sourceTable?: string | null;
  source?: string | null;
  connected?: boolean;
  freshness: AnalyticsFreshnessClassification;
  trustLevel: AnalyticsTrustLevel;
}): NormalizedProviderProvenance {
  const contract = ENTERPRISE_PROVIDER_CONTRACTS[input.provider];
  return {
    provider: input.provider,
    source_table: input.sourceTable ?? null,
    source: input.source ?? contract.canonical_status,
    connected: Boolean(input.connected),
    freshness: input.freshness,
    trust_level: input.trustLevel,
    degraded_state: input.freshness === 'live' || input.freshness === 'fresh'
      ? input.freshness
      : input.freshness,
    evidence_scope: contract.evidence_scope,
  };
}
