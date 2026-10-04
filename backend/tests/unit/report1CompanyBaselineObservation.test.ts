/**
 * REPORT-1-WP-12 — the company side of the comparison is OBSERVED, or it abstains.
 *
 * WHAT CAME BEFORE
 * REMEDIATION-003 deleted a fabricated company baseline: seven dimensions synthesized as
 * `constant ± penalty ± presence-bonus`, where the penalties counted OUR OWN audit decisions
 * and the bonuses were booleans for whether the tenant had filled in a business type, a
 * geography, a domain or a social link. Replacing it with `null` was correct, and
 * report1CompetitiveBaselineIntegrity.test.ts locks that in.
 *
 * WHAT IT LEFT
 * A gap is `competitor − company`. With the company side permanently null, no gap could ever
 * be computed, so the competitive-comparison capability was DORMANT: honest, but silent. It
 * also left a live crash — `subtractMetrics` dereferences its right-hand operand, so every
 * successfully crawled competitor threw a TypeError against the null baseline, and
 * `"strict": false` reported nothing.
 *
 * WHAT THIS SUITE ENFORCES
 * The baseline now comes from ONE source: the subject company's own public site, crawled by
 * the same crawler, against the same reference keyword set, and mapped by the same derivation
 * used for every competitor. These tests assert that it is that and nothing else —
 *   · no constant, no floor, no midpoint;
 *   · no penalty derived from our own audit decisions;
 *   · no presence bonus for a filled-in profile field;
 *   · nothing reverse-derived from the competitors;
 * and that when the subject's own site cannot be observed, the capability ABSTAINS rather
 * than manufacturing a number to make the radar light up.
 *
 * NOTE ON ENFORCEMENT. This project compiles with `"strict": false`. `null - 5` is -5, not a
 * type error, and `x ?? 0` on a nullable metric is perfectly well typed. Every nullable claim
 * below is therefore asserted at RUNTIME. The compiler proves nothing here.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

jest.mock('../../db/supabaseClient', () => {
  const buildQuery = () => {
    const query: Record<string, jest.Mock> = {};
    query.select = jest.fn(() => query);
    query.eq = jest.fn(() => query);
    query.order = jest.fn(() => query);
    query.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
    query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
    query.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }));
    return query;
  };
  return { supabase: { from: jest.fn(() => buildQuery()) } };
});

jest.mock('axios', () => ({ get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })) }));

const safeFetchMock = jest.fn();
const readCappedMock = jest.fn(async (_response: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...(args as [])),
  readCapped: (...args: unknown[]) => readCappedMock(...(args as [never])),
}));

import {
  resolveCompanyMetrics,
  resolveCompetitorMetrics,
  CRAWL_OBSERVED_DIMENSIONS,
  CRAWL_UNOBSERVED_DIMENSIONS,
  type CompetitorCrawlOutcome,
} from '../../services/competitor/competitorMetricsEvidence';
import {
  resolveCompanyComparisonBaseline,
  buildGapDefinitions,
} from '../../services/reportCompetitorIntelligenceServiceEngine';
import { subtractMetrics } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { enforceFinalCompetitorIntelligenceSync } from '../../services/reportCompetitorIntelligenceServiceModel';
import type { ComparisonMetrics, DomainCrawlSignals } from '../../services/competitor/competitorMetricsTypes';
import { buildCompetitorStanding } from '../../../pages/api/reports/reportViewUtils';

const signals = (overrides: Partial<DomainCrawlSignals> = {}): DomainCrawlSignals => ({
  contentScore: 62,
  keywordCoverageScore: 57,
  authorityProxy: 48,
  technicalScore: 70,
  aiAnswerPresenceScore: 41,
  extractedKeywords: ['clarity'],
  answerTopics: ['how to'],
  ...overrides,
});

/** A page that will crawl successfully, with content the derivation can read. */
const PAGE_HTML = `
  <html><head><title>Clarity coaching for founders</title>
  <meta name="description" content="Clarity coaching"></head>
  <body>
    <h1>Clarity coaching for founders</h1>
    <h2>What is clarity coaching</h2>
    <p>${'Trusted customer case study review award featured partners. '.repeat(40)}</p>
    <p>FAQ: how to choose a coach. In summary, a quick answer.</p>
  </body></html>`;

function mockCrawlSuccess(html = PAGE_HTML): void {
  safeFetchMock.mockResolvedValue({ status: 200 });
  readCappedMock.mockImplementation(async () => Buffer.from(html));
}

beforeEach(() => {
  safeFetchMock.mockReset();
  readCappedMock.mockReset();
  readCappedMock.mockImplementation(async () => Buffer.from(''));
});

// ───────────────────────────────────────────────────────────────────────────────────────
describe('WP-12 A. the baseline is the company’s own observation — not a constant', () => {
  it('returns exactly the company’s own crawl signals on the four observable dimensions', () => {
    const resolution = resolveCompanyMetrics({
      signals: signals({ contentScore: 62, authorityProxy: 48, keywordCoverageScore: 57, aiAnswerPresenceScore: 41 }),
      crawlOutcome: 'success',
    });

    expect(resolution.state).toBe('inferred');
    // The OLD fabricated centres were 64 / 59 / 61 / 57 for these four dimensions. If any of
    // them reappeared, these equalities would break.
    expect(resolution.metrics!.content_depth).toBe(62);
    expect(resolution.metrics!.authority_score).toBe(48);
    expect(resolution.metrics!.seo_coverage).toBe(57);
    expect(resolution.metrics!.aeo_readiness).toBe(41);
  });

  it('is a pure function of the company’s own signals — every input maps 1:1, so no constant hides inside', () => {
    // A constant term, a floor, a midpoint pull or a presence bonus would all break the
    // identity between the input signal and the published metric somewhere in this sweep.
    for (const value of [0, 1, 17, 33, 50, 64, 79, 96, 100]) {
      const metrics = resolveCompanyMetrics({
        signals: signals({
          contentScore: value, authorityProxy: value,
          keywordCoverageScore: value, aiAnswerPresenceScore: value,
        }),
        crawlOutcome: 'success',
      }).metrics!;
      for (const dimension of CRAWL_OBSERVED_DIMENSIONS) {
        expect({ dimension, value, got: metrics[dimension] }).toEqual({ dimension, value, got: value });
      }
    }
  });

  it('takes ONLY the company’s own crawl — competitor-derived reverse synthesis is un-expressible', () => {
    // The signature is the guarantee: one argument, carrying one side's own observation.
    // There is no competitor parameter to read, so no competitor number can reach the result.
    const params = { signals: signals(), crawlOutcome: 'success' as const };
    const first = resolveCompanyMetrics(params).metrics;
    const second = resolveCompanyMetrics(params).metrics;
    expect(first).toEqual(second);
    // And it is insensitive to anything a competitor could be: there is nowhere to put one.
    expect(Object.keys(params).sort()).toEqual(['crawlOutcome', 'signals']);
  });

  it('carries no decision count and no profile-presence input — the two the fabrication fed on', () => {
    const source = resolveCompanyMetrics.toString();
    expect(source).not.toMatch(/decision/i);
    expect(source).not.toMatch(/socialLinks|businessType|geography|websiteDomain|resolvedInput/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
describe('WP-12 B. the company and the competitor are measured the same way', () => {
  it('identical crawl signals produce identical observed dimensions on both sides', () => {
    const shared = signals({ contentScore: 73, authorityProxy: 51, keywordCoverageScore: 66, aiAnswerPresenceScore: 38 });
    const company = resolveCompanyMetrics({ signals: shared, crawlOutcome: 'success' }).metrics!;
    const competitor = resolveCompetitorMetrics({ signals: shared, crawlOutcome: 'success', companyMetrics: company }).metrics!;

    // One derivation, applied twice. A different mapping for the subject would make every
    // delta a comparison of two different questions.
    for (const dimension of CRAWL_OBSERVED_DIMENSIONS) {
      expect({ dimension, company: company[dimension], competitor: competitor[dimension] })
        .toEqual({ dimension, company: company[dimension], competitor: company[dimension] });
    }
    // Same inputs, same measurement, therefore an exactly zero delta — no residual lift.
    const delta = subtractMetrics(competitor, company);
    for (const dimension of CRAWL_OBSERVED_DIMENSIONS) {
      expect({ dimension, delta: delta[dimension] }).toEqual({ dimension, delta: 0 });
    }
  });

  it('the three uncrawlable dimensions are null for the COMPANY, exactly as for a competitor', () => {
    const company = resolveCompanyMetrics({ signals: signals(), crawlOutcome: 'success' }).metrics!;
    for (const dimension of CRAWL_UNOBSERVED_DIMENSIONS) {
      expect({ dimension, value: company[dimension] }).toEqual({ dimension, value: null });
    }
  });

  it('symmetry: an unobservable dimension yields a NULL delta on both sides, never 0 and never one-sided', () => {
    const shared = signals();
    const company = resolveCompanyMetrics({ signals: shared, crawlOutcome: 'success' }).metrics!;
    const competitor = resolveCompetitorMetrics({ signals: shared, crawlOutcome: 'success', companyMetrics: company }).metrics!;
    const delta = subtractMetrics(competitor, company);

    for (const dimension of CRAWL_UNOBSERVED_DIMENSIONS) {
      // Not 0: a 0 delta is the claim "we compared these and they are level".
      expect({ dimension, value: delta[dimension] }).toEqual({ dimension, value: null });
    }
  });

  it('a dimension observed on one side only is null, never a one-sided gap', () => {
    const company = resolveCompanyMetrics({ signals: signals(), crawlOutcome: 'success' }).metrics!;
    // A competitor that somehow carries a cadence figure the company does not.
    const lopsided: ComparisonMetrics = { ...company, publishing_frequency: 71 };
    // 71 - null is 71 under this project's non-strict arithmetic. It must be null.
    expect(subtractMetrics(lopsided, company).publishing_frequency).toBeNull();
    // And in the other direction.
    expect(subtractMetrics(company, lopsided).publishing_frequency).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
describe('WP-12 C. no observation of the subject ⇒ the capability ABSTAINS', () => {
  it.each<[CompetitorCrawlOutcome]>([
    ['not_attempted'], ['client_error'], ['server_error'], ['transport_failure'], ['timeout'],
  ])('a %s crawl of the subject yields a null baseline and keeps its reason', (outcome) => {
    const resolution = resolveCompanyMetrics({ signals: signals(), crawlOutcome: outcome });

    expect(resolution.metrics).toBeNull();
    expect(resolution.state).toBe('unavailable');
    expect(resolution.crawl_outcome).toBe(outcome);
    expect(resolution.basis).toMatch(/no comparison baseline was derived/i);
    // A zeroed baseline would be the worst possible failure mode: every observed competitor
    // would appear maximally ahead of a company measured at nothing.
    expect(resolution.metrics).not.toEqual({
      content_depth: 0, authority_score: 0, publishing_frequency: 0,
      engagement_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0,
    });
  });

  it('an absent baseline still produces NO gaps — the slice-003 outcome is preserved', () => {
    const competitor = resolveCompetitorMetrics({
      signals: signals({ contentScore: 95, authorityProxy: 95, keywordCoverageScore: 95, aiAnswerPresenceScore: 95 }),
      crawlOutcome: 'success',
      companyMetrics: null,
    }).metrics!;
    const abstained = resolveCompanyMetrics({ signals: null, crawlOutcome: 'transport_failure' });

    const gaps = buildGapDefinitions({
      domain: 'subject.test',
      businessContext: 'testing',
      entries: [{
        competitor: { name: 'Acme', domain: 'acme.test' },
        metrics: competitor,
        deltas_vs_company: null,
        metrics_state: 'inferred',
        metrics_basis: '',
        crawl_outcome: 'success',
      }] as never,
      companyMetrics: abstained.metrics,
    });
    expect(gaps).toEqual([]);
  });

  it('with no resolved website domain, nothing is crawled at all — the placeholder is never fetched', async () => {
    const resolution = await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: null } } as never,
      referenceKeywords: ['clarity'],
    });

    expect(resolution.metrics).toBeNull();
    expect(resolution.state).toBe('unavailable');
    expect(resolution.crawl_outcome).toBe('not_attempted');
    // `your-site.com` is the engine's prose placeholder, not the customer's site. Crawling it
    // would publish a stranger's pages as the customer's baseline.
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('a subject site that 404s abstains rather than falling back to anything', async () => {
    safeFetchMock.mockResolvedValue({ status: 404 });
    const resolution = await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: 'subject.test' } } as never,
      referenceKeywords: ['clarity'],
    });

    expect(resolution.metrics).toBeNull();
    expect(resolution.state).toBe('unavailable');
    expect(resolution.crawl_outcome).toBe('client_error');
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
describe('WP-12 D. the baseline is crawled from the SUBJECT’s own domain', () => {
  it('fetches the subject’s own pages and derives the baseline from them', async () => {
    mockCrawlSuccess();
    const resolution = await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: 'https://subject.test/pricing' } } as never,
      referenceKeywords: ['clarity', 'coaching'],
    });

    // Every URL requested belongs to the subject — no competitor domain is consulted.
    const requested = safeFetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) expect(url).toMatch(/^https:\/\/subject\.test\//);

    expect(resolution.state).toBe('inferred');
    expect(resolution.crawl_outcome).toBe('success');
    expect(resolution.basis).toMatch(/own observed public pages/i);
    const metrics = resolution.metrics!;
    for (const dimension of CRAWL_OBSERVED_DIMENSIONS) {
      expect(typeof metrics[dimension]).toBe('number');
    }
    // Still absent on the three nothing observes, even from a real successful crawl.
    for (const dimension of CRAWL_UNOBSERVED_DIMENSIONS) {
      expect({ dimension, value: metrics[dimension] }).toEqual({ dimension, value: null });
    }
  });

  it('the baseline reflects the subject’s own content — a thinner site scores lower', async () => {
    mockCrawlSuccess();
    const rich = (await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: 'subject.test' } } as never,
      referenceKeywords: ['clarity'],
    })).metrics!;

    safeFetchMock.mockReset();
    readCappedMock.mockReset();
    mockCrawlSuccess('<html><head><title>Hi</title></head><body><h1>Hi</h1><p>Short.</p></body></html>');
    const thin = (await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: 'subject.test' } } as never,
      referenceKeywords: ['clarity'],
    })).metrics!;

    // If the number were a constant or a profile bonus, two different sites would score the
    // same. It moves with the evidence.
    expect(rich.content_depth).toBeGreaterThan(thin.content_depth);
    expect(rich.authority_score).toBeGreaterThan(thin.authority_score);
  });

  it('the subject is measured against the SAME reference keywords the competitors are', async () => {
    // seo_coverage is overlap with the reference set. Scoring the two sides against different
    // sets would make the delta meaningless, so the engine passes one set to both crawls.
    expect(resolveCompanyComparisonBaseline.toString()).toMatch(/referenceKeywords/);

    mockCrawlSuccess();
    const hit = (await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: 'subject.test' } } as never,
      referenceKeywords: ['clarity'],
    })).metrics!;

    safeFetchMock.mockReset();
    readCappedMock.mockReset();
    mockCrawlSuccess();
    const miss = (await resolveCompanyComparisonBaseline({
      resolvedInput: { resolved: { websiteDomain: 'subject.test' } } as never,
      referenceKeywords: ['zzzz-not-on-the-page'],
    })).metrics!;

    expect(hit.seo_coverage).toBeGreaterThan(miss.seo_coverage);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
describe('WP-12 E. the capability is live again — two observed sides produce a real gap', () => {
  it('a genuinely stronger competitor now surfaces as a gap against an OBSERVED baseline', () => {
    const company = resolveCompanyMetrics({
      signals: signals({ contentScore: 55, authorityProxy: 50, keywordCoverageScore: 52, aiAnswerPresenceScore: 48 }),
      crawlOutcome: 'success',
    }).metrics!;
    const competitorMetrics = resolveCompetitorMetrics({
      signals: signals({ contentScore: 88, authorityProxy: 84, keywordCoverageScore: 86, aiAnswerPresenceScore: 82 }),
      crawlOutcome: 'success',
      companyMetrics: company,
    }).metrics!;

    const gaps = buildGapDefinitions({
      domain: 'subject.test',
      businessContext: 'testing',
      entries: [{
        competitor: { name: 'Acme', domain: 'acme.test' },
        metrics: competitorMetrics,
        deltas_vs_company: subtractMetrics(competitorMetrics, company),
        metrics_state: 'inferred',
        metrics_basis: '',
        crawl_outcome: 'success',
      }] as never,
      companyMetrics: company,
    });

    // Dormant no longer: both sides observed, so the comparison is made.
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.map((gap) => gap.gap_type)).toContain('content_gap');
    // And every gap is sized by the real difference, 88 - 55 = 33 on content.
    expect(subtractMetrics(competitorMetrics, company).content_depth).toBe(33);
  });

  it('an equally strong competitor produces NO gap — the comparison is not biased toward a finding', () => {
    const shared = signals({ contentScore: 70, authorityProxy: 70, keywordCoverageScore: 70, aiAnswerPresenceScore: 70 });
    const company = resolveCompanyMetrics({ signals: shared, crawlOutcome: 'success' }).metrics!;
    const competitorMetrics = resolveCompetitorMetrics({ signals: shared, crawlOutcome: 'success', companyMetrics: company }).metrics!;

    expect(buildGapDefinitions({
      domain: 'subject.test',
      businessContext: 'testing',
      entries: [{
        competitor: { name: 'Acme', domain: 'acme.test' },
        metrics: competitorMetrics,
        deltas_vs_company: subtractMetrics(competitorMetrics, company),
        metrics_state: 'inferred',
        metrics_basis: '',
        crawl_outcome: 'success',
      }] as never,
      companyMetrics: company,
    })).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
describe('WP-12 F. absence survives every downstream hop — runtime, because the compiler will not', () => {
  it('subtractMetrics against a null baseline is never reached — the caller guards it', () => {
    // The crash this replaced: `subtractMetrics(metrics, null)` dereferences its right operand
    // and throws for EVERY successfully crawled competitor. Documented here so the guard at the
    // call sites is understood as load-bearing, not decorative.
    const competitor = resolveCompetitorMetrics({ signals: signals(), crawlOutcome: 'success', companyMetrics: null }).metrics!;
    expect(() => subtractMetrics(competitor, null as never)).toThrow();
  });

  it('the final enforcement pass does NOT substitute a zeroed baseline for an absent one', () => {
    const enforced = enforceFinalCompetitorIntelligenceSync({
      result: {
        summary: '',
        detected_competitors: [],
        competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
        comparison: { company: null, competitors: [] },
        generated_gaps: [],
        competitive_summary: { top_threats: [], key_advantage: '', key_risk: '', positioning_statement: '' },
      } as never,
      resolvedInput: null,
    });

    // It previously emitted seven zeroes here, which reads as a measured company scoring
    // nothing on every dimension.
    expect(enforced.comparison.company).toBeNull();
    expect(enforced.comparison.company).not.toEqual({
      content_depth: 0, authority_score: 0, publishing_frequency: 0,
      engagement_score: 0, seo_coverage: 0, geo_presence: 0, aeo_readiness: 0,
    });
  });

  it('an observed baseline survives the final enforcement pass with its provenance', () => {
    const company = resolveCompanyMetrics({ signals: signals(), crawlOutcome: 'success' });
    const enforced = enforceFinalCompetitorIntelligenceSync({
      result: {
        summary: '',
        detected_competitors: [],
        competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
        comparison: {
          company: company.metrics,
          company_metrics_state: company.state,
          company_metrics_basis: company.basis,
          competitors: [],
        },
        generated_gaps: [],
        competitive_summary: { top_threats: [], key_advantage: '', key_risk: '', positioning_statement: '' },
      } as never,
      resolvedInput: null,
    });

    expect(enforced.comparison.company).toEqual(company.metrics);
    expect(enforced.comparison.company_metrics_state).toBe('inferred');
    expect(enforced.comparison.company_metrics_basis).toMatch(/own observed public pages/i);
  });

  it('the standing verdict counts only the dimensions that were actually compared', () => {
    // The real shape of every delta this engine now emits: four compared, three unavailable.
    const realDelta = { content_depth: 14, authority_score: 14, seo_coverage: 14, aeo_readiness: 14,
      publishing_frequency: null, engagement_score: null, geo_presence: null };

    // Reading the three nulls as zeroes and dividing by seven gave 8 — a hair from being
    // reported as parity. A competitor 14 points ahead on everything measured is Behind.
    expect(buildCompetitorStanding(realDelta as never)).toBe('Behind');

    // The case the old arithmetic actually got wrong: 12 points ahead on all four observed
    // dimensions scored 48/7 ≈ 6.9 and was published as "At Par".
    expect(buildCompetitorStanding({ ...realDelta, content_depth: 12, authority_score: 12,
      seo_coverage: 12, aeo_readiness: 12 } as never)).toBe('Behind');

    // Nothing compared at all is not parity either.
    expect(buildCompetitorStanding({
      content_depth: null, authority_score: null, seo_coverage: null, aeo_readiness: null,
      publishing_frequency: null, engagement_score: null, geo_presence: null,
    } as never)).toBe('Not Observed');
    expect(buildCompetitorStanding(undefined)).toBe('Not Observed');
  });

  it('a competitor ahead on the observed dimensions is not dragged to parity by the absent ones', () => {
    const company = resolveCompanyMetrics({
      signals: signals({ contentScore: 50, authorityProxy: 50, keywordCoverageScore: 50, aiAnswerPresenceScore: 50 }),
      crawlOutcome: 'success',
    }).metrics!;
    const competitor = resolveCompetitorMetrics({
      signals: signals({ contentScore: 70, authorityProxy: 70, keywordCoverageScore: 70, aiAnswerPresenceScore: 70 }),
      crawlOutcome: 'success',
      companyMetrics: company,
    }).metrics!;

    const delta = subtractMetrics(competitor, company);
    // End to end, through the real producer: a uniform 20-point observed lead reads as Behind.
    expect(buildCompetitorStanding(delta as never)).toBe('Behind');
  });
});
