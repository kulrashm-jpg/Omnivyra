import type { AuthorityMarketPosition } from './authorityMarketPositionService';
import type { ExternalCompetitiveIntelligence } from './externalCompetitiveIntelligenceService';
import type { GscSeoIntelligence } from './gscSeoIntelligenceService';
// PRODUCT-RESTORE-001 Phase 1: explicit domain name (was the ambiguous `RecommendationIntelligence`).
import type { SeoGrowthRecommendationIntelligence } from './recommendationIntelligenceService';
import type { EnterpriseOpportunity } from './analyticsEnterpriseSnapshotService';

export type LeadGenerationAuthoritySignal = {
  id: string;
  type:
    | 'authority_building_priority'
    | 'discoverability_weakness'
    | 'search_intent_opportunity'
    | 'conversion_authority_gap'
    | 'trust_content_opportunity'
    | 'lead_generation_search_gap';
  title: string;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  recommendation: string;
  evidence_refs: string[];
  evidence: Record<string, unknown>;
  provenance: {
    ga: 'ga_canonical_ingestion' | 'missing';
    gsc: 'gsc_canonical_ingestion' | 'missing';
    serp: 'external_serp_warehouse' | 'missing';
  };
};

export type LeadGenerationAuthorityIntelligence = {
  status: 'ready' | 'limited' | 'unavailable';
  organic_acquisition_opportunity_score: number;
  summary: string;
  signals: LeadGenerationAuthoritySignal[];
};

function confidence(score: number, evidenceCount: number): LeadGenerationAuthoritySignal['confidence'] {
  if (score >= 75 && evidenceCount >= 2) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildLeadGenerationAuthorityIntelligence(params: {
  opportunities: EnterpriseOpportunity[];
  gsc: GscSeoIntelligence | null;
  external: ExternalCompetitiveIntelligence;
  authority: AuthorityMarketPosition;
  recommendations: SeoGrowthRecommendationIntelligence;
}): LeadGenerationAuthorityIntelligence {
  const signals: LeadGenerationAuthoritySignal[] = [];
  const highIntentQueries = (params.gsc?.top_queries ?? [])
    .filter((query) => query.classification === 'commercial' || query.classification === 'informational')
    .filter((query) => query.impressions >= 10)
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 5);

  for (const query of highIntentQueries) {
    const score = clamp(query.opportunity_score * 0.65 + Math.min(100, query.impressions / 8) * 0.25 + Math.max(0, 20 - query.avg_position) * 0.5);
    if (score < 45) continue;
    signals.push({
      id: `lead-search-gap:${query.query}`,
      type: 'lead_generation_search_gap',
      title: `Lead-generation search gap: ${query.query}`,
      priority_score: score,
      confidence: confidence(score, 1),
      recommendation: 'Build or strengthen a landing-page path that matches this observed search intent and moves visitors toward a clear conversion step.',
      evidence_refs: [`gsc:query:${query.query}`],
      evidence: {
        query: query.query,
        impressions: query.impressions,
        clicks: query.clicks,
        ctr: query.ctr,
        avg_position: query.avg_position,
        classification: query.classification,
      },
      provenance: {
        ga: 'missing',
        gsc: 'gsc_canonical_ingestion',
        serp: params.external.status === 'ready' ? 'external_serp_warehouse' : 'missing',
      },
    });
  }

  for (const opportunity of params.opportunities.filter((item) => item.category === 'conversion' || item.category === 'discoverability').slice(0, 5)) {
    const hasGa = opportunity.provenance.ga === 'ga_canonical_ingestion';
    const hasGsc = opportunity.provenance.gsc === 'gsc_canonical_ingestion';
    const score = clamp(opportunity.score + (hasGa && hasGsc ? 8 : 0));
    signals.push({
      id: `conversion-authority:${opportunity.id}`,
      type: hasGa && hasGsc ? 'conversion_authority_gap' : 'discoverability_weakness',
      title: opportunity.title,
      priority_score: score,
      confidence: confidence(score, Number(hasGa) + Number(hasGsc)),
      recommendation: hasGa && hasGsc
        ? 'Use the page as a conversion-authority target: improve proof, CTA clarity, and search-intent alignment together.'
        : 'Treat this as a directional discoverability weakness until both behavioral and search evidence are present.',
      evidence_refs: [opportunity.id],
      evidence: opportunity.evidence,
      provenance: {
        ga: opportunity.provenance.ga,
        gsc: opportunity.provenance.gsc,
        serp: params.external.status === 'ready' ? 'external_serp_warehouse' : 'missing',
      },
    });
  }

  for (const rec of params.recommendations.recommendations.slice(0, 3)) {
    const score = clamp(rec.priority_score);
    if (score < 50) continue;
    signals.push({
      id: `authority-priority:${rec.id}`,
      type: 'authority_building_priority',
      title: rec.title,
      priority_score: score,
      confidence: rec.confidence,
      recommendation: rec.action,
      evidence_refs: rec.evidence_refs,
      evidence: {
        business_impact: rec.business_impact,
        expected_authority_gain: rec.expected_authority_gain,
        estimated_discoverability_impact: rec.estimated_discoverability_impact,
      },
      provenance: {
        ga: 'missing',
        gsc: 'gsc_canonical_ingestion',
        serp: params.external.status === 'ready' ? 'external_serp_warehouse' : 'missing',
      },
    });
  }

  for (const signal of params.external.signals.filter((item) => item.provenance === 'external_serp_warehouse').slice(0, 4)) {
    signals.push({
      id: `serp-authority:${signal.type}:${signal.title}`,
      type: 'trust_content_opportunity',
      title: signal.title,
      priority_score: clamp(signal.score),
      confidence: signal.confidence === 'none' ? 'low' : signal.confidence,
      recommendation: 'Use the observed SERP competitor evidence to decide whether this topic needs stronger proof, comparison, or authority-building content.',
      evidence_refs: [`serp:${signal.type}`],
      evidence: signal.evidence,
      provenance: {
        ga: 'missing',
        gsc: 'missing',
        serp: 'external_serp_warehouse',
      },
    });
  }

  const ranked = signals
    .filter((signal) => signal.priority_score >= 45)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 12);
  const average = ranked.length
    ? clamp(ranked.reduce((sum, signal) => sum + signal.priority_score, 0) / ranked.length)
    : 0;

  return {
    status: ranked.length >= 3 ? 'ready' : ranked.length ? 'limited' : 'unavailable',
    organic_acquisition_opportunity_score: average,
    summary: params.external.status === 'ready'
      ? 'Lead-generation authority intelligence is using GA/GSC plus observed external SERP evidence.'
      : 'Lead-generation authority intelligence is using canonical GA/GSC evidence; external SERP validation is still limited.',
    signals: ranked,
  };
}
