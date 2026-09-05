/**
 * GAP-04 — a canonical score may not carry a number its own state denies.
 *
 * THE DEFECT. `scoreFromAxis` copied `value` through verbatim, so a caller that computed a number
 * and then classified the evidence as insufficient produced a contradictory object.
 * `aggregateOverallScore` did exactly that: it takes the geometric mean of whatever pillars ARE
 * measured, then derives the state from how many of them there were — and when fewer than half
 * qualified it returned the number anyway:
 *
 *     { value: 10, state: 'insufficient_signal' }
 *
 * That object was observed in six live production reports and flowed into the stored record, the
 * JSON API and the Report 2 baseline. Every HTML renderer re-checked the state and printed `—`,
 * which is why it stayed invisible: it only bit where a consumer trusted `.value` alone.
 *
 * THE INVARIANT NOW ENFORCED AT CONSTRUCTION:
 *
 *     state ∈ { insufficient_signal, unavailable }  →  value === null
 *     state ∈ { measured, inferred }                →  value may be numeric, 0 included
 *
 * `inferred` deliberately keeps its number — it is a labelled, evidence-backed reading the report
 * already renders. Blanking it would be a scoring-model change, not an integrity fix.
 *
 * These tests run the REAL composer, and Test D asserts the invariant across EVERY score in the
 * report — overall, all five pillars, all nine dimensions, and the provider surfaces — not just
 * the one the audit happened to catch.
 */
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { aggregateOverallScore, isMeasured } from '../../services/canonicalReport/canonicalReportBuilderInputs';
import { emptyEvidenceTrace } from '../../services/canonicalReport/canonicalReportTypes';
import type { CanonicalPillarScore, CanonicalScore, PillarKey } from '../../services/canonicalReport/canonicalReportTypes';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(180_000);

function resolvedInput(): ResolvedReportInput {
  return {
    companyId: 'gap04-company', reportCategory: 'snapshot', profile: null, requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: 'Northwind Analytics', websiteDomain: 'northwind-analytics.test',
      businessType: null, geography: null, socialLinks: [], competitors: [],
      source: 'manual-entry', uploadedFileName: null, manualData: null,
      companyContext: {
        marketFocus: null, productServices: [], targetCustomer: null, idealCustomerProfile: null,
        brandPositioning: null, competitiveAdvantages: null, teamSize: null, foundedYear: null, revenueRange: null,
      },
    },
    integrations: Object.fromEntries(
      ['google_analytics', 'google_search_console', 'google_ads', 'linkedin_ads', 'meta_ads', 'shopify',
        'woocommerce', 'social_accounts', 'wordpress', 'custom_blog_api', 'lead_webhook', 'website_crawl',
        'data_upload', 'manual_entry'].map((k) => [k, { connected: k === 'website_crawl', source: 'system', label: k }]),
    ) as ResolvedReportInput['integrations'],
  };
}

/** A pillar carrying an explicit score, for driving `aggregateOverallScore` directly. */
const pillar = (key: PillarKey, value: number | null, state: CanonicalScore['state']): CanonicalPillarScore => ({
  pillar: key,
  label: key,
  purpose: '',
  score: {
    value, state, confidence: 'low',
    band: state === 'measured' || state === 'inferred' ? 'developing' : 'insufficient',
    evidence: emptyEvidenceTrace(), benchmark: { value: null, label: null },
  },
  dimensions: [],
  primary_signal: null,
});

const ALL_PILLARS: PillarKey[] = ['foundation', 'authority', 'discoverability', 'trust', 'momentum'];

let report: SnapshotReport;
beforeAll(async () => {
  report = await composeSnapshotReportFromDecisions({
    companyId: 'gap04-company', snapshotDecisions: [], supplementalGrowthDecisions: [],
    resolvedInput: resolvedInput(),
  });
});

describe('GAP-04 · Test A — an insufficient score carries no number', () => {
  it('nulls the value when too few pillars are measured (the exact production defect)', () => {
    // Two measured pillars out of five: below the half threshold, so the aggregate classifies the
    // evidence as insufficient. Pre-fix this returned the geometric mean anyway.
    const result = aggregateOverallScore([
      pillar('foundation', 100, 'inferred'),
      pillar('discoverability', 1, 'inferred'),
      pillar('authority', null, 'insufficient_signal'),
      pillar('trust', null, 'insufficient_signal'),
      pillar('momentum', null, 'insufficient_signal'),
    ]);
    expect(result.state).toBe('insufficient_signal');
    expect(result.value).toBeNull();
    expect(result.band).toBe('insufficient');
  });

  it('nulls the value for an unavailable state too', () => {
    const result = aggregateOverallScore([pillar('foundation', 80, 'unavailable')]);
    expect(result.value).toBeNull();
  });

  it('keeps the evidence trace — nulling the number is not discarding the provenance', () => {
    const result = aggregateOverallScore([
      pillar('foundation', 100, 'inferred'),
      pillar('authority', null, 'insufficient_signal'),
      pillar('trust', null, 'insufficient_signal'),
      pillar('momentum', null, 'insufficient_signal'),
      pillar('discoverability', null, 'insufficient_signal'),
    ]);
    expect(result.evidence).toBeDefined();
    expect(result.state).toBe('insufficient_signal');
  });
});

describe('GAP-04 · Test B — a measured zero survives', () => {
  it('never nulls a measured zero — it stays a number', () => {
    const result = aggregateOverallScore(ALL_PILLARS.map((k) => pillar(k, 0, 'measured')));
    expect(result.state).toBe('measured');
    // The distinction the whole fix exists to protect: "we looked and found nothing" keeps a
    // number; "we could not look" does not.
    expect(result.value).not.toBeNull();
    expect(typeof result.value).toBe('number');
    // NOTE: the aggregate reads 1, not 0, because `geometricMean` floors every input at
    // `Math.max(1, v)` so one zero cannot collapse the product. That is pre-existing scoring
    // behaviour and deliberately untouched here — GAP-04 is a state/value integrity fix, not a
    // scoring-model change. What matters for this gap is only that the value is not nulled.
    expect(result.value).toBe(1);
  });

  it('distinguishes a measured zero from an unmeasured null', () => {
    const measuredZero = aggregateOverallScore(ALL_PILLARS.map((k) => pillar(k, 0, 'measured')));
    const unmeasured = aggregateOverallScore(ALL_PILLARS.map((k) => pillar(k, null, 'insufficient_signal')));
    expect(measuredZero.value).not.toBeNull();
    expect(unmeasured.value).toBeNull();
    expect(measuredZero.state).not.toBe(unmeasured.state);
  });

  it('treats a measured zero as measured at the predicate level', () => {
    // The constructor gate is `isMeasured`, so this is the property that stops a genuine 0 from
    // being swept away with the unmeasured scores.
    expect(isMeasured(0, 'measured')).toBe(true);
    expect(isMeasured(0, 'inferred')).toBe(true);
    expect(isMeasured(0, 'insufficient_signal')).toBe(false);
    expect(isMeasured(null, 'measured')).toBe(false);
  });

  it('keeps zero-valued scores in the real report rather than nulling them', () => {
    // Production carried `discoverability = 0 (inferred)`. Any zero that survives composition
    // must still be paired with a state that permits a number.
    const zeros = [
      ...report.canonical.pillars.map((p) => ({ label: `pillar:${p.pillar}`, score: p.score })),
      ...report.canonical.pillars.flatMap((p) => p.dimensions.map((d) => ({ label: `dim:${d.key}`, score: d.score }))),
    ].filter((s) => s.score.value === 0);
    for (const z of zeros) {
      expect(['measured', 'inferred']).toContain(z.score.state);
    }
  });
});

describe('GAP-04 · Test C — measured non-zero scores are unchanged', () => {
  it('returns the same number the scoring formula always produced', () => {
    // Geometric mean of five 64s is 64. The formula is untouched by this fix.
    const result = aggregateOverallScore(ALL_PILLARS.map((k) => pillar(k, 64, 'measured')));
    expect(result.state).toBe('measured');
    expect(result.value).toBe(64);
  });

  it('keeps an inferred reading numeric — inferred is a claim, not an absence', () => {
    const result = aggregateOverallScore([
      pillar('foundation', 50, 'measured'),
      pillar('authority', 50, 'measured'),
      pillar('discoverability', 50, 'measured'),
      pillar('trust', null, 'insufficient_signal'),
      pillar('momentum', null, 'insufficient_signal'),
    ]);
    expect(result.state).toBe('inferred');
    expect(result.value).toBe(50);
  });
});

describe('GAP-04 · Test D — the invariant holds across the WHOLE report', () => {
  it('has no score anywhere carrying a number its state denies', () => {
    const offenders: string[] = [];
    const check = (label: string, score: CanonicalScore | null | undefined) => {
      if (!score) return;
      const denies = score.state === 'insufficient_signal' || score.state === 'unavailable';
      if (denies && score.value !== null) offenders.push(`${label}: value=${score.value} state=${score.state}`);
      // The converse must also hold — a band may not claim a level with no number behind it.
      if (denies && score.band !== 'insufficient') offenders.push(`${label}: band=${score.band} state=${score.state}`);
    };

    const c = report.canonical;
    check('authority_overview.overall_score', c.authority_overview.overall_score);
    for (const p of c.pillars) {
      check(`pillar:${p.pillar}`, p.score);
      for (const d of p.dimensions) check(`dimension:${d.key}`, d.score);
    }
    check('ai_surface_presence', c.ai_surface_presence.score);
    check('knowledge_graph', c.knowledge_graph.score);
    check('authority_inflow', c.authority_inflow.score);
    check('trust_coherence', c.trust_coherence.score);
    check('ai_citation_matrix.overall', c.ai_surface_presence.citation_matrix?.overall_score);

    expect(offenders).toEqual([]);
  });

  it('covers every pillar and dimension, so the assertion above is not vacuous', () => {
    expect(report.canonical.pillars).toHaveLength(5);
    const dimensionCount = report.canonical.pillars.flatMap((p) => p.dimensions).length;
    expect(dimensionCount).toBeGreaterThanOrEqual(9);
  });

  it('agrees with the shared isMeasured predicate for every score', () => {
    for (const p of report.canonical.pillars) {
      for (const d of p.dimensions) {
        // value non-null ⟺ isMeasured. No third state is possible any more.
        expect(d.score.value !== null).toBe(isMeasured(d.score.value, d.score.state));
      }
    }
  });
});

describe('GAP-04 · Test E — an insufficient score cannot become Report 2 authority', () => {
  // The gate `buildSnapshotFoundationForPerformance` now applies, exercised directly so the test
  // does not have to run a whole Report 2 composition to prove the boundary rule.
  const resolveAuthority = (
    canonical: { value: number | null; state: string; band: string } | undefined,
    legacy: { value?: number | null; state?: string; label?: string } | undefined,
  ) => {
    const isUsable = (s: { value?: number | null; state?: string } | null | undefined): boolean =>
      Boolean(s) && typeof s!.value === 'number'
        && s!.state !== 'insufficient_signal' && s!.state !== 'unavailable';
    return isUsable(canonical)
      ? { value: canonical!.value as number, band: canonical!.band }
      : isUsable(legacy)
        ? { value: legacy!.value as number, band: legacy!.label ?? 'insufficient' }
        : null;
  };

  it('derives no numeric authority from an insufficient canonical score', () => {
    const authority = resolveAuthority(
      { value: null, state: 'insufficient_signal', band: 'insufficient' },
      { value: null, state: 'insufficient_signal', label: 'Insufficient' },
    );
    expect(authority).toBeNull();
  });

  it('does not fall through to a legacy number when the legacy score is also insufficient', () => {
    // The `??` chain used to do exactly this. Nulling the canonical value alone would have
    // opened the fallback rather than closing the hole.
    const authority = resolveAuthority(
      { value: null, state: 'insufficient_signal', band: 'insufficient' },
      { value: 42, state: 'insufficient_signal', label: 'Developing' },
    );
    expect(authority).toBeNull();
  });

  it('still produces numeric authority from a measured score', () => {
    const authority = resolveAuthority({ value: 71, state: 'measured', band: 'operational' }, undefined);
    expect(authority).toEqual({ value: 71, band: 'operational' });
  });

  it('takes the band from whichever source supplied the number', () => {
    const authority = resolveAuthority(
      { value: null, state: 'insufficient_signal', band: 'insufficient' },
      { value: 55, state: 'measured', label: 'Developing' },
    );
    // The legacy source won, so the legacy label travels with it — never the canonical band.
    expect(authority).toEqual({ value: 55, band: 'Developing' });
  });

  it('accepts an inferred reading as authority — it is a claim, not an absence', () => {
    const authority = resolveAuthority({ value: 33, state: 'inferred', band: 'foundational' }, undefined);
    expect(authority?.value).toBe(33);
  });

  it('leaves the real call site nothing numeric to read when Report 1 is insufficient', () => {
    // The rule above is a reimplementation, so on its own it would pass even if the production
    // call site were still ungated. This binds it to reality: for an insufficient Report 1, BOTH
    // sources `buildSnapshotFoundationForPerformance` reads are now null-valued, so no gate
    // anywhere in the chain has a number available to promote into a Report 2 baseline.
    const canonicalScore = report.canonical.authority_overview.overall_score;
    const legacyScore = report.score as { value?: number | null; state?: string };
    expect(canonicalScore.state).toBe('insufficient_signal');
    expect(canonicalScore.value).toBeNull();
    expect(legacyScore.value ?? null).toBeNull();
    expect(resolveAuthority(canonicalScore, legacyScore)).toBeNull();
  });
});
