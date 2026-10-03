/**
 * WP-13 — the company's own radar baseline is not a measurement of zero.
 *
 * `buildCompetitorVisuals` builds `competitor_positioning_radar.user` from five
 * `number | null` axes on `visual_intelligence.seo_capability_radar` and
 * `geo_aeo_visuals.ai_answer_presence_radar`. Every one of those axes carries a sibling
 * availability tag in the same payload (`data_source_strength`, `axis_states`), so the
 * producer already states when an axis was never observed.
 *
 * `buildCompetitorIntelligenceSummary` then subtracts that user baseline from the leading
 * competitor to publish the keyword / authority / answer gaps, ranks those gaps to choose the
 * primary gap narrative and its recommended actions, and averages the baseline to decide
 * `competitive_position`. A `?? 0` on an unavailable axis therefore does not merely draw a
 * point at the origin: it publishes the competitor's whole absolute score as a measured gap,
 * promotes that fabricated gap to "primary", and drags the position verdict toward `lagging`.
 *
 * This is the same defect WP-12 removed from `comparison.company`
 * (`EMPTY_COMPARISON_METRICS`) and WP-15 removed from the standing average — a zeroed company
 * baseline — surviving in a second file.
 */
import {
  buildCompetitorIntelligenceSummary,
  buildCompetitorVisuals,
  deriveUserRadarAxisValues,
} from '../../services/snapshotReport/competitorSummaryHelpers';
import type { CompetitorIntelligenceResult } from '../../services/reportCompetitorIntelligenceService';
import type { SnapshotReport } from '../../services/snapshotReportTypes';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';

/** One competitor that genuinely passes `hasPassedFinalCompetitorGate` — no mock. */
function gatePassingCompetitor() {
  return {
    name: 'RivalCo',
    domain: 'rival.co',
    category: 'Marketing analytics',
    tags: [],
    classification: 'direct',
    source: 'serp_live',
    relevance_score: 72,
    problem_overlap: 0.8,
    icp_overlap: 0.7,
    market_overlap: 0.7,
    revenue_tier: 'mid',
    product_depth: 60,
    authority_score: 55,
    authority_signals: { domain_rating: 55 },
    final_score: 0.82,
    enrichment: { confidence_score: 0.9 },
    enrichment_confidence_score: 0.9,
    positioning: {
      threat_level: 'medium',
      strengths_vs_company: ['broader content library'],
      weaknesses_vs_company: ['weaker onboarding'],
      differentiation: 'Publishes far more comparison content.',
    },
    score_card: {
      overallScore: 70,
      dimensions: {
        productServiceFit: 70,
        workflowFit: 65,
        useCaseFit: 65,
        customerEvaluationFit: 60,
      },
    },
  };
}

/**
 * The competitor side is fully observed; only the COMPANY side has unavailable axes.
 * `authority` (backlinks) and `ai answer coverage` are null — exactly the two axes the
 * producers in `visualIntelligenceHelpers.ts` null out when no backlink source is wired and
 * no answer-coverage queries were resolved.
 */
function buildParams(overrides?: {
  backlinks_score?: number | null;
  answer_coverage_score?: number | null;
}) {
  const competitor = gatePassingCompetitor();
  const competitorIntelligence = {
    detected_competitors: [competitor],
    comparison: {
      company: null,
      competitors: [
        {
          competitor: { name: 'RivalCo', domain: 'rival.co' },
          metrics: {
            content_depth: 70,
            authority_score: 80,
            publishing_frequency: null,
            engagement_score: null,
            seo_coverage: 60,
            geo_presence: null,
            aeo_readiness: 50,
          },
          deltas_vs_company: null,
        },
      ],
    },
    generated_gaps: [],
    keyword_gap: null,
    answer_gap: null,
    discovery_metadata: { is_fallback_used: false, serp_status: 'live' },
  } as unknown as CompetitorIntelligenceResult;

  const visualIntelligence = {
    seo_capability_radar: {
      technical_seo_score: 68,
      keyword_research_score: 64,
      rank_tracking_score: null,
      backlinks_score: overrides?.backlinks_score === undefined ? null : overrides.backlinks_score,
      competitor_intelligence_score: null,
      content_quality_score: 72,
      confidence: 'medium',
    },
    opportunity_coverage_matrix: { opportunities: [] },
  } as unknown as SnapshotReport['visual_intelligence'];

  const geoAeoVisuals = {
    ai_answer_presence_radar: {
      answer_coverage_score:
        overrides?.answer_coverage_score === undefined ? null : overrides.answer_coverage_score,
    },
    query_answer_coverage_map: { queries: [] },
  } as unknown as SnapshotReport['geo_aeo_visuals'];

  return {
    competitorIntelligence,
    visualIntelligence,
    geoAeoVisuals,
    decisions: [] as PersistedDecisionObject[],
  };
}

describe('WP-13 — company radar baseline integrity', () => {
  it('plots the competitor the fixture is built around (the path under test is reachable)', () => {
    const visuals = buildCompetitorVisuals(buildParams());
    expect(visuals.competitor_positioning_radar.competitors).toHaveLength(1);
    expect(visuals.competitor_positioning_radar.competitors[0].authority_score).toBe(80);
  });

  it('never states a gap against an unobserved company axis', () => {
    const params = buildParams();
    const competitorVisuals = buildCompetitorVisuals(params);
    const summary = buildCompetitorIntelligenceSummary({
      competitorIntelligence: params.competitorIntelligence,
      competitorVisuals,
      userAxisValues: deriveUserRadarAxisValues(params),
    });
    expect(summary).not.toBeNull();
    // Authority is unavailable on the company side, so the competitor's absolute 80 must NOT
    // be published as an 80-point measured authority gap, nor promoted to the primary gap.
    expect(summary!.primary_gap.type).not.toBe('authority_gap');
    expect(summary!.primary_gap.type).toBe('keyword_gap');
    expect(summary!.primary_gap.severity).toBe('low');
  });

  it('does not let an unobserved axis drag the position verdict toward lagging', () => {
    const params = buildParams();
    const competitorVisuals = buildCompetitorVisuals(params);
    const summary = buildCompetitorIntelligenceSummary({
      competitorIntelligence: params.competitorIntelligence,
      competitorVisuals,
      userAxisValues: deriveUserRadarAxisValues(params),
    });
    // Measured axes only: user 72/64/68 (avg 68) vs competitor 70/60/60 (avg 63.3).
    // The pre-fix average was avg(72,64,0,68,0) = 40.8 against a five-axis 64 → 'lagging'.
    expect(summary!.competitive_position).toBe('competitive');
  });

  it('is unchanged when every axis is genuinely observed', () => {
    const params = buildParams({ backlinks_score: 30, answer_coverage_score: 20 });
    const competitorVisuals = buildCompetitorVisuals(params);
    expect(competitorVisuals.competitor_positioning_radar.user.authority_score).toBe(30);
    const summary = buildCompetitorIntelligenceSummary({
      competitorIntelligence: params.competitorIntelligence,
      competitorVisuals,
      userAxisValues: deriveUserRadarAxisValues(params),
    });
    // authorityGap 80-30 = 50 is the largest real gap and still wins.
    expect(summary!.primary_gap.type).toBe('authority_gap');
    expect(summary!.competitive_position).toBe('lagging');
  });

  it('a genuinely measured zero is still a measurement', () => {
    const params = buildParams({ backlinks_score: 0, answer_coverage_score: 0 });
    const competitorVisuals = buildCompetitorVisuals(params);
    const summary = buildCompetitorIntelligenceSummary({
      competitorIntelligence: params.competitorIntelligence,
      competitorVisuals,
      userAxisValues: deriveUserRadarAxisValues(params),
    });
    expect(summary!.primary_gap.type).toBe('authority_gap');
    expect(summary!.primary_gap.severity).toBe('critical');
  });
});
