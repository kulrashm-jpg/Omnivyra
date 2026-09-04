/**
 * Report 1 — evidence-discipline governance (Phase 2).
 *
 * These tests exist to prevent ONE class of product defect: the report asserting more than
 * its evidence supports. They are deliberately written as governance assertions rather than
 * unit tests of implementation detail — if a future change reintroduces a confident claim
 * behind an unmeasured score, these must fail.
 */
import {
  buildGeoAeoExecutiveSummary,
  buildGeoAeoVisuals,
} from '../../services/snapshotReport/geoAeoSummaryHelpers';
import {
  COMPETITOR_MIN_EVIDENCE,
  deriveCompetitorRelations,
} from '../../services/competitorRelationModel';
import {
  isReport1Source,
  provenanceForSource,
  summarizeProvenance,
} from '../../services/evidenceProvenance';
import {
  ACTION_PRIORITY,
  EFFORT_DIVISOR,
  HIGH_IMPACT_THRESHOLD,
  IMPACT_SCALE,
  effortDivisor,
} from '../../services/canonicalReport/scoringGovernance';
import { scoreContentIntelligence } from '../../services/websiteIntelligence/contentIntelligenceEngine';
import type { CompetitorDimensionScores } from '../../../types/competitor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** GEO/AEO visuals with NO measured axis — the "we know nothing about AI" state. */
function visualsWithNoEvidence() {
  return buildGeoAeoVisuals({ publicAudit: null });
}

/** GEO/AEO visuals from a public audit with real measured axes. */
function visualsWithEvidence(overrides: Record<string, number | null> = {}) {
  return buildGeoAeoVisuals({
    publicAudit: {
      geo_aeo_context: {
        queries: [
          { query: 'what is acme', coverage: 'missing', answer_quality_score: 20 },
          { query: 'acme pricing', coverage: 'full', answer_quality_score: 70 },
        ],
        entities: [],
        answer_coverage_score: 30,
        entity_clarity_score: 40,
        topical_authority_score: 50,
        citation_readiness_score: 35,
        content_structure_score: 45,
        freshness_score: 60,
        answerable_content_pct: 50,
        structured_content_pct: 55,
        citation_ready_pct: 35,
        ...overrides,
      },
    } as never,
  });
}

const STRONG_DIMENSIONS: CompetitorDimensionScores = {
  productServiceFit: 85, workflowFit: 80, useCaseFit: 75,
  icpFit: 82, customerEvaluationFit: 78, revenueScaleFit: 70,
  employeeScaleFit: 70, geographyFit: 90, seoIntentFit: 60,
};

const PRODUCT_ONLY_DIMENSIONS: CompetitorDimensionScores = {
  // Substantial functional overlap, but sold to a different segment — the
  // "Semrush / HubSpot" case a single blended score used to erase.
  productServiceFit: 88, workflowFit: 82, useCaseFit: 80,
  icpFit: 20, customerEvaluationFit: 18, revenueScaleFit: 25,
  employeeScaleFit: 20, geographyFit: 30, seoIntentFit: 70,
};

// ── AI / GEO-AEO discipline ───────────────────────────────────────────────────

describe('Report 1 evidence discipline — GEO/AEO', () => {
  it('no AI evidence: score abstains, primary gap is null, actions are empty', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithNoEvidence() });

    expect(summary.overall_ai_visibility_score).toBeNull();
    expect(summary.overall_ai_visibility_score_state).toBe('insufficient_signal');
    // The regression this whole phase exists for: previously this asserted
    // "Answer coverage is too thin for AI visibility" with zero evidence.
    expect(summary.primary_gap).toBeNull();
    expect(summary.top_3_actions).toEqual([]);
  });

  it('no AI evidence: emits no AI deficit language anywhere in the section', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithNoEvidence() });
    const serialized = JSON.stringify(summary).toLowerCase();
    for (const claim of ['too thin', 'is limiting', 'below what', 'still missing coverage']) {
      expect(serialized).not.toContain(claim);
    }
  });

  it('measured AI evidence: gap and actions are derived from the measured deficits', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithEvidence() });

    expect(summary.overall_ai_visibility_score).not.toBeNull();
    expect(summary.primary_gap).not.toBeNull();
    expect(summary.top_3_actions.length).toBeGreaterThan(0);
    expect(summary.top_3_actions.length).toBeLessThanOrEqual(3);
    // Every action must cite the measured value that caused it — not generic advice.
    for (const action of summary.top_3_actions) {
      expect(action.reasoning).toMatch(/measured at \d+\/100/);
    }
  });

  it('measured AI evidence: only axes BELOW the deficit threshold produce actions', () => {
    // Every axis healthy → nothing to recommend, even though evidence exists.
    const healthy = buildGeoAeoExecutiveSummary({
      geoAeoVisuals: visualsWithEvidence({
        answer_coverage_score: 90, entity_clarity_score: 88,
        citation_readiness_score: 92, content_structure_score: 85,
        topical_authority_score: 90,
      }),
    });
    expect(healthy.overall_ai_visibility_score).not.toBeNull();
    expect(healthy.top_3_actions).toEqual([]);
  });

  it('partial AI evidence: unmeasured axes never generate an action', () => {
    const summary = buildGeoAeoExecutiveSummary({
      geoAeoVisuals: visualsWithEvidence({
        answer_coverage_score: 20,
        entity_clarity_score: null,
        citation_readiness_score: null,
        content_structure_score: null,
      }),
    });
    const titles = summary.top_3_actions.map((a) => a.action_title).join(' | ');
    expect(titles).toContain('direct-answer');
    expect(titles).not.toContain('entity mentions');
    expect(titles).not.toContain('citation-ready');
  });
});

// ── Competitor discipline ─────────────────────────────────────────────────────

describe('Report 1 evidence discipline — competitors', () => {
  it('no dimensions: no score, no classification, surfaced as Discovered — Unclassified', () => {
    const relations = deriveCompetitorRelations({ dimensions: null, evidenceCount: 0 });

    expect(relations.product.value).toBeNull();
    expect(relations.market.value).toBeNull();
    expect(relations.productRelation).toBe('unknown');
    expect(relations.marketRelation).toBe('unknown');
    expect(relations.compositeRelation).toBe('unclassified');
    expect(relations.abstained).toBe(true);
    expect(relations.label).toBe('Discovered — Unclassified');
  });

  it('below the evidence minimum: abstains even with strong dimensions', () => {
    const relations = deriveCompetitorRelations({
      dimensions: STRONG_DIMENSIONS,
      evidenceCount: COMPETITOR_MIN_EVIDENCE - 1,
      hasStrongSource: true,
    });

    expect(relations.abstained).toBe(true);
    expect(relations.product.value).toBeNull();
    expect(relations.market.value).toBeNull();
    expect(relations.compositeRelation).toBe('unclassified');
    expect(relations.abstainReason).toContain('below the');
    // The evidence trace is still carried — abstention is not amnesia.
    expect(relations.product.evidence_count).toBe(COMPETITOR_MIN_EVIDENCE - 1);
  });

  it('strong evidence on both axes: direct competitor', () => {
    const relations = deriveCompetitorRelations({
      dimensions: STRONG_DIMENSIONS, evidenceCount: 3, hasStrongSource: true,
    });

    expect(relations.abstained).toBe(false);
    expect(relations.product.state).toBe('measured');
    expect(relations.productRelation).toBe('direct');
    expect(relations.marketRelation).toBe('same_segment');
    expect(relations.compositeRelation).toBe('direct');
  });

  it('product overlap without market overlap is STRATEGIC, not direct', () => {
    const relations = deriveCompetitorRelations({
      dimensions: PRODUCT_ONLY_DIMENSIONS, evidenceCount: 3, hasStrongSource: true,
    });

    // The two views must disagree — that is the whole point of splitting them.
    expect(relations.productRelation).toBe('direct');
    expect(relations.marketRelation).toBe('different');
    expect(relations.compositeRelation).toBe('strategic');
    expect(relations.product.value).toBeGreaterThan(relations.market.value as number);
  });

  it('without a strong source the axes are inferred, never measured', () => {
    const relations = deriveCompetitorRelations({
      dimensions: STRONG_DIMENSIONS, evidenceCount: 3, hasStrongSource: false,
    });
    expect(relations.product.state).toBe('inferred');
    expect(relations.market.state).toBe('inferred');
  });

  it('classification is not derived from position — identical inputs give identical output', () => {
    const first = deriveCompetitorRelations({ dimensions: STRONG_DIMENSIONS, evidenceCount: 3, hasStrongSource: true });
    const second = deriveCompetitorRelations({ dimensions: STRONG_DIMENSIONS, evidenceCount: 3, hasStrongSource: true });
    expect(first.compositeRelation).toBe(second.compositeRelation);
    expect(first.product.value).toBe(second.product.value);
  });
});

// ── Provenance boundary ───────────────────────────────────────────────────────

describe('Report 1 evidence discipline — provenance boundary', () => {
  it('public sources are Report 1 eligible', () => {
    for (const source of ['crawler', 'public_audit', 'wikidata', 'llm_probe', 'competitor_intelligence'] as const) {
      expect(provenanceForSource(source)).toBe('PUBLIC_OBSERVED');
      expect(isReport1Source(source)).toBe(true);
    }
  });

  it('connected + Omnivyra-owned sources are NOT Report 1 eligible', () => {
    expect(provenanceForSource('gsc')).toBe('CONNECTED_SOURCE');
    expect(isReport1Source('gsc')).toBe(false);
    expect(provenanceForSource('trajectory_history')).toBe('OMNIVYRA_OBSERVED');
    expect(isReport1Source('trajectory_history')).toBe(false);
  });

  it('an untagged source is UNAVAILABLE, never mistaken for a measurement', () => {
    expect(provenanceForSource('unspecified')).toBe('UNAVAILABLE');
  });

  it('summarizeProvenance flags private leakage into a public report', () => {
    expect(summarizeProvenance(['crawler', 'wikidata']).report1Clean).toBe(true);
    const leaked = summarizeProvenance(['crawler', 'gsc']);
    expect(leaked.report1Clean).toBe(false);
    expect(leaked.privateSources).toEqual(['gsc']);
  });
});

// ── Scoring governance ────────────────────────────────────────────────────────

describe('Report 1 evidence discipline — scoring governance', () => {
  it('the high-impact threshold is internally consistent', () => {
    expect(IMPACT_SCALE.high).toBe(ACTION_PRIORITY.high_impact);
    expect(IMPACT_SCALE.high).toBe(HIGH_IMPACT_THRESHOLD);
  });

  it('effort divisors are monotonic and default safely', () => {
    expect(EFFORT_DIVISOR.low).toBeLessThan(EFFORT_DIVISOR.medium);
    expect(EFFORT_DIVISOR.medium).toBeLessThan(EFFORT_DIVISOR.high);
    expect(effortDivisor(null)).toBe(EFFORT_DIVISOR.medium);
    expect(effortDivisor(undefined)).toBe(EFFORT_DIVISOR.medium);
  });

  it('effort changes ranking: equal impact+confidence, lower effort ranks higher', () => {
    const impactConfidence = 60 * 0.58 + 0.8 * 100 * 0.42;
    expect(impactConfidence / effortDivisor('low'))
      .toBeGreaterThan(impactConfidence / effortDivisor('high'));
  });
});

// ── Content scoring methodology ───────────────────────────────────────────────

describe('Report 1 evidence discipline — content scoring', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    id: 'p1', url: 'https://acme.test/', title: 'Acme', meta_title: 'Acme', meta_description: 'Acme site',
    page_type: 'home', headings: [{ level: 1, text: 'Acme' }], ctas: [{ text: 'Get started' }],
    internal_link_count: 5, http_status: 200, last_crawled_at: '2026-09-01T00:00:00.000Z',
    crawl_metadata: null, ...over,
  }) as never;

  it('no pages: score abstains rather than scoring zero', () => {
    const result = scoreContentIntelligence([], [], Date.now());
    expect(result.contentScore).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('absent trust pages score 0, not an arbitrary floor', () => {
    const result = scoreContentIntelligence([page()], [], Date.now());
    for (const key of ['testimonials', 'case_studies', 'pricing_visibility', 'faq', 'resources']) {
      const check = result.checks.find((c) => c.key === key);
      expect(check?.score).toBe(0);
    }
  });

  it('present trust pages score 100', () => {
    const pages = [page(), page({ id: 'p2', url: 'https://acme.test/pricing', title: 'Pricing', page_type: 'pricing' })];
    const result = scoreContentIntelligence(pages, [], Date.now());
    expect(result.checks.find((c) => c.key === 'pricing_visibility')?.score).toBe(100);
  });

  it('is deterministic', () => {
    const a = scoreContentIntelligence([page()], [], 1_700_000_000_000);
    const b = scoreContentIntelligence([page()], [], 1_700_000_000_000);
    expect(a.contentScore).toBe(b.contentScore);
    expect(a.checks).toEqual(b.checks);
  });
});

// ── THE contradiction regression ──────────────────────────────────────────────

describe('Report 1 GOVERNANCE — no score/narrative contradiction', () => {
  /**
   * The critical product-governance test. It fails if any dimension reports an
   * unmeasured state while simultaneously asserting a measured deficiency or
   * prescribing an action for that same dimension.
   */
  const assertNoContradiction = (summary: ReturnType<typeof buildGeoAeoExecutiveSummary>) => {
    const unmeasured = summary.overall_ai_visibility_score_state === 'insufficient_signal'
      || summary.overall_ai_visibility_score_state === 'unavailable';
    if (!unmeasured) return;
    expect(summary.primary_gap).toBeNull();
    expect(summary.top_3_actions).toHaveLength(0);
    expect(summary.visibility_opportunity).toBeNull();
  };

  it('holds when there is no AI evidence at all', () => {
    assertNoContradiction(buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithNoEvidence() }));
  });

  it('holds across every combination of missing axes', () => {
    const axes = ['answer_coverage_score', 'entity_clarity_score', 'citation_readiness_score', 'content_structure_score', 'topical_authority_score'] as const;
    // Null out each axis in turn, and all of them together.
    for (const axis of axes) {
      assertNoContradiction(buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithEvidence({ [axis]: null }) }));
    }
    const allNull = Object.fromEntries(axes.map((a) => [a, null]));
    assertNoContradiction(buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithEvidence(allNull) }));
  });

  it('a competitor that abstains carries no relation label other than Unclassified', () => {
    const relations = deriveCompetitorRelations({ dimensions: STRONG_DIMENSIONS, evidenceCount: 0 });
    expect(relations.abstained).toBe(true);
    expect(relations.compositeRelation).toBe('unclassified');
    expect(relations.productRelation).toBe('unknown');
    expect(relations.marketRelation).toBe('unknown');
  });
});
