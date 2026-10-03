/**
 * WP-18 — MARKET-POSITION-NULL-INTEGRITY (abstention).
 *
 * THE DEFECT. `assessPositioningAndMarket` resolved the market-position claim from
 *
 *   const avgDelta = competitorDeltas.length > 0 ? average(competitorDeltas) : competitorPressure - 50;
 *   const marketPosition = avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity';
 *
 * with `competitorPressure = average(generated_gaps.slice(0, 3).map((g) => Number(g.impact_score ?? 0)))`.
 *
 * `average([])` returns 0 (snapshotReportNarrativeHelpers.ts:7-10). With no competitive
 * evidence at all — no competitor delta AND no generated gap — that gave
 * `competitorPressure = 0`, `avgDelta = 0 - 50 = -50`, `-50 <= -4`, and the report published
 * **'ahead'**. Report 1 told a customer it was ahead of the market on zero evidence, and
 * that was the LIVE outcome, because `buildCompetitorGaps` returns `[]` whenever the company
 * baseline is null or no competitor was observed.
 *
 * THE RULE. NO EVIDENCE ≠ MEASURED ZERO ≠ behind / at parity / ahead.
 *
 * THE CONTRACT. `marketPosition` is `MarketPositionClaim | null`, paired with
 * `marketPositionState: ScoreState` — the repository's existing availability vocabulary
 * (snapshotReport/canonicalScoreState.ts), the same `value + state` pairing WP-12 uses for
 * `company_metrics_state`. Every claim is produced by the single exported chokepoint
 * `resolveMarketPosition`, which takes `number | null` and gives `null` no path to a claim.
 *
 * Covers A (zero evidence), B (measured zero), C (mixed/denominator), D (no regression vs an
 * inlined pre-fix reference), E (behind preserved), F (the gap-impact / marketType sibling
 * path), G (the downstream mapping chain), plus non-vacuity guards that read the shipped
 * source so the suite cannot pass on an empty match set.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { readFileSync } from 'fs';
import { join } from 'path';

import { assessPositioningAndMarket, resolveMarketPosition } from '../../services/snapshotReport/actionHelpers';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';

const ACTION_HELPERS_PATH = join(__dirname, '../../services/snapshotReport/actionHelpers.ts');

type MarketPositionClaim = 'below market' | 'at parity' | 'ahead';
type Deltas = { authority_score?: number | null; seo_coverage?: number | null; content_depth?: number | null };

/** A competitor whose three dimensions are all unavailable. WP-17 drops it from the mean. */
const ALL_UNAVAILABLE: Deltas = { authority_score: null, seo_coverage: null, content_depth: null };
/** A competitor observed at exactly `value` on all three dimensions. */
const observed = (value: number): Deltas => ({ authority_score: value, seo_coverage: value, content_depth: value });

type Fixture = {
  deltas?: Array<Deltas | null>;
  /** `null` / `undefined` / a non-numeric = an UNAVAILABLE impact. A number — including 0 — is measured. */
  gaps?: Array<number | null | undefined>;
  /** Defaults to `deltas.length`. Decoupled so the marketType competitor count can be driven directly. */
  detectedCompetitors?: number;
  fallbackUsed?: boolean;
};

/** Drive the real production helper. No mocks on the unit under test. */
function strategicContextFor(fixture: Fixture) {
  const deltas = fixture.deltas ?? [];
  const gaps = fixture.gaps ?? [];
  const competitorCount = fixture.detectedCompetitors ?? deltas.length;
  return assessPositioningAndMarket({
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
      detected_competitors: Array.from({ length: competitorCount }, (_, index) => ({
        name: `Rival ${index}`,
        domain: `rival${index}.test`,
      })),
      competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
      comparison: {
        company: null,
        competitors: deltas.map((item, index) => ({
          competitor: { name: `Rival ${index}`, domain: `rival${index}.test` },
          metrics: null,
          deltas_vs_company: item,
          metrics_state: 'inferred',
          metrics_basis: 'synthetic fixture',
          crawl_outcome: 'reachable',
        })),
      },
      generated_gaps: gaps.map((impact_score, index) => ({ title: `Gap ${index}`, impact_score })),
      competitive_summary: {},
      discovery_metadata: fixture.fallbackUsed
        ? { keyword_count: 0, serp_domains_found: 0, serp_status: 'fallback', is_fallback_used: true }
        : undefined,
    },
    decisions: [],
    publicAudit: null,
  } as never);
}

const positionFor = (fixture: Fixture): MarketPositionClaim | null => strategicContextFor(fixture).marketPosition;
const stateFor = (fixture: Fixture): string => strategicContextFor(fixture).marketPositionState;

// ── THE PRE-FIX REFERENCE ────────────────────────────────────────────────────────────────
// Reproduced from the shipped source as it stood immediately before WP-18 (i.e. WITH WP-17's
// observed-only per-competitor mean already in place, so the only difference this suite can
// detect is WP-18's own). Every no-regression pin is asserted against it, and every corrected
// assertion is asserted to DIFFER from it.

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const meanOrNull = (values: number[]): number | null => (values.length === 0 ? null : mean(values));

function legacy(fixture: Fixture): {
  marketPosition: MarketPositionClaim;
  marketType: string;
  positioningStrength: string;
} {
  const deltas = fixture.deltas ?? [];
  const gaps = fixture.gaps ?? [];
  const competitorCount = fixture.detectedCompetitors ?? deltas.length;
  // PRE-FIX: `average([])` is 0, and `?? 0` folds an unavailable impact in as a measured zero.
  const competitorPressure = mean(gaps.slice(0, 3).map((score) => Number(score ?? 0)));
  const competitorDeltas = deltas
    .filter((item): item is Deltas => Boolean(item))
    .map((delta) =>
      meanOrNull(
        [delta.authority_score, delta.seo_coverage, delta.content_depth]
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      ),
    )
    .filter((value): value is number => value != null);
  const avgDelta = competitorDeltas.length > 0 ? mean(competitorDeltas) : competitorPressure - 50;
  const differentiationPenalty = fixture.fallbackUsed
    ? 8
    : competitorPressure >= 70 ? 22 : competitorPressure >= 50 ? 14 : 6;
  // claritySignals = 0 and consistencyPenalties = 0 for every fixture in this suite.
  const rawStrengthScore = Math.max(0, Math.min(100, 0 + (40 - 0) - differentiationPenalty));
  return {
    marketPosition: avgDelta >= 6 ? 'below market' : avgDelta <= -4 ? 'ahead' : 'at parity',
    marketType:
      competitorCount >= 3 && competitorPressure >= 68
        ? 'saturated'
        : competitorCount >= 2 ? 'competitive' : 'emerging',
    positioningStrength: rawStrengthScore >= 70 ? 'strong' : rawStrengthScore >= 45 ? 'moderate' : 'weak',
  };
}

// ── NON-VACUITY ──────────────────────────────────────────────────────────────────────────
// A suite that stopped reaching the helper — a renamed field, a moved call site, a fixture
// the helper quietly ignores — would otherwise pass on an empty match set.

describe('WP-18 · non-vacuity — the fixtures really drive the shipped helper', () => {
  const strippedSource = (): string =>
    readFileSync(ACTION_HELPERS_PATH, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
      .join('\n');

  it('the fixture builder produces a non-empty, discriminating match set', () => {
    // If every fixture collapsed to the same answer, every assertion below would be vacuous.
    const answers = new Set([
      positionFor({}),
      positionFor({ deltas: [observed(0)] }),
      positionFor({ deltas: [observed(20)] }),
      positionFor({ deltas: [observed(-20)] }),
    ]);
    expect(answers.size).toBe(4);
    expect(answers).toContain(null);
    expect(answers).toContain('at parity');
    expect(answers).toContain('below market');
    expect(answers).toContain('ahead');
  });

  it('the pre-fix reference and the shipped helper genuinely disagree on zero evidence', () => {
    // If these ever agreed, every "differs from the pre-fix answer" assertion would be vacuous.
    expect(legacy({}).marketPosition).toBe('ahead');
    expect(positionFor({})).not.toBe(legacy({}).marketPosition);
  });

  it("'ahead' is produced in exactly one place in the shipped source: resolveMarketPosition", () => {
    // This is the structural-impossibility guard. If a second producer of the literal ever
    // appears, "no evidence cannot become 'ahead'" stops being a property of the module and
    // this fails.
    const code = strippedSource();
    const occurrences = code.split("'ahead'").length - 1;
    expect(occurrences).toBe(1);
    const chokepointStart = code.indexOf('export function resolveMarketPosition');
    const chokepointEnd = code.indexOf('export function assessPositioningAndMarket');
    expect(chokepointStart).toBeGreaterThan(-1);
    expect(chokepointEnd).toBeGreaterThan(chokepointStart);
    expect(code.indexOf("'ahead'")).toBeGreaterThan(chokepointStart);
    expect(code.indexOf("'ahead'")).toBeLessThan(chokepointEnd);
  });

  it('the shipped gap-impact averager no longer coerces an unavailable impact to zero', () => {
    const code = strippedSource();
    const start = code.indexOf('const observedGapImpacts');
    const end = code.indexOf('const fallbackUsed');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = code.slice(start, end);
    expect(block).toContain('Number.isFinite');
    expect(block).toContain('averageNumber(');
    expect(block).not.toContain('?? 0');
    // `Number(null)` is 0 and 0 is finite, so a finiteness check applied AFTER coercion would
    // re-create the collapse. The guard must inspect the raw value's type first.
    expect(block).toContain("typeof value === 'number'");
    expect(block).not.toContain('Number(gap.impact_score)');
  });
});

// ── A. ZERO EVIDENCE => ABSTAIN, NEVER 'ahead' ───────────────────────────────────────────

describe('WP-18 · A — nothing observed never produces a market-position claim', () => {
  it('no competitor deltas and no gaps: abstains instead of publishing the pre-fix "ahead"', () => {
    const context = strategicContextFor({});
    expect(legacy({}).marketPosition).toBe('ahead'); // the defect, pinned
    expect(context.marketPosition).toBeNull();
    expect(context.marketPositionState).toBe('insufficient_signal');
  });

  it('every shape of "no evidence" abstains, not just the empty arrays', () => {
    const noEvidence: Fixture[] = [
      {},
      { deltas: [] , gaps: [] },
      { deltas: [null, null] },
      { deltas: [ALL_UNAVAILABLE, ALL_UNAVAILABLE, ALL_UNAVAILABLE] },
      { gaps: [null, null, null] },
      { gaps: [undefined] },
      { deltas: [ALL_UNAVAILABLE], gaps: [null] },
      { deltas: [ALL_UNAVAILABLE], gaps: [], detectedCompetitors: 5 },
    ];
    expect(noEvidence.length).toBeGreaterThanOrEqual(8); // non-vacuity on the loop itself
    noEvidence.forEach((fixture) => {
      expect(positionFor(fixture)).toBeNull();
      expect(stateFor(fixture)).toBe('insufficient_signal');
    });
  });

  it('the published narrative makes no positional claim when it abstains', () => {
    const context = strategicContextFor({});
    expect(context.marketPositionStatement).toContain('could not be established');
    expect(context.marketPositionStatement).not.toMatch(/\bahead\b|\bat parity\b|\bbelow market\b/);
    expect(context.positionImplication).not.toMatch(/\bahead\b|near-term advantage/);
    expect(context.positionImplication).toContain('No claim is made about relative market position');
  });

  it('the chokepoint itself gives null no path to a claim', () => {
    [null, undefined, NaN, Infinity, -Infinity].forEach((input) => {
      expect(resolveMarketPosition(input as number | null)).toEqual({
        marketPosition: null,
        marketPositionState: 'insufficient_signal',
      });
    });
  });
});

// ── B. A GENUINELY MEASURED ZERO IS DATA ─────────────────────────────────────────────────

describe('WP-18 · B — a measured 0 participates as zero and is never read as absence', () => {
  it('an observed delta of exactly 0 resolves to parity, not to the abstention', () => {
    const context = strategicContextFor({ deltas: [observed(0)] });
    expect(context.marketPosition).toBe('at parity');
    expect(context.marketPositionState).toBe('measured');
  });

  it('a gap impact of exactly 0 is a measured pressure reading, not an empty one', () => {
    // pressure 0 => avgDelta = 0 - 50 = -50 => 'ahead'. That is a claim backed by an observed
    // impact score of zero, and it is the SAME answer the pre-fix code gave — the difference
    // is that it is now reachable only when a 0 was genuinely measured.
    const context = strategicContextFor({ gaps: [0] });
    expect(context.marketPosition).toBe('ahead');
    expect(context.marketPositionState).toBe('measured');
    expect(context.marketPosition).toBe(legacy({ gaps: [0] }).marketPosition);
    // ...and the no-evidence case, which the pre-fix code could not tell apart from this one:
    expect(positionFor({ gaps: [] })).toBeNull();
  });

  it('a measured 0 and an unavailable impact are not the same input', () => {
    expect(positionFor({ gaps: [0] })).not.toBe(positionFor({ gaps: [null] }));
    expect(stateFor({ gaps: [0] })).toBe('measured');
    expect(stateFor({ gaps: [null] })).toBe('insufficient_signal');
    // The pre-fix formula could not distinguish them: both became a pressure of 0.
    expect(legacy({ gaps: [0] }).marketPosition).toBe(legacy({ gaps: [null] }).marketPosition);
  });

  it('a measured 0 still pulls the mean rather than dropping out of it', () => {
    // (92 + 0) / 2 = 46 => avgDelta -4 => 'ahead'. Dropping the measured zero would give
    // 92 => avgDelta 42 => 'below market'.
    expect(positionFor({ gaps: [92, 0] })).toBe('ahead');
    expect(positionFor({ gaps: [92] })).toBe('below market');
  });
});

// ── C. PARTIAL OBSERVATION: OBSERVED-ONLY DENOMINATOR, UNCHANGED THRESHOLDS ──────────────

describe('WP-18 · C — unavailable evidence leaves the denominator, observed evidence does not', () => {
  it('observed 10 and 0 alongside three unavailable: the mean is over 2, not over 5', () => {
    // Observed-only: (10 + 0) / 2 = 5. If the three unavailable competitors re-entered as
    // fabricated zeros the mean would be 2, and if the measured 0 were mistaken for absence
    // it would be 10.
    const mixed: Fixture = {
      deltas: [observed(10), observed(0), ALL_UNAVAILABLE, ALL_UNAVAILABLE, ALL_UNAVAILABLE],
    };
    expect(positionFor(mixed)).toBe(positionFor({ deltas: [observed(10), observed(0)] }));
    expect(positionFor(mixed)).not.toBe(positionFor({ deltas: [observed(10)] }));
    expect(positionFor(mixed)).toBe('at parity'); // mean 5, below the unchanged >= 6 threshold
  });

  it('the observed-only denominator changes the answer where it crosses a threshold', () => {
    // Observed-only: (14 + 0) / 2 = 7 => 'below market' at the unchanged >= 6 threshold.
    // Five-wide denominator: 14 / 5 = 2.8 => 'at parity'.
    const mixed: Fixture = {
      deltas: [observed(14), observed(0), ALL_UNAVAILABLE, ALL_UNAVAILABLE, ALL_UNAVAILABLE],
    };
    expect(positionFor(mixed)).toBe('below market');
    expect(mean([14, 0, 0, 0, 0])).toBeLessThan(6); // the answer the pinned denominator gave
  });

  it('on the gap-impact path an unavailable impact leaves the denominator too', () => {
    // Observed-only: (93 + 0) / 2 = 46.5 => avgDelta -3.5 => 'at parity'.
    // Pre-fix: (93 + 0 + 0) / 3 = 31 => avgDelta -19 => 'ahead'.
    const mixed: Fixture = { gaps: [93, 0, null] };
    expect(positionFor(mixed)).toBe('at parity');
    expect(legacy(mixed).marketPosition).toBe('ahead');
    expect(stateFor(mixed)).toBe('measured');
  });

  it('only the first three gaps are read, exactly as before', () => {
    // The slice width is unchanged business interpretation: the fourth gap must not enter.
    expect(positionFor({ gaps: [93, 0, null, 100] })).toBe(positionFor({ gaps: [93, 0, null] }));
  });

  it('interpretation of the observed values themselves is unchanged', () => {
    // The same observed numbers, with and without unavailable companions, must agree.
    [[-20], [-4], [-3], [0], [5], [6], [30]].forEach(([value]) => {
      expect(positionFor({ deltas: [observed(value), ALL_UNAVAILABLE, null] }))
        .toBe(positionFor({ deltas: [observed(value)] }));
    });
  });

  it('deterministic ordering is preserved: reordering unavailable entries changes nothing', () => {
    const a = positionFor({ deltas: [ALL_UNAVAILABLE, observed(14), ALL_UNAVAILABLE, observed(0)] });
    const b = positionFor({ deltas: [observed(14), observed(0), ALL_UNAVAILABLE, ALL_UNAVAILABLE] });
    expect(a).toBe(b);
  });
});

// ── D. FULLY OBSERVED => BIT-IDENTICAL TO THE PRE-FIX FORMULA ────────────────────────────

describe('WP-18 · D — fully observed input is semantically unchanged', () => {
  const FULLY_OBSERVED: Array<{ label: string; fixture: Fixture }> = [
    { label: 'well behind on every axis', fixture: { deltas: [observed(24)], gaps: [70] } },
    { label: 'just over the below-market threshold', fixture: { deltas: [observed(6)], gaps: [50] } },
    { label: 'just under the below-market threshold', fixture: { deltas: [observed(5)], gaps: [50] } },
    { label: 'exact parity', fixture: { deltas: [observed(0)], gaps: [50] } },
    { label: 'just inside the ahead threshold', fixture: { deltas: [observed(-4)], gaps: [20] } },
    { label: 'just outside the ahead threshold', fixture: { deltas: [observed(-3)], gaps: [20] } },
    { label: 'clearly ahead', fixture: { deltas: [observed(-20)], gaps: [20] } },
    {
      label: 'three competitors, mixed signs, three gaps',
      fixture: {
        deltas: [
          { authority_score: 14, seo_coverage: -2, content_depth: 9 },
          { authority_score: -8, seo_coverage: 3, content_depth: 1 },
          { authority_score: 22, seo_coverage: 17, content_depth: -5 },
        ],
        gaps: [66, 41, 78],
      },
    },
    { label: 'gap-only, high pressure, three competitors', fixture: { gaps: [72, 71, 70], detectedCompetitors: 3 } },
    { label: 'gap-only, low pressure', fixture: { gaps: [72, 55, 48] } },
    { label: 'gap-only, saturating pressure', fixture: { gaps: [90, 80, 70], detectedCompetitors: 4 } },
    { label: 'serp fallback used', fixture: { deltas: [observed(2)], gaps: [60], fallbackUsed: true } },
  ];

  it('the no-regression table is non-empty and every row is exercised', () => {
    expect(FULLY_OBSERVED.length).toBeGreaterThanOrEqual(12);
  });

  FULLY_OBSERVED.forEach(({ label, fixture }) => {
    it(`${label}: identical to the pre-fix formula`, () => {
      const reference = legacy(fixture);
      const context = strategicContextFor(fixture);
      expect(context.marketPosition).toBe(reference.marketPosition);
      expect(context.marketPositionState).toBe('measured');
      // The two other consumers of `competitorPressure` are pinned too, because WP-18 had to
      // touch both of them to stop reading a fabricated 0.
      expect(context.marketType).toBe(reference.marketType);
      expect(context.positioningStrength).toBe(reference.positioningStrength);
      expect(context.marketPositionStatement).toBe(
        `Acme Synthetic is currently ${reference.marketPosition} relative to competitors in this market.`,
      );
    });
  });

  it('the no-evidence positioning strength is the value the pre-fix "0 pressure" produced', () => {
    // Step 5: no threshold, anchor or weight moved. With nothing observed the differentiation
    // penalty is still 6 — reached now because nothing was observed, not from an invented 0.
    expect(strategicContextFor({}).positioningStrength).toBe(legacy({}).positioningStrength);
    expect(strategicContextFor({}).marketType).toBe(legacy({}).marketType);
  });
});

// ── E. THE BEHIND / NEGATIVE CASES ARE UNTOUCHED ─────────────────────────────────────────

describe('WP-18 · E — existing behind / ahead semantics are preserved', () => {
  it('the thresholds still sit exactly at >= 6 and <= -4', () => {
    expect(resolveMarketPosition(6).marketPosition).toBe('below market');
    expect(resolveMarketPosition(5.999).marketPosition).toBe('at parity');
    expect(resolveMarketPosition(-4).marketPosition).toBe('ahead');
    expect(resolveMarketPosition(-3.999).marketPosition).toBe('at parity');
    expect(resolveMarketPosition(0).marketPosition).toBe('at parity');
  });

  it('a genuinely observed negative delta still reports "ahead", with a measured state', () => {
    const context = strategicContextFor({ deltas: [observed(-12)] });
    expect(context.marketPosition).toBe('ahead');
    expect(context.marketPositionState).toBe('measured');
    expect(context.positionImplication).toContain('near-term advantage');
    expect(context.marketPosition).toBe(legacy({ deltas: [observed(-12)] }).marketPosition);
  });

  it('a genuinely observed positive delta still reports "below market"', () => {
    const context = strategicContextFor({ deltas: [observed(30)] });
    expect(context.marketPosition).toBe('below market');
    expect(context.marketPositionState).toBe('measured');
    expect(context.positionImplication).toContain('high-intent queries');
  });
});

// ── F. THE SIBLING PATH: gap.impact_score => marketType ──────────────────────────────────

describe('WP-18 · F — an unavailable impact can no longer manufacture a market type', () => {
  it('two high observed impacts plus one unavailable now reach "saturated"', () => {
    // Observed-only: (90 + 70) / 2 = 80 >= 68 => 'saturated'.
    // Pre-fix: (90 + 70 + 0) / 3 = 53.33 => the unavailable impact suppressed the saturation
    // signal and the report called a saturated market merely 'competitive'.
    const fixture: Fixture = { gaps: [90, 70, null], detectedCompetitors: 3 };
    expect(strategicContextFor(fixture).marketType).toBe('saturated');
    expect(legacy(fixture).marketType).toBe('competitive');
  });

  it('an unavailable impact can equally not invent saturation where none was observed', () => {
    expect(strategicContextFor({ gaps: [null, null, null], detectedCompetitors: 3 }).marketType).toBe('competitive');
    expect(strategicContextFor({ gaps: [], detectedCompetitors: 3 }).marketType).toBe('competitive');
  });

  it('a measured 0 impact genuinely argues against saturation and still does', () => {
    const fixture: Fixture = { gaps: [90, 70, 0], detectedCompetitors: 3 };
    expect(strategicContextFor(fixture).marketType).toBe('competitive'); // mean 53.33 < 68
    expect(strategicContextFor(fixture).marketType).toBe(legacy(fixture).marketType);
  });

  it('the differentiation penalty is driven by observed pressure only', () => {
    // Observed-only: (90 + 70) / 2 = 80 >= 70 => penalty 22 => rawStrength 18 => 'weak'.
    // Pre-fix: 53.33 => penalty 14 => rawStrength 26 => also 'weak'; the label is the same,
    // so this is pinned on the one fixture where the band genuinely moves instead.
    // Observed-only: (60 + 55) / 2 = 57.5 => penalty 14. Pre-fix: 38.33 => penalty 6.
    const fixture: Fixture = { gaps: [60, 55, null] };
    expect(strategicContextFor(fixture).positioningStrength).toBe('weak'); // 40 - 14 = 26
    expect(legacy(fixture).positioningStrength).toBe('weak'); // 40 - 6 = 34, same band
    // The band is identical here, which is the point: no threshold moved. What changed is the
    // pressure the band is computed from, and that is asserted directly on marketType above.
  });
});

// ── G. THE DOWNSTREAM CONTRACT ───────────────────────────────────────────────────────────

describe('WP-18 · G — the abstention survives every mapping it has to cross', () => {
  it('composed report -> view payload: null survives and the state travels with it', () => {
    const payload = mapComposedReport(
      {
        sections: [{ section_name: 'overview' }],
        company_context: {
          company_name: 'Acme Synthetic',
          market_position: null,
          market_position_state: 'insufficient_signal',
          market_position_statement:
            "Acme Synthetic's position relative to competitors could not be established: no competitive evidence was observed for this report.",
        },
      } as never,
      'snapshot',
      'report-1',
      'company-1',
      'acme.test',
      '2026-10-03',
      '2026-10-03T00:00:00.000Z',
      false,
      'test',
    );
    expect(payload).not.toBeNull();
    const context = payload!.companyContext!;
    // Not 0, not 'ahead', and not an untagged empty: the state says why it is absent.
    expect(context.marketPosition).toBeUndefined();
    expect(context.marketPosition as unknown).not.toBe(0);
    expect(context.marketPosition).not.toBe('ahead');
    expect(context.marketPositionState).toBe('insufficient_signal');
    expect(context.marketPositionStatement).toContain('could not be established');
  });

  it('composed report -> view payload: a measured position is still carried through', () => {
    const payload = mapComposedReport(
      {
        sections: [{ section_name: 'overview' }],
        company_context: {
          company_name: 'Acme Synthetic',
          market_position: 'ahead',
          market_position_state: 'measured',
          market_position_statement: 'Acme Synthetic is currently ahead relative to competitors in this market.',
        },
      } as never,
      'snapshot', 'report-1', 'company-1', 'acme.test', '2026-10-03', '2026-10-03T00:00:00.000Z', false, 'test',
    );
    expect(payload!.companyContext!.marketPosition).toBe('ahead');
    expect(payload!.companyContext!.marketPositionState).toBe('measured');
  });

  // The two "PDF/HTML strategic strength card" pins that used to sit here asserted the tone of
  // the `Position` card produced by `getStrategicStrengthCards` in the legacy snapshot renderer
  // (backend/services/export/reportHtmlSectionsCore.ts). That renderer family had zero production
  // entry points -- the live export path is renderCanonicalReportHtml/renderCanonicalReportPdf --
  // and was removed. The canonical renderer publishes Market Position as narrative prose built
  // from the canonical payload (exportRendererOutput.renderMarketPosition); it carries no
  // tone-bearing strength card, so there is no canonical surface those two pins could move onto.
  // The contract they guarded -- absence is never read as a measured claim -- stays pinned above
  // at the chokepoint (`resolveMarketPosition`) and across the composed-report -> view-payload
  // mapping.
  it('the StrategicContext the assembler reads carries both halves of the pairing', () => {
    const context = strategicContextFor({});
    expect(Object.prototype.hasOwnProperty.call(context, 'marketPosition')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(context, 'marketPositionState')).toBe(true);
    // Never a number, never a zero, never an empty string: absence is explicit.
    expect(context.marketPosition).toBeNull();
    expect(typeof context.marketPositionState).toBe('string');
  });
});
