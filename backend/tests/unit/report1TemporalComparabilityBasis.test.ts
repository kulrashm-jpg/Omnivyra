/**
 * Report 1 — WP-13 DEFECT #10: a change in EVIDENCE AVAILABILITY between two snapshots must not
 * be published as a change in company PERFORMANCE.
 *
 * `buildCompetitorMovementComparison` (reportTrendComparisonHelpers.ts) computed
 *
 *   currentGap  = averageRadarScore(competitor)         - averageRadarScore(currentRadar.user)
 *   previousGap = averageRadarScore(previousCompetitor) - averageRadarScore(previousRadar.user)
 *   gapChange   = currentGap - previousGap
 *
 * where `averageRadarScore` is a `Number(x ?? 0)` mean over a FIXED denominator of five taken on
 * the FLATTENED `competitor_positioning_radar.user`. `buildCompetitorVisuals` writes
 * `userAxisValues.<axis> ?? 0` for every axis, so an axis nobody observed is persisted as the
 * same number as an axis measured at zero.
 *
 * Each snapshot therefore got its own, independently-flattened five-axis baseline. When an axis
 * was unobserved in the previous snapshot and measured in the current one, the previous baseline
 * carried a fabricated 0 that the current baseline did not, and the difference of the two means
 * surfaced the whole of that axis as company movement. `gapChange` then selects `closest`, and
 * drives the published `user_vs_competitor_shift.{closest_competitor, gap_change, direction}` and
 * `summary.key_movement`.
 *
 * THE DISCRIMINATOR. Two scenarios produce the IDENTICAL pre-fix number:
 *
 *   #10-REPRO    authority UNOBSERVED -> observed at 60   -> gap_change -12, "catching up"
 *   #10-GENUINE  authority MEASURED 0 -> measured at 60   -> gap_change -12, "catching up"
 *
 * The first is a measurement that started; the second is a real 60-point improvement. Only the
 * second is movement. A correct fix must separate them — which is why ZERO IS NOT THE TEST.
 *
 * The availability evidence is the UNFLATTENED source of each axis, carried for BOTH snapshots in
 * the same payloads this function is handed (`mapComposedReport` builds `seoVisuals` /
 * `geoAeoVisuals` for every snapshot report, current and historical). Each is `number | null`,
 * where `null` is the producers' `'unavailable'` / `'insufficient_signal'` state.
 *
 * Every assertion runs through `attachProgressComparison`, the step
 * `pages/api/reports/[reportId].ts` performs on the customer's report request.
 */
import { attachProgressComparison } from '../../../pages/api/reports/reportComparisonAttachment';

type Axis =
  | 'content_score'
  | 'keyword_coverage_score'
  | 'authority_score'
  | 'technical_score'
  | 'ai_answer_presence_score';

/** The five unflattened company axis sources. `null` means the axis was never observed. */
type ObservedSources = {
  content_quality_score: number | null;
  keyword_research_score: number | null;
  backlinks_score: number | null;
  technical_seo_score: number | null;
  answer_coverage_score: number | null;
};

const ALL_OBSERVED_60: ObservedSources = {
  content_quality_score: 60,
  keyword_research_score: 60,
  backlinks_score: 60,
  technical_seo_score: 60,
  answer_coverage_score: 60,
};

function sources(overrides: Partial<ObservedSources>): ObservedSources {
  return { ...ALL_OBSERVED_60, ...overrides };
}

function flatten(src: ObservedSources): Record<Axis, number> {
  // Exactly what `buildCompetitorVisuals` persists: `?? 0` on every axis.
  return {
    content_score: src.content_quality_score ?? 0,
    keyword_coverage_score: src.keyword_research_score ?? 0,
    authority_score: src.backlinks_score ?? 0,
    technical_score: src.technical_seo_score ?? 0,
    ai_answer_presence_score: src.answer_coverage_score ?? 0,
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

/** A snapshot view payload shaped as `mapComposedReport` produces it. */
function snapshotPayload(params: {
  reportId: string;
  generatedAt: string;
  sources: ObservedSources;
  competitors: Array<{ domain: string; flat: number }>;
}) {
  return {
    reportId: params.reportId,
    companyId: 'co-1',
    domain: 'example.com',
    generated_at: params.generatedAt,
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
      // `buildProgressComparison` runs on the same two payloads and reads this slot
      // non-optionally; present so the movement assertions below are not masked by a fixture gap.
      searchVisibilityFunnel: {
        impressions: null,
        clicks: null,
        ctr: null,
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
        competitors: params.competitors.map((item) => competitor(item.domain, item.flat)),
        user: flatten(params.sources),
        confidence: 'medium',
      },
    },
  };
}

const CURRENT_ID = 'r-current';
const PREVIOUS_ID = 'r-previous';
const CURRENT_AT = '2026-09-20T00:00:00.000Z';
const PREVIOUS_AT = '2026-08-20T00:00:00.000Z';

function timelineRow(id: string, createdAt: string) {
  return {
    id,
    company_id: 'co-1',
    domain: 'example.com',
    report_type: 'snapshot',
    status: 'completed',
    created_at: createdAt,
    data: {},
    metadata: {},
  };
}

type PublishedMovement = {
  user_vs_competitor_shift: {
    closest_competitor: string;
    gap_change: number | null;
    direction: 'closing_gap' | 'widening_gap' | 'unchanged';
  };
  data_status: 'complete' | 'partial' | 'insufficient';
  summary: { overall_trend: string; key_movement: string };
  competitors: Array<Record<string, unknown>>;
};

/** The published block. THROWS when the slot is absent, so nothing below can pass vacuously. */
function publishedMovement(params: {
  previousSources: ObservedSources;
  currentSources: ObservedSources;
  competitors?: Array<{ domain: string; flat: number }>;
}): PublishedMovement {
  const competitors = params.competitors ?? [{ domain: 'rival.com', flat: 70 }];
  const previousPayload = snapshotPayload({
    reportId: PREVIOUS_ID,
    generatedAt: PREVIOUS_AT,
    sources: params.previousSources,
    competitors,
  });
  const enriched: any = attachProgressComparison({
    currentPayload: snapshotPayload({
      reportId: CURRENT_ID,
      generatedAt: CURRENT_AT,
      sources: params.currentSources,
      competitors,
    }) as any,
    type: 'snapshot',
    timelineReports: [timelineRow(CURRENT_ID, CURRENT_AT), timelineRow(PREVIOUS_ID, PREVIOUS_AT)],
    mapStoredReportToPayload: (row) => (row.id === PREVIOUS_ID ? (previousPayload as any) : null),
  });
  const movement = enriched?.competitorMovementComparison;
  if (!movement || typeof movement !== 'object') {
    throw new Error('No competitorMovementComparison was published — the match set is empty.');
  }
  if (!movement.user_vs_competitor_shift) {
    throw new Error('The published block carries no user_vs_competitor_shift — the match set is empty.');
  }
  if (movement.previous_report_id !== PREVIOUS_ID || movement.current_report_id !== CURRENT_ID) {
    throw new Error('The published block did not compare the two intended snapshots.');
  }
  return movement as PublishedMovement;
}

// -- Non-vacuity -------------------------------------------------------------

describe('WP-13 #10 — the assertions below read a block that really exists', () => {
  it('attachProgressComparison publishes a movement block comparing the two snapshots', () => {
    const movement = publishedMovement({
      previousSources: ALL_OBSERVED_60,
      currentSources: ALL_OBSERVED_60,
    });
    expect(movement.competitors.length).toBe(1);
    expect(movement.user_vs_competitor_shift.closest_competitor).toBe('rival.com');
  });
});

// -- A. Identical snapshots -> no movement -----------------------------------

describe('WP-13 #10 — A: two identical snapshots report no movement', () => {
  it('A1: gap_change is 0 and the direction is unchanged', () => {
    const movement = publishedMovement({
      previousSources: ALL_OBSERVED_60,
      currentSources: ALL_OBSERVED_60,
    });
    expect(movement.user_vs_competitor_shift.gap_change).toBe(0);
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
  });

  it('A2: identical snapshots with the SAME axis unobserved in both still report no movement', () => {
    const both = sources({ backlinks_score: null });
    const movement = publishedMovement({ previousSources: both, currentSources: both });
    expect(movement.user_vs_competitor_shift.gap_change).toBe(0);
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
  });
});

// -- B. A real score change IS movement --------------------------------------

describe('WP-13 #10 — B: observed -> observed with a real score change is genuine movement', () => {
  it('B1: content measured 40 then 60, every axis observed in both, closes the gap', () => {
    const movement = publishedMovement({
      previousSources: sources({ content_quality_score: 40 }),
      currentSources: ALL_OBSERVED_60,
    });
    // Common basis is all five axes: user 56 -> 60 against a flat-70 competitor.
    expect(movement.user_vs_competitor_shift.gap_change).toBe(-4);
    expect(movement.user_vs_competitor_shift.direction).toBe('closing_gap');
    expect(movement.data_status).toBe('complete');
  });

  it('B2: content measured 60 then 40 widens the gap', () => {
    const movement = publishedMovement({
      previousSources: ALL_OBSERVED_60,
      currentSources: sources({ content_quality_score: 40 }),
    });
    expect(movement.user_vs_competitor_shift.gap_change).toBe(4);
    expect(movement.user_vs_competitor_shift.direction).toBe('widening_gap');
  });
});

// -- C. unobserved -> observed is NOT movement -------------------------------

describe('WP-13 #10 — C: an axis measured for the first time is not an improvement', () => {
  it('C1: THE LIVE REPRODUCTION — authority unobserved then 60 must not publish closing_gap', () => {
    const movement = publishedMovement({
      previousSources: sources({ backlinks_score: null }),
      currentSources: ALL_OBSERVED_60,
    });
    expect(movement.user_vs_competitor_shift.gap_change).toBe(0);
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
    expect(movement.summary.key_movement).not.toMatch(/catching up/i);
  });

  it('C2: the comparison is partial, because an axis was not usable on both sides', () => {
    const movement = publishedMovement({
      previousSources: sources({ backlinks_score: null }),
      currentSources: ALL_OBSERVED_60,
    });
    expect(movement.data_status).toBe('partial');
  });
});

// -- D. observed -> unobserved is NOT deterioration --------------------------

describe('WP-13 #10 — D: an axis that stopped being measured is not a decline', () => {
  it('D1: authority 60 then unobserved must not publish widening_gap', () => {
    const movement = publishedMovement({
      previousSources: ALL_OBSERVED_60,
      currentSources: sources({ backlinks_score: null }),
    });
    expect(movement.user_vs_competitor_shift.gap_change).toBe(0);
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
    expect(movement.summary.key_movement).not.toMatch(/pulling ahead/i);
  });
});

// -- THE DISCRIMINATOR: a MEASURED zero is a real score ----------------------

describe('WP-13 #10 — the guard against an `=== 0` or null-as-zero fix', () => {
  it('E0: authority MEASURED 0 then 60 IS a real improvement and must still close the gap', () => {
    const movement = publishedMovement({
      previousSources: sources({ backlinks_score: 0 }),
      currentSources: ALL_OBSERVED_60,
    });
    // Common basis is all five axes: user 48 -> 60 against a flat-70 competitor.
    expect(movement.user_vs_competitor_shift.gap_change).toBe(-12);
    expect(movement.user_vs_competitor_shift.direction).toBe('closing_gap');
    expect(movement.data_status).toBe('complete');
  });

  it('E0b: the unobserved and the measured-zero scenarios must NOT publish the same number', () => {
    const unobserved = publishedMovement({
      previousSources: sources({ backlinks_score: null }),
      currentSources: ALL_OBSERVED_60,
    });
    const measuredZero = publishedMovement({
      previousSources: sources({ backlinks_score: 0 }),
      currentSources: ALL_OBSERVED_60,
    });
    expect(unobserved.user_vs_competitor_shift.gap_change).not.toBe(
      measuredZero.user_vs_competitor_shift.gap_change,
    );
  });
});

// -- E. Mixed availability: only comparable axes contribute ------------------

describe('WP-13 #10 — E: with availability differing across axes only the common ones contribute', () => {
  it('E1: content 40->60 is the only comparable change; authority and AI availability flipped', () => {
    const movement = publishedMovement({
      previousSources: {
        content_quality_score: 40,
        keyword_research_score: 60,
        backlinks_score: null,
        technical_seo_score: 60,
        answer_coverage_score: 60,
      },
      currentSources: {
        content_quality_score: 60,
        keyword_research_score: 60,
        backlinks_score: 60,
        technical_seo_score: 60,
        answer_coverage_score: null,
      },
    });
    // Common basis = content, keyword, technical. user 53.33 -> 60 against a flat-70 competitor.
    expect(movement.user_vs_competitor_shift.gap_change).toBe(-6.67);
    expect(movement.user_vs_competitor_shift.direction).toBe('closing_gap');
    expect(movement.data_status).toBe('partial');
  });

  it('E2: the same availability flip with NO score change on any comparable axis is no movement', () => {
    const movement = publishedMovement({
      previousSources: sources({ backlinks_score: null }),
      currentSources: sources({ answer_coverage_score: null }),
    });
    expect(movement.user_vs_competitor_shift.gap_change).toBe(0);
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
  });
});

// -- F. No common observed axis -> explicit non-comparable -------------------

describe('WP-13 #10 — F: disjoint observed axis sets cannot be compared at all', () => {
  it('F1: gap_change is null, direction unchanged, and the narrative states insufficiency', () => {
    const movement = publishedMovement({
      previousSources: {
        content_quality_score: 60,
        keyword_research_score: 60,
        backlinks_score: null,
        technical_seo_score: null,
        answer_coverage_score: null,
      },
      currentSources: {
        content_quality_score: null,
        keyword_research_score: null,
        backlinks_score: 60,
        technical_seo_score: 60,
        answer_coverage_score: null,
      },
    });
    expect(movement.user_vs_competitor_shift.gap_change).toBeNull();
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
    expect(movement.summary.key_movement).toMatch(/insufficient/i);
    expect(movement.data_status).toBe('partial');
  });

  it('F2: the company observed on no axis in either snapshot also abstains', () => {
    const none: ObservedSources = {
      content_quality_score: null,
      keyword_research_score: null,
      backlinks_score: null,
      technical_seo_score: null,
      answer_coverage_score: null,
    };
    const movement = publishedMovement({ previousSources: none, currentSources: none });
    expect(movement.user_vs_competitor_shift.gap_change).toBeNull();
    expect(movement.user_vs_competitor_shift.direction).toBe('unchanged');
  });
});

// -- G. The competitor-side published contract is untouched ------------------

describe('WP-13 #10 — G: the competitor rows keep their own full five-axis semantics', () => {
  it('G1: previous_scores / current_scores / delta / movement are unchanged by the basis rule', () => {
    const movement = publishedMovement({
      previousSources: sources({ backlinks_score: null }),
      currentSources: ALL_OBSERVED_60,
      competitors: [{ domain: 'rival.com', flat: 70 }],
    });
    expect(movement.competitors[0]).toMatchObject({
      domain: 'rival.com',
      previous_scores: {
        content_score: 70,
        keyword_coverage_score: 70,
        authority_score: 70,
        technical_score: 70,
        ai_answer_presence_score: 70,
      },
      current_scores: {
        content_score: 70,
        keyword_coverage_score: 70,
        authority_score: 70,
        technical_score: 70,
        ai_answer_presence_score: 70,
      },
      delta: {
        content_delta: 0,
        keyword_delta: 0,
        authority_delta: 0,
        technical_delta: 0,
        ai_answer_delta: 0,
      },
      movement: 'stable',
    });
  });
});
