/**
 * WP-17 — MARKET-POSITION-NULL-INTEGRITY.
 *
 * THE DEFECT. `assessPositioningAndMarket` derived every competitor's contribution to
 * `marketPosition` from
 *
 *   average([
 *     Number(delta.authority_score ?? 0),
 *     Number(delta.seo_coverage ?? 0),
 *     Number(delta.content_depth ?? 0),
 *   ])
 *
 * `?? 0` converts an UNAVAILABLE dimension into the number 0 — a confident reading of
 * "exactly at parity on this axis" manufactured from no evidence — while the denominator
 * stays pinned at 3 no matter how little was observed. This is the third instance of the
 * class: WP-15 fixed it in `visualIntelligenceHelpers.ts` and WP-12 in
 * `buildCompetitorStanding`.
 *
 * WHY THESE TESTS CONSTRUCT NULLS THE PRODUCTION TYPE FORBIDS. `authority_score`,
 * `seo_coverage` and `content_depth` are exactly the non-nullable members of the canonical
 * `ComparisonMetrics`, so the dilution is inert today and widening that contract to prove it
 * is explicitly out of scope. The declared type is not a runtime guarantee either: this
 * repository compiles with `"strict": false`, and `subtractMetrics` produces these very
 * deltas through `delta(...) as number`, where `delta()` returns `null` whenever either
 * operand is non-numeric. The fixtures below therefore hand the function the runtime shape
 * the cast already permits, which is the shape a future widening would make routine.
 *
 * THE CONTRACT UNDER TEST.
 *   - a genuinely MEASURED 0 is data: it counts as 0 and does NOT abstain;
 *   - a null/undefined dimension never becomes 0;
 *   - the denominator equals the count of observed dimensions;
 *   - a competitor with nothing observed abstains entirely, becoming indistinguishable from
 *     a competitor that was never compared — `marketPosition` is a closed three-value union
 *     with no "unknown" member, so the conservative behaviour the existing contract allows
 *     is to fall through to the abstention route the function ALREADY has
 *     (`competitorPressure - 50`), never to publish a fabricated parity;
 *   - a fully observed input behaves exactly as it did before the fix.
 *
 * SECRETS: all synthetic. No network, no credential, no real property, no real company.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { readFileSync } from 'fs';
import { join } from 'path';

import { assessPositioningAndMarket } from '../../services/snapshotReport/actionHelpers';

type MarketPosition = 'below market' | 'at parity' | 'ahead';

/** A `deltas_vs_company` record as it can actually arrive at runtime. `null` = UNAVAILABLE. */
type Deltas = {
  authority_score?: number | null;
  seo_coverage?: number | null;
  content_depth?: number | null;
};

/** The three dimensions this averager reads. The other four ComparisonMetrics members are not inputs. */
const MARKET_POSITION_DIMENSIONS = ['authority_score', 'seo_coverage', 'content_depth'] as const;

const ACTION_HELPERS_PATH = join(__dirname, '../../services/snapshotReport/actionHelpers.ts');

/** Drive the real production helper and return only the field under test. */
const marketPositionFor = (
  deltasList: Array<Deltas | null>,
  gapImpactScores: Array<number | null> = [],
): MarketPosition =>
  assessPositioningAndMarket({
    companyContext: {
      companyName: 'Acme Synthetic',
      domain: 'acme.test',
      homepageHeadline: null,
      tagline: null,
      primaryOffering: null,
      positioning: null,
      marketContext: null,
      marketFocus: null,
      productServices: [],
      geography: null,
      logoUrl: null,
      faviconUrl: null,
    },
    competitorIntelligence: {
      summary: '',
      detected_competitors: deltasList.map((_, index) => ({
        name: `Rival ${index}`,
        domain: `rival${index}.test`,
      })),
      competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
      comparison: {
        company: null,
        competitors: deltasList.map((deltas, index) => ({
          competitor: { name: `Rival ${index}`, domain: `rival${index}.test` },
          metrics: null,
          deltas_vs_company: deltas,
          metrics_state: 'inferred',
          metrics_basis: 'synthetic fixture',
          crawl_outcome: 'reachable',
        })),
      },
      generated_gaps: gapImpactScores.map((impact_score, index) => ({
        title: `Gap ${index}`,
        impact_score,
      })),
      competitive_summary: {},
    },
    decisions: [],
    publicAudit: null,
  } as never).marketPosition;

/**
 * The PRE-FIX computation, reproduced verbatim from the shipped source so the regression
 * cannot be reverted silently. Every corrected assertion below is also asserted to DIFFER
 * from what this returns, and every no-regression pin is asserted to MATCH it.
 */
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const legacyMarketPosition = (
  deltasList: Array<Deltas | null>,
  gapImpactScores: Array<number | null> = [],
): MarketPosition => {
  const competitorPressure = mean(gapImpactScores.slice(0, 3).map((score) => Number(score ?? 0)));
  const competitorDeltas = deltasList
    .filter((item): item is Deltas => Boolean(item))
    .map((delta) =>
      mean([
        Number(delta.authority_score ?? 0),
        Number(delta.seo_coverage ?? 0),
        Number(delta.content_depth ?? 0),
      ]),
    );
  const avgDelta = competitorDeltas.length > 0 ? mean(competitorDeltas) : competitorPressure - 50;
  return avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity';
};

/** The contract: thresholds untouched, applied to the mean of per-competitor observed-only means. */
const expectedMarketPosition = (perCompetitorObserved: number[][], gapImpactScores: number[] = []): MarketPosition => {
  const competitorDeltas = perCompetitorObserved
    .filter((observed) => observed.length > 0)
    .map((observed) => mean(observed));
  const avgDelta = competitorDeltas.length > 0 ? mean(competitorDeltas) : mean(gapImpactScores.slice(0, 3)) - 50;
  return avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity';
};

// ── NON-VACUITY ──────────────────────────────────────────────────────────────────────────
// A suite that stopped reaching the averager — a renamed field, a moved call site, a fixture
// the helper quietly ignores — would otherwise pass on an empty match set.

describe('WP-17 · non-vacuity — the fixtures really drive the market-position averager', () => {
  const sourceBlock = (): string => {
    const source = readFileSync(ACTION_HELPERS_PATH, 'utf8');
    const start = source.indexOf('const competitorDeltas');
    const end = source.indexOf('const marketPositionStatement');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it('the shipped block still reads exactly these three dimensions', () => {
    const block = sourceBlock();
    expect(block.length).toBeGreaterThan(0);
    MARKET_POSITION_DIMENSIONS.forEach((dimension) => {
      expect(block).toContain(`delta.${dimension}`);
    });
  });

  it('the shipped block no longer coerces a missing dimension to zero', () => {
    // Comment lines are stripped first: the remediation comment quotes the old `?? 0` form.
    const code = sourceBlock()
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).toContain('averageNumber(');
    expect(code).not.toContain('?? 0');
  });

  it('a fully observed fixture produces a real, competitor-driven market position', () => {
    // Drives the helper end to end, and proves the competitor path — not the fallback — decides:
    // the same gaps with no competitor entries land on a different label.
    expect(marketPositionFor([{ authority_score: 30, seo_coverage: 30, content_depth: 30 }], [10])).toBe('below market');
    expect(marketPositionFor([], [10])).toBe('ahead');
  });

  it('the pre-fix reference and the contract genuinely disagree on a null dimension', () => {
    // If these ever agreed, every "differs from legacy" assertion below would be vacuous.
    const deltas: Deltas = { authority_score: 8, seo_coverage: 8, content_depth: null };
    expect(legacyMarketPosition([deltas])).not.toBe(expectedMarketPosition([[8, 8]]));
  });
});

// ── A. A MEASURED ZERO IS DATA ───────────────────────────────────────────────────────────

describe('WP-17 · a genuinely measured 0 counts as 0 and does not abstain', () => {
  it('an all-zero observed delta yields parity, not the abstention route', () => {
    // With no gaps the abstention route gives competitorPressure(0) - 50 = -50 => 'ahead'.
    // A measured zero must NOT land there: it is real evidence of parity.
    expect(marketPositionFor([], [])).toBe('ahead');
    expect(marketPositionFor([{ authority_score: 0, seo_coverage: 0, content_depth: 0 }], [])).toBe('at parity');
  });

  it('a measured zero still pulls the multi-competitor mean, rather than dropping out', () => {
    const fixture: Array<Deltas> = [
      { authority_score: 0, seo_coverage: 0, content_depth: 0 },
      { authority_score: 10, seo_coverage: 10, content_depth: 10 },
    ];
    // mean of per-competitor means = (0 + 10) / 2 = 5 => 'at parity'.
    // If the measured zero were (wrongly) treated as unobserved and dropped, it would be
    // 10 => 'below market'.
    expect(marketPositionFor(fixture)).toBe('at parity');
    expect(expectedMarketPosition([[0, 0, 0], [10, 10, 10]])).toBe('at parity');
    expect(marketPositionFor([fixture[1]])).toBe('below market');
  });

  it('a measured zero mixed with observed dimensions is averaged in, not skipped', () => {
    // (18 + 0 + 0) / 3 = 6 => exactly the 'below market' threshold. Dropping the two zeros
    // would give 18, and treating them as unobserved would change the denominator to 1.
    expect(marketPositionFor([{ authority_score: 18, seo_coverage: 0, content_depth: 0 }])).toBe('below market');
    // The same numerator with one genuine zero removed from the denominator crosses nothing,
    // but 17.9 over three observed dimensions is 5.97 — below the threshold. This is what
    // pins the zeros into the denominator.
    expect(marketPositionFor([{ authority_score: 17.9, seo_coverage: 0, content_depth: 0 }])).toBe('at parity');
  });
});

// ── B. AN UNAVAILABLE DIMENSION IS NOT A ZERO ────────────────────────────────────────────

describe('WP-17 · a null dimension does not become a measured zero', () => {
  it('null on one dimension no longer drags the mean toward parity', () => {
    const deltas: Deltas = { authority_score: 8, seo_coverage: 8, content_depth: null };
    // Pre-fix: (8 + 8 + 0) / 3 = 5.33 => 'at parity'. Contract: (8 + 8) / 2 = 8 => 'below market'.
    expect(legacyMarketPosition([deltas])).toBe('at parity');
    expect(marketPositionFor([deltas])).toBe('below market');
    expect(marketPositionFor([deltas])).not.toBe(legacyMarketPosition([deltas]));
  });

  it('null on one dimension no longer erases a genuine lead either', () => {
    const deltas: Deltas = { authority_score: -5, seo_coverage: -5, content_depth: null };
    // Pre-fix: -10 / 3 = -3.33 => 'at parity'. Contract: -5 => 'ahead'.
    expect(legacyMarketPosition([deltas])).toBe('at parity');
    expect(marketPositionFor([deltas])).toBe('ahead');
  });

  it('an absent (undefined) dimension is unavailable too, not zero', () => {
    const deltas: Deltas = { authority_score: 8, seo_coverage: 8 };
    expect(legacyMarketPosition([deltas])).toBe('at parity');
    expect(marketPositionFor([deltas])).toBe('below market');
  });

  it('a non-numeric dimension is unavailable rather than a NaN-poisoned average', () => {
    // Pre-fix `Number('n/a')` is NaN; every comparison against NaN is false, so the whole
    // report silently published 'at parity'.
    const deltas = { authority_score: 9, seo_coverage: 9, content_depth: 'n/a' } as unknown as Deltas;
    expect(marketPositionFor([deltas])).toBe('below market');
  });
});

// ── C. THE DENOMINATOR IS THE OBSERVED COUNT ─────────────────────────────────────────────

describe('WP-17 · the denominator reflects observed dimensions only', () => {
  it('two observed dimensions divide by two, pinned at the unchanged 6-point threshold', () => {
    expect(marketPositionFor([{ authority_score: 6, seo_coverage: 6, content_depth: null }])).toBe('below market');
    expect(marketPositionFor([{ authority_score: 5.9, seo_coverage: 5.9, content_depth: null }])).toBe('at parity');
    // A denominator of 3 would give 4 and 3.93 — both 'at parity'.
    expect(legacyMarketPosition([{ authority_score: 6, seo_coverage: 6, content_depth: null }])).toBe('at parity');
  });

  it('one observed dimension divides by one', () => {
    expect(marketPositionFor([{ authority_score: 6, seo_coverage: null, content_depth: null }])).toBe('below market');
    expect(marketPositionFor([{ authority_score: 5.9, seo_coverage: null, content_depth: null }])).toBe('at parity');
    expect(marketPositionFor([{ authority_score: -4, seo_coverage: null, content_depth: null }])).toBe('ahead');
    expect(marketPositionFor([{ authority_score: -3.9, seo_coverage: null, content_depth: null }])).toBe('at parity');
  });

  it('a partly observed competitor is not diluted toward a fully observed one', () => {
    const fixture: Array<Deltas> = [
      { authority_score: 12, seo_coverage: null, content_depth: null },
      { authority_score: 0, seo_coverage: 0, content_depth: 0 },
    ];
    // Contract: (12 + 0) / 2 = 6 => 'below market'. Pre-fix: ((12/3) + 0) / 2 = 2 => 'at parity'.
    expect(marketPositionFor(fixture)).toBe('below market');
    expect(legacyMarketPosition(fixture)).toBe('at parity');
  });
});

// ── D. NOTHING OBSERVED => ABSTAIN, NEVER A FABRICATED PARITY ────────────────────────────

describe('WP-17 · a competitor with no observed dimension abstains', () => {
  const allNull: Deltas = { authority_score: null, seo_coverage: null, content_depth: null };

  it('an all-unavailable competitor is indistinguishable from an absent competitor', () => {
    // This IS the abstention contract: `marketPosition` has no "unknown" member, so the
    // conservative outcome available is to contribute nothing and let the function's own
    // pre-existing fallback decide.
    [[], [80, 80, 80], [40, 40, 40], [10]].forEach((gaps) => {
      expect(marketPositionFor([allNull], gaps)).toBe(marketPositionFor([], gaps));
    });
  });

  it('abstention is not the fabricated parity the pre-fix code published', () => {
    expect(legacyMarketPosition([allNull], [80, 80, 80])).toBe('at parity');
    expect(marketPositionFor([allNull], [80, 80, 80])).toBe('below market'); // 80 - 50 = 30
    expect(legacyMarketPosition([allNull], [])).toBe('at parity');
    expect(marketPositionFor([allNull], [])).toBe('ahead'); // 0 - 50 = -50, the existing route
  });

  it('every competitor unavailable abstains as a group', () => {
    expect(marketPositionFor([allNull, allNull, allNull], [80, 80, 80])).toBe('below market');
    expect(marketPositionFor([allNull, allNull, allNull], [80, 80, 80])).toBe(marketPositionFor([], [80, 80, 80]));
  });

  it('one abstaining competitor does not dilute the competitors that were observed', () => {
    const fixture: Array<Deltas> = [allNull, { authority_score: 10, seo_coverage: 10, content_depth: 10 }];
    // Contract: the mean of the ONE observed competitor = 10 => 'below market'.
    // Pre-fix: (0 + 10) / 2 = 5 => 'at parity'.
    expect(marketPositionFor(fixture)).toBe('below market');
    expect(legacyMarketPosition(fixture)).toBe('at parity');
  });
});

// ── E. NO REGRESSION ON FULLY OBSERVED INPUT ─────────────────────────────────────────────

describe('WP-17 · fully observed input behaves exactly as it did before the fix', () => {
  const FULLY_OBSERVED: Array<{ label: string; deltas: Array<Deltas>; gaps: number[] }> = [
    { label: 'well behind on every axis', deltas: [{ authority_score: 24, seo_coverage: 18, content_depth: 30 }], gaps: [70] },
    { label: 'just over the below-market threshold', deltas: [{ authority_score: 6, seo_coverage: 6, content_depth: 6 }], gaps: [] },
    { label: 'just under the below-market threshold', deltas: [{ authority_score: 5, seo_coverage: 6, content_depth: 6 }], gaps: [] },
    { label: 'exact parity', deltas: [{ authority_score: 0, seo_coverage: 0, content_depth: 0 }], gaps: [50] },
    { label: 'just inside the ahead threshold', deltas: [{ authority_score: -4, seo_coverage: -4, content_depth: -4 }], gaps: [] },
    { label: 'just outside the ahead threshold', deltas: [{ authority_score: -3, seo_coverage: -4, content_depth: -4 }], gaps: [] },
    { label: 'clearly ahead', deltas: [{ authority_score: -20, seo_coverage: -12, content_depth: -31 }], gaps: [20] },
    { label: 'three competitors, mixed signs', deltas: [
      { authority_score: 14, seo_coverage: -2, content_depth: 9 },
      { authority_score: -8, seo_coverage: 3, content_depth: 1 },
      { authority_score: 22, seo_coverage: 17, content_depth: -5 },
    ], gaps: [66, 41, 78] },
    { label: 'no competitor entries at all (the live production shape)', deltas: [], gaps: [72, 55, 48] },
    { label: 'no competitor entries and no gaps', deltas: [], gaps: [] },
  ];

  it('the no-regression table is non-empty and every row is checked', () => {
    expect(FULLY_OBSERVED.length).toBeGreaterThanOrEqual(10);
  });

  FULLY_OBSERVED.forEach(({ label, deltas, gaps }) => {
    it(`${label}: identical to the pre-fix formula`, () => {
      const legacy = legacyMarketPosition(deltas, gaps);
      expect(marketPositionFor(deltas, gaps)).toBe(legacy);
      expect(expectedMarketPosition(deltas.map((d) => [d.authority_score, d.seo_coverage, d.content_depth] as number[]), gaps)).toBe(legacy);
    });
  });
});

// ── F. THE SUITE ACTUALLY DISCRIMINATES ──────────────────────────────────────────────────

describe('WP-17 · the suite fails against the pre-fix implementation', () => {
  it('at least five nullable fixtures are corrected relative to the pre-fix formula', () => {
    const corrected: Array<{ deltas: Array<Deltas>; gaps: number[] }> = [
      { deltas: [{ authority_score: 8, seo_coverage: 8, content_depth: null }], gaps: [] },
      { deltas: [{ authority_score: -5, seo_coverage: -5, content_depth: null }], gaps: [] },
      { deltas: [{ authority_score: 6, seo_coverage: 6, content_depth: null }], gaps: [] },
      { deltas: [{ authority_score: 12, seo_coverage: null, content_depth: null }, { authority_score: 0, seo_coverage: 0, content_depth: 0 }], gaps: [] },
      { deltas: [{ authority_score: null, seo_coverage: null, content_depth: null }], gaps: [80, 80, 80] },
      { deltas: [{ authority_score: null, seo_coverage: null, content_depth: null }, { authority_score: 10, seo_coverage: 10, content_depth: 10 }], gaps: [] },
    ];
    const divergent = corrected.filter(
      ({ deltas, gaps }) => marketPositionFor(deltas, gaps) !== legacyMarketPosition(deltas, gaps),
    );
    expect(divergent.length).toBeGreaterThanOrEqual(5);
    expect(divergent.length).toBe(corrected.length);
  });
});
