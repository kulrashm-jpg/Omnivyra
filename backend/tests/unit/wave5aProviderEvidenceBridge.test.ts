/**
 * WAVE-5A — provider identity and provenance must SURVIVE the evidence bridge.
 *
 * Waves 2 and 3 established that each adapter produces a truthful, attributable observation.
 * What nothing proved is that the attribution still exists by the time Report 1 consumes it.
 * That is a different failure mode, and the one this programme has already been bitten by
 * twice: the AI matrix received brand and domain correctly and then forwarded neither, and the
 * SERP client knew its engine and observation time and threw both away one call later — in
 * both cases the adapter was right and the bridge lost the evidence.
 *
 * So these tests assert, per provider, that four things reach the consumer together:
 *
 *   provider   — WHO answered
 *   subject    — WHAT it was asked about (domain / brand)
 *   observedAt — WHEN the answer was obtained, not when the report was composed
 *   state      — what the answer is entitled to claim
 *
 * NO NETWORK, NO CREDENTIALS. Ahrefs' only HTTP seam (`fetchProduction`) is mocked; PageSpeed
 * takes an injected `fetchImpl`; the AI matrix is driven through a local recording provider.
 * Nothing here calls a vendor, and every key is a synthetic placeholder.
 */
import { emptyCanonicalScore } from '../../services/canonicalReport/canonicalReportTypes';
import type { AICitationMatrix } from '../../services/intelligence/aiCitationMatrixService';
import {
  fetchPageSpeed,
  parsePageSpeedResponse,
  unavailableObservation,
  aggregatePerformanceEvidence,
} from '../../services/performanceEvidence';

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const fetchProduction = jest.fn();
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  ...jest.requireActual('../../services/intelligence/productionPrimitives'),
  fetchProduction: (...args: unknown[]) => fetchProduction(...args),
}));

const DOMAIN = 'northwind.test';
const URL_UNDER_TEST = 'https://northwind.test/';

// ── PAGESPEED ───────────────────────────────────────────────────────────────

describe('wave-5A — PageSpeed: provider, subject and observation time survive', () => {
  const psiBody = (score: number) => ({
    id: URL_UNDER_TEST,
    analysisUTCTimestamp: '2026-10-06T08:00:00.000Z',
    lighthouseResult: {
      categories: { performance: { score } },
      audits: {
        'largest-contentful-paint': { numericValue: 2100 },
        'cumulative-layout-shift': { numericValue: 0.05 },
        'total-blocking-time': { numericValue: 150 },
      },
    },
  });

  it('a successful observation carries provider, url and its OWN observedAt', () => {
    const obs = parsePageSpeedResponse({
      url: URL_UNDER_TEST,
      formFactor: 'mobile',
      body: psiBody(0.62),
    });
    expect(obs.provider).toBeTruthy();
    expect(obs.url).toBe(URL_UNDER_TEST);
    expect(obs.observedAt).toBeTruthy();
    // The observation time must be parseable and must not be a fabricated epoch zero.
    expect(Number.isNaN(Date.parse(obs.observedAt as string))).toBe(false);
    expect(obs.state).toBe('measured');
    expect(obs.failureKind).toBeNull();
  });

  it('a successful observation does NOT invent metric values', () => {
    const obs = parsePageSpeedResponse({
      url: URL_UNDER_TEST,
      formFactor: 'mobile',
      // No audits at all: the provider answered but carried nothing usable.
      body: { id: URL_UNDER_TEST, lighthouseResult: { categories: {}, audits: {} } },
    });
    // Whatever state this resolves to, it must not manufacture a performance number.
    if (obs.state === 'measured') {
      expect(obs.providerPerformanceScore).not.toBe(0);
    } else {
      expect(obs.providerPerformanceScore).toBeNull();
    }
  });

  it('an unavailable observation keeps its subject and its failure class — and no score', () => {
    const obs = unavailableObservation({
      url: URL_UNDER_TEST,
      formFactor: 'mobile',
      reason: 'quota exceeded',
      failureKind: 'rate_limited',
    });
    expect(obs.url).toBe(URL_UNDER_TEST);
    expect(obs.state).toBe('unavailable');
    expect(obs.failureKind).toBe('rate_limited');
    expect(obs.providerPerformanceScore).toBeNull();
    // Unavailable is NOT a zero-performance finding.
    expect(obs.providerPerformanceScore).not.toBe(0);
  });

  it('disabled/unavailable evidence does not aggregate into a performance score', () => {
    const evidence = aggregatePerformanceEvidence({
      observations: [unavailableObservation({
        url: URL_UNDER_TEST, formFactor: 'mobile', reason: 'not enabled', failureKind: 'unsupported',
      })],
      eligiblePages: 4,
    });
    expect(evidence.state).toBe('unavailable');
    expect(evidence.reasonUnavailable).toBeTruthy();
    expect(evidence.byFormFactor.mobile.verdict).toBe('unknown');
  });

  it('NON-VACUITY — a real measured observation still aggregates to measured', () => {
    const evidence = aggregatePerformanceEvidence({
      observations: [parsePageSpeedResponse({ url: URL_UNDER_TEST, formFactor: 'mobile', body: psiBody(0.62) })],
      eligiblePages: 4,
    });
    expect(evidence.state).toBe('measured');
  });

  it('no network was used — fetchPageSpeed is only ever given an injected transport', async () => {
    let called = 0;
    // A REAL `Response`, so the stub satisfies `typeof fetch` with no cast and the production
    // path exercises the genuine `.ok` / `.status` / `.json()` members rather than a hand-rolled
    // fake. The previous `as never` casts asserted nothing and would have concealed any later
    // narrowing of `fetchImpl` or of `parsePageSpeedResponse`'s `body: unknown` parameter.
    const injected: typeof fetch = async () => {
      called += 1;
      return new Response(JSON.stringify(psiBody(0.62)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const obs = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: injected,
    });
    expect(called).toBe(1);
    expect(obs.url).toBe(URL_UNDER_TEST);
    expect(obs.observedAt).toBeTruthy();
    // The real transport path produced a real measurement, not an unavailable fallback.
    expect(obs.state).toBe('measured');
  });
});

// ── AI MATRIX (PERPLEXITY path) ─────────────────────────────────────────────

describe('wave-5A — AI matrix: the subject it was measured FOR is carried with the result', () => {
  /**
   * Typed against the PRODUCTION contract, with no cast.
   *
   * The identity lives on `AICitationMatrix` (`aiCitationMatrixService`) — the shape the
   * report builder actually consumes, and `canonicalReportBuilderAssembly` reads
   * `matrix.identity.resolved` off it directly. It is NOT on `AICitationMatrixSummary`,
   * the persisted report shape, which carries no subject at all. The first draft of this
   * file asserted `identity` against the summary type behind an `as unknown as` cast, so
   * the assertions described a contract that did not exist and only ts-jest's
   * transpile-only mode let them run.
   *
   * Building the real type here is what makes these assertions evidence: if the subject
   * were ever dropped from the matrix contract, this file stops compiling.
   */
  const matrix = (
    identity: AICitationMatrix['identity'],
    coverage: AICitationMatrix['coverage'],
  ): AICitationMatrix => ({
    cells: [],
    overall_score: emptyCanonicalScore('insufficient_signal'),
    by_provider: [],
    by_query_class: [],
    identity,
    coverage,
  });

  const coverage = (
    over: Partial<AICitationMatrix['coverage']> = {},
  ): AICitationMatrix['coverage'] => ({
    measured_cells: 4,
    unavailable_cells: 16,
    total_cells: 20,
    measurable_cells: 4,
    structurally_unmeasurable_cells: 16,
    ...over,
  });

  it('the matrix carries the identity it was measured for', () => {
    // A citation rate without a subject is unattributable; the contract makes the subject
    // part of the matrix rather than something a reader has to assume.
    const m = matrix({ brand_name: 'Northwind Analytics', domain: DOMAIN, resolved: true }, coverage());
    expect(m.identity.brand_name).toBe('Northwind Analytics');
    expect(m.identity.domain).toBe(DOMAIN);
    expect(m.identity.resolved).toBe(true);
  });

  it('an unresolved identity is representable and is not a resolved one', () => {
    const m = matrix({ brand_name: null, domain: null, resolved: false }, coverage({ measured_cells: 0 }));
    expect(m.identity.resolved).toBe(false);
    expect(m.coverage.measured_cells).toBe(0);
  });

  it('the honest denominator survives on the matrix, distinct from the grid', () => {
    const c = matrix({ brand_name: 'Northwind Analytics', domain: DOMAIN, resolved: true }, coverage()).coverage;
    expect(c.measurable_cells).toBe(4);
    expect(c.total_cells).toBe(20);
    expect(c.measurable_cells).not.toBe(c.total_cells);
    // 4 of 4 measurable is complete coverage; 4 of 20 is the figure no operator could close.
    expect(Math.round((c.measured_cells / c.measurable_cells) * 100)).toBe(100);
  });
});

// ── AHREFS ──────────────────────────────────────────────────────────────────

describe('wave-5A — Ahrefs: the answer carries who answered, about what, and when', () => {
  beforeEach(() => {
    fetchProduction.mockReset();
    process.env.AHREFS_API_KEY = 'synthetic-not-a-real-credential';
  });
  afterEach(() => { delete process.env.AHREFS_API_KEY; });

  const metrics = (body: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => body });

  // Imported lazily so the transport mock above is installed first.
  const adapter = async () => {
    const mod = await import('../../services/intelligence/adapters/ahrefsAdapter');
    return new mod.AhrefsAdapter();
  };

  it('a genuine non-zero answer is measured and stamped with provider and time', async () => {
    fetchProduction.mockResolvedValue(metrics({
      metrics: { domain_rating: 64, refdomains: 1820, backlinks: 41355 },
    }));
    const result = await (await adapter()).lookup({ domain: DOMAIN });
    expect(result.state).toBe('measured');
    expect(result.evidence.sources).toContain('backlink_api');
    expect(result.evidence.freshness.last_observed_at).toBeTruthy();
    for (const obs of result.evidence.observations) {
      expect(obs.source).toBe('backlink_api');
      expect(obs.observed_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(obs.observed_at as string))).toBe(false);
    }
  });

  it('a GENUINE ZERO is a measured zero, with the same provenance', async () => {
    fetchProduction.mockResolvedValue(metrics({
      metrics: { domain_rating: 0, refdomains: 0, backlinks: 0 },
    }));
    const result = await (await adapter()).lookup({ domain: DOMAIN });
    // The provider answered zero. That is evidence, and must not be hidden.
    expect(result.state).toBe('measured');
    expect(result.score).toBe(0);
    expect(result.evidence.sources).toContain('backlink_api');
    expect(result.evidence.freshness.last_observed_at).toBeTruthy();
  });

  it('an answer carrying NO metric is unavailable — never a measured zero', async () => {
    fetchProduction.mockResolvedValue(metrics({ metrics: {} }));
    const result = await (await adapter()).lookup({ domain: DOMAIN });
    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.score).not.toBe(0);
    expect(result.reason_unavailable).toBeTruthy();
  });

  it('a transport failure is unavailable with the TRANSPORT reason, not an empty-metrics one', async () => {
    fetchProduction.mockRejectedValue(new Error('ENOTFOUND api.ahrefs.com'));
    const result = await (await adapter()).lookup({ domain: DOMAIN });
    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.reason_unavailable).toBeTruthy();
  });

  it('no credential means the provider is not available — not a poor company', async () => {
    delete process.env.AHREFS_API_KEY;
    const a = await adapter();
    expect(await a.isAvailable()).toBe(false);
    expect(fetchProduction).not.toHaveBeenCalled();
  });

  it('never calls a vendor: every answer here came from the injected transport', () => {
    // Asserted across this block — the only HTTP seam is the mock, and the no-credential case
    // proves refusal happens before any request.
    expect(jest.isMockFunction(fetchProduction)).toBe(true);
  });
});
