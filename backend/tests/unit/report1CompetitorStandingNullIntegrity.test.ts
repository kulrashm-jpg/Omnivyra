/**
 * WP-15 — COMPETITOR-STANDING-NULL-INTEGRITY.
 *
 * THE DEFECT. `buildSnapshotVisualIntelligence` derived each competitor's standing from
 *
 *   averageNumber([
 *     Number(deltas.content_depth ?? 0), Number(deltas.authority_score ?? 0),
 *     Number(deltas.seo_coverage ?? 0),  Number(deltas.geo_presence ?? 0),
 *     Number(deltas.aeo_readiness ?? 0),
 *   ].filter((v) => Number.isFinite(v)))
 *
 * The `Number.isFinite` filter reads as a null guard and is not one. `?? 0` is applied first,
 * so an unavailable dimension arrives at the filter as the number 0 — which is finite, and is
 * kept. The filter can only ever remove a NaN. So the numerator absorbed a fabricated parity
 * reading and the denominator stayed pinned at 5 regardless of how much was observed.
 *
 * WHY IT IS NOT HYPOTHETICAL. `geo_presence` is `number | null` in the canonical
 * `ComparisonMetrics` because no page crawl can establish it, and `subtractMetrics` nulls any
 * delta whose operands are not both numeric. On a real competitive baseline it is therefore
 * null on EVERY competitor, so every standing was computed as (4 real deltas) / 5 — diluted
 * exactly 1/5 of the way toward parity before `clamp(60 − avgDelta × 3.2)` ever ran.
 *
 * THE CONTRACT UNDER TEST. Average only dimensions with genuine numeric evidence; the
 * denominator equals the observed count; a genuine observed 0 still counts; and when nothing
 * is observable the entry abstains through the repository's existing route (the competitor
 * axis goes `insufficient_signal` with a null score) rather than publishing parity 60.
 *
 * SECRETS: all synthetic. No network, no credential, no real property.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { readFileSync } from 'fs';
import { join } from 'path';

import { buildSnapshotVisualIntelligence } from '../../services/snapshotReport/visualIntelligenceHelpers';
import { COMPETITOR_STANDING } from '../../services/canonicalReport/scoringGovernance';
import type { ComparisonMetrics } from '../../services/competitor/competitorMetricsTypes';

/** A deltas_vs_company record; `null` on a dimension means UNAVAILABLE, never zero. */
type Deltas = { [K in keyof ComparisonMetrics]?: number | null };

/**
 * The five dimensions this averager reads. `publishing_frequency` and `engagement_score` are
 * part of ComparisonMetrics but were never inputs to the standing and still are not.
 */
const STANDING_DIMENSIONS = [
  'content_depth',
  'authority_score',
  'seo_coverage',
  'geo_presence',
  'aeo_readiness',
] as const;

const radarFor = (deltasList: Array<Deltas | null>) =>
  buildSnapshotVisualIntelligence({
    decisions: [],
    score: { dimensions: [] },
    competitorIntelligence: {
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
    },
    publicAudit: null,
  } as never).seo_capability_radar;

const standingFor = (deltas: Deltas) => radarFor([deltas]).competitor_intelligence_score;

/**
 * The PRE-FIX computation, reproduced verbatim from the shipped code so the regression cannot
 * be reverted silently. Every assertion that pins a corrected value also asserts it differs
 * from what this returns, which is what makes the suite fail against the old implementation.
 */
const legacyStanding = (deltas: Deltas): number | null => {
  const values = [
    Number(deltas.content_depth ?? 0),
    Number(deltas.authority_score ?? 0),
    Number(deltas.seo_coverage ?? 0),
    Number(deltas.geo_presence ?? 0),
    Number(deltas.aeo_readiness ?? 0),
  ].filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.min(100, Math.max(0, Math.round(COMPETITOR_STANDING.parity - mean * COMPETITOR_STANDING.slope)));
};

/** The contract: parity − mean(observed only) × slope, denominator = observed count. */
const expectedStanding = (observed: number[]): number => {
  const mean = observed.reduce((sum, value) => sum + value, 0) / observed.length;
  return Math.min(100, Math.max(0, Math.round(COMPETITOR_STANDING.parity - mean * COMPETITOR_STANDING.slope)));
};

// ── NON-VACUITY ──────────────────────────────────────────────────────────────
// A suite that silently stopped exercising the averager would otherwise pass on an empty
// match set. These assertions prove the fixture reaches the code under test at all.

describe('WP-15 · non-vacuity — the fixtures actually drive the averager', () => {
  it('the five standing dimensions are the ones the averager reads in the shipped source', () => {
    const source = readFileSync(
      join(__dirname, '../../services/snapshotReport/visualIntelligenceHelpers.ts'),
      'utf8',
    );
    const block = source.slice(
      source.indexOf('const competitorStandingValues'),
      source.indexOf('const technicalPenalty'),
    );
    expect(block.length).toBeGreaterThan(0);
    STANDING_DIMENSIONS.forEach((dimension) => {
      expect(block).toContain(`deltas.${dimension}`);
    });
  });

  it('a fully observed fixture produces a real, non-null standing from the real helper', () => {
    const observed = { content_depth: 12, authority_score: 8, seo_coverage: 6, geo_presence: 4, aeo_readiness: 10 };
    const value = standingFor(observed);
    expect(value).not.toBeNull();
    expect(typeof value).toBe('number');
    expect(radarFor([observed, observed]).axis_states.competitor_intelligence_score).toBe('measured');
  });

  it('the pre-fix reference and the contract genuinely disagree on a null dimension', () => {
    // If these ever agreed, every "differs from legacy" assertion below would be vacuous.
    const deltas = { content_depth: 10, authority_score: 10, seo_coverage: 10, geo_presence: null, aeo_readiness: 10 };
    expect(legacyStanding(deltas)).not.toBe(expectedStanding([10, 10, 10, 10]));
  });
});

// ── A. THE LIVE CASE: geo_presence null ──────────────────────────────────────

describe('WP-15 · A — a null geo_presence is excluded, not counted as parity', () => {
  const deltas: Deltas = {
    content_depth: 10, authority_score: 10, seo_coverage: 10, geo_presence: null, aeo_readiness: 10,
  };

  it('averages the four observed deltas over a denominator of four', () => {
    expect(standingFor(deltas)).toBe(expectedStanding([10, 10, 10, 10])); // mean 10 → 60 − 32 = 28
  });

  it('no longer reports the diluted pre-fix value', () => {
    expect(legacyStanding(deltas)).toBe(34); // (10+10+10+0+10)/5 = 8 → 60 − 25.6 = 34.4 → 34
    expect(standingFor(deltas)).not.toBe(legacyStanding(deltas));
  });

  it('a competitor genuinely ahead is not softened toward parity', () => {
    // The pre-fix value sat 6 points nearer parity (60) than the evidence supports.
    expect(standingFor(deltas) as number).toBeLessThan(legacyStanding(deltas) as number);
  });

  it('still publishes the standing as a real axis value, not an abstention', () => {
    const radar = radarFor([deltas, deltas]);
    expect(radar.competitor_intelligence_score).toBe(28);
    expect(radar.axis_states.competitor_intelligence_score).toBe('measured');
    expect(radar.source_tags.competitor_intelligence_score).toEqual(['competitor_intelligence', 'heuristic']);
  });
});

// ── B. OTHER NULL DIMENSIONS ────────────────────────────────────────────────

describe('WP-15 · B — the rule is per-dimension, not special-cased to geo_presence', () => {
  it('excludes a null aeo_readiness', () => {
    const deltas: Deltas = {
      content_depth: -5, authority_score: -5, seo_coverage: -5, geo_presence: -5, aeo_readiness: null,
    };
    expect(standingFor(deltas)).toBe(expectedStanding([-5, -5, -5, -5])); // 60 + 16 = 76
    expect(standingFor(deltas)).not.toBe(legacyStanding(deltas));
  });

  it('excludes two nulls at once (geo_presence and aeo_readiness)', () => {
    const deltas: Deltas = {
      content_depth: -5, authority_score: -5, seo_coverage: -5, geo_presence: null, aeo_readiness: null,
    };
    expect(standingFor(deltas)).toBe(expectedStanding([-5, -5, -5])); // 60 + 16 = 76
    expect(legacyStanding(deltas)).toBe(70); // (−5−5−5+0+0)/5 = −3 → 60 + 9.6 = 69.6 → 70
    expect(standingFor(deltas)).not.toBe(legacyStanding(deltas));
  });

  it('excludes each of the five dimensions on its own, and never averages it as zero', () => {
    STANDING_DIMENSIONS.forEach((dimension) => {
      const deltas = Object.fromEntries(
        STANDING_DIMENSIONS.map((key) => [key, key === dimension ? null : 10]),
      ) as Deltas;
      // Four observed +10s → mean 10, regardless of WHICH dimension is missing.
      expect(standingFor(deltas)).toBe(expectedStanding([10, 10, 10, 10]));
      expect(standingFor(deltas)).not.toBe(legacyStanding(deltas));
    });
  });

  it('treats an absent key exactly like an explicit null', () => {
    const explicit: Deltas = {
      content_depth: 10, authority_score: 10, seo_coverage: 10, geo_presence: null, aeo_readiness: 10,
    };
    const omitted: Deltas = { content_depth: 10, authority_score: 10, seo_coverage: 10, aeo_readiness: 10 };
    expect(standingFor(omitted)).toBe(standingFor(explicit));
  });
});

// ── C. NOTHING OBSERVED ⇒ ABSTAIN, NEVER FABRICATE PARITY ───────────────────

describe('WP-15 · C — all dimensions null yields the repository abstention state', () => {
  const allNull: Deltas = {
    content_depth: null, authority_score: null, seo_coverage: null, geo_presence: null, aeo_readiness: null,
  };

  it('publishes no competitor standing at all', () => {
    expect(standingFor(allNull)).toBeNull();
    expect(radarFor([allNull, allNull]).competitor_intelligence_score).toBeNull();
  });

  it('does not publish the fabricated parity value the pre-fix code produced', () => {
    expect(legacyStanding(allNull)).toBe(COMPETITOR_STANDING.parity); // 60 — a claim built on nothing
    expect(standingFor(allNull)).not.toBe(COMPETITOR_STANDING.parity);
  });

  it('uses the existing insufficient_signal state — no new state is invented', () => {
    const radar = radarFor([allNull, allNull]);
    expect(radar.axis_states.competitor_intelligence_score).toBe('insufficient_signal');
    expect(radar.source_tags.competitor_intelligence_score).toBeNull();
  });

  it('matches the state produced when deltas_vs_company is null outright', () => {
    const fromNullDeltas = radarFor([null, null]);
    const fromAllNullDimensions = radarFor([allNull, allNull]);
    expect(fromAllNullDimensions.competitor_intelligence_score).toBe(fromNullDeltas.competitor_intelligence_score);
    expect(fromAllNullDimensions.axis_states.competitor_intelligence_score)
      .toBe(fromNullDeltas.axis_states.competitor_intelligence_score);
  });

  it('one unobservable competitor does not drag down an observed one — it drops out', () => {
    const observed: Deltas = {
      content_depth: 10, authority_score: 10, seo_coverage: 10, geo_presence: null, aeo_readiness: 10,
    };
    const radar = radarFor([observed, allNull]);
    expect(radar.competitor_intelligence_score).toBe(28);
    // Only one competitor contributed a value, so the axis stays inferred rather than measured.
    expect(radar.axis_states.competitor_intelligence_score).toBe('inferred');
  });
});

// ── D. NO-REGRESSION: EVERY DIMENSION OBSERVED ──────────────────────────────

describe('WP-15 · D — a fully observed comparison behaves exactly as it does today', () => {
  const fullyObserved: Deltas = {
    content_depth: 12, authority_score: 8, seo_coverage: 6, geo_presence: 4, aeo_readiness: 10,
  };

  it('produces the identical pre-fix value when nothing is missing', () => {
    // mean 8 → 60 − 25.6 = 34.4 → 34, both before and after.
    expect(standingFor(fullyObserved)).toBe(legacyStanding(fullyObserved));
    expect(standingFor(fullyObserved)).toBe(34);
  });

  it('keeps the scoring anchors untouched — parity 60 at an exact tie', () => {
    const tied: Deltas = {
      content_depth: 0, authority_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0,
    };
    expect(standingFor(tied)).toBe(COMPETITOR_STANDING.parity);
    expect(standingFor(tied)).toBe(legacyStanding(tied));
  });

  it('keeps the slope anchors: +8 → ~35 behind, −6 → ~80 ahead', () => {
    const uniform = (value: number): Deltas => Object.fromEntries(
      STANDING_DIMENSIONS.map((key) => [key, value]),
    ) as Deltas;
    expect(standingFor(uniform(8))).toBe(34);
    expect(standingFor(uniform(-6))).toBe(79);
    expect(standingFor(uniform(8))).toBe(legacyStanding(uniform(8)));
    expect(standingFor(uniform(-6))).toBe(legacyStanding(uniform(-6)));
  });

  it('still clamps to 0..100 at the extremes', () => {
    const uniform = (value: number): Deltas => Object.fromEntries(
      STANDING_DIMENSIONS.map((key) => [key, value]),
    ) as Deltas;
    expect(standingFor(uniform(100))).toBe(0);
    expect(standingFor(uniform(-100))).toBe(100);
  });

  it('averages across competitors unchanged when all of them are fully observed', () => {
    const ahead: Deltas = Object.fromEntries(STANDING_DIMENSIONS.map((k) => [k, 10])) as Deltas; // → 28
    const behind: Deltas = Object.fromEntries(STANDING_DIMENSIONS.map((k) => [k, -10])) as Deltas; // → 92
    expect(radarFor([ahead, behind]).competitor_intelligence_score).toBe(60);
  });
});

// ── E. MIXED: DENOMINATOR TRACKS THE OBSERVED COUNT ─────────────────────────

describe('WP-15 · E — the denominator equals the number of observed dimensions', () => {
  it('two observed of five divides by two, not by five', () => {
    const deltas: Deltas = {
      content_depth: 20, authority_score: null, seo_coverage: null, geo_presence: null, aeo_readiness: 0,
    };
    // Observed [20, 0] → mean 10 → 60 − 32 = 28. The pre-fix code divided by 5 → mean 4 → 47.
    expect(standingFor(deltas)).toBe(expectedStanding([20, 0]));
    expect(standingFor(deltas)).toBe(28);
    expect(legacyStanding(deltas)).toBe(47);
  });

  it('a genuinely observed zero is evidence and IS counted', () => {
    const withObservedZero: Deltas = {
      content_depth: 20, authority_score: null, seo_coverage: null, geo_presence: null, aeo_readiness: 0,
    };
    const withoutIt: Deltas = {
      content_depth: 20, authority_score: null, seo_coverage: null, geo_presence: null, aeo_readiness: null,
    };
    // Dropping a real 0 would change the mean from 10 to 20 — so the two must differ.
    expect(standingFor(withObservedZero)).toBe(expectedStanding([20, 0]));
    expect(standingFor(withoutIt)).toBe(expectedStanding([20]));
    expect(standingFor(withObservedZero)).not.toBe(standingFor(withoutIt));
  });

  it('one observed dimension of five divides by one', () => {
    const deltas: Deltas = {
      content_depth: null, authority_score: null, seo_coverage: 5, geo_presence: null, aeo_readiness: null,
    };
    expect(standingFor(deltas)).toBe(expectedStanding([5])); // 60 − 16 = 44
    expect(legacyStanding(deltas)).toBe(57); // 5/5 = 1 → 60 − 3.2 = 56.8 → 57
  });

  it('the denominator is the observed count for every arity from one to five', () => {
    const observedCounts = [1, 2, 3, 4, 5];
    const results = observedCounts.map((count) => {
      const deltas = Object.fromEntries(
        STANDING_DIMENSIONS.map((key, index) => [key, index < count ? 10 : null]),
      ) as Deltas;
      return standingFor(deltas);
    });
    expect(results).toHaveLength(5);
    // Every arity sees only +10s, so the mean is 10 and the standing is 28 in all five cases.
    // Under a fixed denominator of 5 these would have been 28, 47, 41, 34 and 28 instead.
    expect(results).toEqual([28, 28, 28, 28, 28]);
  });

  it('a non-numeric delta is still excluded, as the finite check already ensured', () => {
    const deltas = {
      content_depth: 10, authority_score: 'n/a', seo_coverage: 10, geo_presence: undefined, aeo_readiness: NaN,
    } as unknown as Deltas;
    expect(standingFor(deltas)).toBe(expectedStanding([10, 10]));
  });
});
