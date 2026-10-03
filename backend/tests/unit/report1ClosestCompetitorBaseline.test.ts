/**
 * Report 1 — WP-13 DEFECT #9: an unobserved company radar axis must not participate in the
 * comparison that IDENTIFIES the closest competitor.
 *
 * `competitor_positioning_radar.user` is the FLATTENED wire shape. Its producer
 * (`buildCompetitorVisuals`, competitorSummaryHelpers.ts) writes `userAxisValues.<axis> ?? 0` for
 * all five axes — deliberately, because widening the persisted shape is out of scope
 * (WP13_NULL_CONTRACT_DECISION §3.7/D8). A persisted 0 is therefore indistinguishable, ON ITS
 * OWN, from "the company was never observed on that axis".
 *
 * `findClosestCompetitor` (reportTrendComparisonHelpers.ts) averaged all five of those numbers
 * via `Number(x ?? 0)` into `userScore`, then picked the competitor minimising
 * `|competitorScore - userScore|`. Every unobserved axis therefore dragged the company's baseline
 * toward 0 and changed WHICH competitor was named — systematically naming a weaker competitor
 * than the evidence supports. The chosen `{ domain, score }` is published on
 * `timelineComparison.snapshots[].competitor` in the report API payload.
 *
 * The distinguishing evidence is the UNFLATTENED source of each axis, in the same payload — the
 * exact five values `deriveUserRadarAxisValues` reads:
 *
 *   content_score             <- seoVisuals.seoCapabilityRadar.content_quality_score
 *   keyword_coverage_score    <- seoVisuals.seoCapabilityRadar.keyword_research_score
 *   authority_score           <- seoVisuals.seoCapabilityRadar.backlinks_score
 *   technical_score           <- seoVisuals.seoCapabilityRadar.technical_seo_score
 *   ai_answer_presence_score  <- geoAeoVisuals.aiAnswerPresenceRadar.answer_coverage_score
 *
 * each of which is `number | null`, where `null` means UNOBSERVED.
 *
 * ZERO IS NOT THE TEST. A genuinely measured 0 is a real score and must still pull the baseline
 * down — pinned by C below, which is the guard against a "fix" by `=== 0`.
 *
 * Every assertion runs through `attachProgressComparison`, the step
 * `pages/api/reports/[reportId].ts` performs on the customer's report request, not through the
 * private helper.
 */
import { attachProgressComparison } from '../../../pages/api/reports/reportComparisonAttachment';

type Axis =
  | 'content_score'
  | 'keyword_coverage_score'
  | 'authority_score'
  | 'technical_score'
  | 'ai_answer_presence_score';

const REPORT_ID = 'r-closest-1';

/** The five unflattened company axis sources. `null` means the axis was never observed. */
type ObservedSources = {
  content_quality_score: number | null;
  keyword_research_score: number | null;
  backlinks_score: number | null;
  technical_seo_score: number | null;
  answer_coverage_score: number | null;
};

function flatten(sources: ObservedSources): Record<Axis, number> {
  // Exactly what `buildCompetitorVisuals` persists: `?? 0` on every axis.
  return {
    content_score: sources.content_quality_score ?? 0,
    keyword_coverage_score: sources.keyword_research_score ?? 0,
    authority_score: sources.backlinks_score ?? 0,
    technical_score: sources.technical_seo_score ?? 0,
    ai_answer_presence_score: sources.answer_coverage_score ?? 0,
  };
}

function competitor(domain: string, flat: number): { name: string; domain: string } & Record<Axis, number> {
  return {
    name: domain,
    domain,
    content_score: flat,
    keyword_coverage_score: flat,
    authority_score: flat,
    technical_score: flat,
    ai_answer_presence_score: flat,
  };
}

/**
 * A snapshot view payload shaped as `mapComposedReport` produces it: the flattened radar plus the
 * unflattened axis sources it was derived from. `competitorMovementComparison` is deliberately
 * absent — `attachProgressComparison` only attaches it AFTER `buildTimelineComparison` has run, so
 * the `userScore` branch of `findClosestCompetitor` is the branch production takes.
 */
function snapshotPayload(params: { sources: ObservedSources; competitors: number[] }) {
  return {
    reportId: REPORT_ID,
    companyId: 'co-1',
    domain: 'example.com',
    generated_at: '2026-09-20T00:00:00.000Z',
    overallScore: 50,
    seoVisuals: {
      seoCapabilityRadar: {
        technical_seo_score: params.sources.technical_seo_score,
        keyword_research_score: params.sources.keyword_research_score,
        rank_tracking_score: null,
        backlinks_score: params.sources.backlinks_score,
        competitor_intelligence_score: 50,
        content_quality_score: params.sources.content_quality_score,
        confidence: 'medium',
        tooltips: {},
        insightSentence: '',
      },
    },
    geoAeoVisuals: {
      aiAnswerPresenceRadar: {
        answer_coverage_score: params.sources.answer_coverage_score,
        entity_clarity_score: null,
        topical_authority_score: null,
        citation_readiness_score: null,
        content_structure_score: null,
        freshness_score: null,
        confidence: 'low',
        data_source_strength: 'missing',
        source_tags: null,
      },
    },
    competitorVisuals: {
      competitorPositioningRadar: {
        competitors: params.competitors.map((flat) => competitor(`c-${flat}.com`, flat)),
        user: flatten(params.sources),
        confidence: 'medium',
      },
    },
  };
}

const TIMELINE_ROW = {
  id: REPORT_ID,
  company_id: 'co-1',
  domain: 'example.com',
  report_type: 'snapshot',
  status: 'completed',
  created_at: '2026-09-20T00:00:00.000Z',
  data: {},
  metadata: {},
};

/** The published cell. THROWS when the slot is absent, so nothing below can pass vacuously. */
function publishedCompetitor(params: { sources: ObservedSources; competitors: number[] }): { domain: string; score: number } | null {
  const enriched: any = attachProgressComparison({
    currentPayload: snapshotPayload(params) as any,
    type: 'snapshot',
    timelineReports: [TIMELINE_ROW],
    mapStoredReportToPayload: () => null,
  });
  const snapshots = enriched?.timelineComparison?.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length !== 1) {
    throw new Error('No single timelineComparison snapshot was published — the match set is empty.');
  }
  if (!('competitor' in snapshots[0])) {
    throw new Error('The published snapshot carries no `competitor` slot — the match set is empty.');
  }
  return snapshots[0].competitor;
}

/**
 * Three axes observed at 60, two never observed.
 *
 * Flattened mean (the defect):            (60+60+0+60+0)/5 = 36  -> c-35.com is "closest"
 * Mean over the axes actually observed:   (60+60+60)/3     = 60  -> c-65.com is "closest"
 */
const PARTIALLY_OBSERVED: ObservedSources = {
  content_quality_score: 60,
  keyword_research_score: 60,
  backlinks_score: null,
  technical_seo_score: 60,
  answer_coverage_score: null,
};

// -- Non-vacuity -------------------------------------------------------------

describe('WP-13 #9 — the assertions below read a slot that really exists', () => {
  it('attachProgressComparison publishes exactly one timeline snapshot carrying a competitor slot', () => {
    expect(() => publishedCompetitor({ sources: PARTIALLY_OBSERVED, competitors: [35, 65] })).not.toThrow();
    const chosen = publishedCompetitor({ sources: PARTIALLY_OBSERVED, competitors: [35, 65] });
    expect(chosen).not.toBeUndefined();
  });
});

// -- A. An unobserved axis must not choose the competitor --------------------

describe('WP-13 #9 — A: unobserved axes do not drag the baseline toward the weakest competitor', () => {
  it('A1: with authority and AI never observed, the named competitor is the one near the OBSERVED baseline', () => {
    const chosen = publishedCompetitor({ sources: PARTIALLY_OBSERVED, competitors: [35, 65] });
    expect(chosen).not.toBeNull();
    expect(chosen!.domain).toBe('c-65.com');
    expect(chosen!.domain).not.toBe('c-35.com');
  });

  it('A2: the published score of the named competitor is that competitor own full radar mean', () => {
    const chosen = publishedCompetitor({ sources: PARTIALLY_OBSERVED, competitors: [35, 65] });
    expect(chosen!.score).toBe(65);
  });
});

// -- B. No axis observed at all -> abstain -----------------------------------

describe('WP-13 #9 — B: a company observed on no axis names no closest competitor', () => {
  it('B1: every axis unobserved publishes competitor: null rather than the weakest competitor', () => {
    const chosen = publishedCompetitor({
      sources: {
        content_quality_score: null,
        keyword_research_score: null,
        backlinks_score: null,
        technical_seo_score: null,
        answer_coverage_score: null,
      },
      competitors: [35, 65],
    });
    expect(chosen).toBeNull();
  });
});

// -- C. A MEASURED zero is a real score -------------------------------------

describe('WP-13 #9 — C: an observed 0 still counts (the guard against a `=== 0` fix)', () => {
  it('C1: all five axes observed, two of them genuinely 0, still names the weaker competitor', () => {
    const chosen = publishedCompetitor({
      sources: {
        content_quality_score: 60,
        keyword_research_score: 60,
        backlinks_score: 0,
        technical_seo_score: 60,
        answer_coverage_score: 0,
      },
      competitors: [35, 65],
    });
    // Observed mean is (60+60+0+60+0)/5 = 36 — a real measurement, so c-35.com is genuinely closest.
    expect(chosen).not.toBeNull();
    expect(chosen!.domain).toBe('c-35.com');
  });

  it('C2: all five axes observed at 60 is unchanged by this fix', () => {
    const chosen = publishedCompetitor({
      sources: {
        content_quality_score: 60,
        keyword_research_score: 60,
        backlinks_score: 60,
        technical_seo_score: 60,
        answer_coverage_score: 60,
      },
      competitors: [35, 65],
    });
    expect(chosen!.domain).toBe('c-65.com');
  });
});

// -- D. The existing no-competitor path is untouched -------------------------

describe('WP-13 #9 — D: the pre-existing empty-radar path still abstains', () => {
  it('D1: no competitors on the radar publishes competitor: null', () => {
    const chosen = publishedCompetitor({ sources: PARTIALLY_OBSERVED, competitors: [] });
    expect(chosen).toBeNull();
  });
});
