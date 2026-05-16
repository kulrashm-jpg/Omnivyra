import type { GscSeoIntelligence } from './gscSeoIntelligenceService';

export type CompetitiveSeoSignal = {
  type: 'keyword_gap' | 'query_overlap' | 'discoverability_gap' | 'serp_opportunity' | 'market_share_estimate' | 'competitor_momentum';
  title: string;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  evidence: Record<string, unknown>;
  provenance: 'gsc_canonical_ingestion' | 'insufficient_external_competitor_evidence';
};

export type AnalyticsCompetitiveIntelligence = {
  status: 'ready' | 'limited' | 'unavailable';
  summary: string;
  signals: CompetitiveSeoSignal[];
};

function confidenceFor(impressions: number): CompetitiveSeoSignal['confidence'] {
  if (impressions >= 500) return 'high';
  if (impressions >= 50) return 'medium';
  if (impressions > 0) return 'low';
  return 'none';
}

export function buildAnalyticsCompetitiveIntelligence(gsc: GscSeoIntelligence | null): AnalyticsCompetitiveIntelligence {
  if (!gsc || gsc.provenance.source !== 'gsc_canonical_ingestion') {
    return {
      status: 'unavailable',
      summary: 'Competitive SEO intelligence is unavailable because canonical GSC data is not available.',
      signals: [],
    };
  }

  const nonBranded = gsc.top_queries.filter((query) => query.classification !== 'branded');
  const totalNonBrandedImpressions = nonBranded.reduce((sum, query) => sum + query.impressions, 0);
  const signals: CompetitiveSeoSignal[] = [];

  for (const query of nonBranded.slice(0, 8)) {
    if (query.impressions >= 10 && query.avg_position > 10) {
      signals.push({
        type: 'keyword_gap',
        title: `Non-branded discoverability gap: ${query.query}`,
        score: Math.min(100, Math.round(Math.log10(query.impressions + 1) * 24 + Math.max(0, query.avg_position - 10))),
        confidence: confidenceFor(query.impressions),
        evidence: {
          query: query.query,
          impressions: query.impressions,
          clicks: query.clicks,
          avg_position: query.avg_position,
          classification: query.classification,
        },
        provenance: 'gsc_canonical_ingestion',
      });
    }

    if (query.impressions >= 10 && query.ctr < 0.02) {
      signals.push({
        type: 'serp_opportunity',
        title: `SERP click opportunity: ${query.query}`,
        score: Math.min(100, Math.round(Math.log10(query.impressions + 1) * 22 + Math.max(0, 0.02 - query.ctr) * 800)),
        confidence: confidenceFor(query.impressions),
        evidence: {
          query: query.query,
          impressions: query.impressions,
          ctr: query.ctr,
          avg_position: query.avg_position,
        },
        provenance: 'gsc_canonical_ingestion',
      });
    }
  }

  if (totalNonBrandedImpressions > 0) {
    const brandedImpressions = gsc.top_queries
      .filter((query) => query.classification === 'branded')
      .reduce((sum, query) => sum + query.impressions, 0);
    signals.push({
      type: 'market_share_estimate',
      title: 'Organic visibility is currently concentrated by observed query mix',
      score: Math.min(100, Math.round(totalNonBrandedImpressions / Math.max(1, totalNonBrandedImpressions + brandedImpressions) * 100)),
      confidence: confidenceFor(totalNonBrandedImpressions),
      evidence: {
        branded_impressions: brandedImpressions,
        nonbranded_impressions: totalNonBrandedImpressions,
        estimation_basis: 'observed_gsc_query_mix_not_external_serp_share',
      },
      provenance: 'gsc_canonical_ingestion',
    });
  }

  if (!signals.length) {
    return {
      status: 'limited',
      summary: 'Competitive SEO signals are limited; observed query volume is too small for confident benchmarking.',
      signals: [{
        type: 'query_overlap',
        title: 'Competitor query overlap cannot be verified from current canonical evidence',
        score: 0,
        confidence: 'none',
        evidence: {
          reason: 'No external competitor SERP dataset is present in the canonical analytics layer.',
        },
        provenance: 'insufficient_external_competitor_evidence',
      }],
    };
  }

  return {
    status: signals.some((signal) => signal.confidence === 'medium' || signal.confidence === 'high') ? 'ready' : 'limited',
    summary: 'Competitive SEO intelligence is derived from canonical GSC query visibility and explicitly excludes unsupported external competitor claims.',
    signals: signals
      .filter((signal) => signal.confidence !== 'none')
      .sort((a, b) => b.score - a.score)
      .slice(0, 10),
  };
}
