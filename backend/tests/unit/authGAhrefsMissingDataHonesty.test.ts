/**
 * AUTH-G-002 — MISSING AHREFS DATA IS NOT A MEASURED ZERO.
 *
 * WHY THIS SUITE EXISTS. Two defects compounded in the Ahrefs adapter:
 *
 *   1. `referring_domains: json.metrics?.refdomains ?? 0` and
 *      `total_backlinks: json.metrics?.backlinks ?? 0`. A response that never carried
 *      those fields — an unindexed domain, a plan without those entitlements, a shape
 *      change — produced a profile reading "0 referring domains, 0 backlinks" stamped
 *      `state: 'measured'`.
 *   2. `scoreFromProfile` spent full weights on unavailable inputs:
 *      `domain_authority ?? 0` and `trust_flow ?? 0`. Ahrefs' `metrics-extended`
 *      carries no trust-flow field AT ALL, so 20% of the composite was permanently
 *      zero — no domain could exceed 80 however strong its real backlink profile.
 *
 * WHY IT WAS LOAD-BEARING. `mergeAuthorityInflowDimension` substitutes the provider's
 * result over the baseline whenever `state === 'measured' && score != null`, and
 * `0 != null`. A fabricated zero therefore became the Authority Inflow dimension and
 * entered the Authority pillar as a real measurement.
 *
 * THE LINE THIS SUITE DEFENDS. Present-and-zero is a genuine measurement and stays
 * one. ABSENT is not a measurement and must never become a number.
 *
 * SECRETS / NETWORK: none. `fetchProduction` — the adapter's only HTTP seam — is
 * mocked; the rate limiter, cache, retry, budget and logging stay real. `AHREFS_API_KEY`
 * is a synthetic string.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const fetchProduction = jest.fn();
jest.mock('../../services/intelligence/productionPrimitives', () => ({
  ...jest.requireActual('../../services/intelligence/productionPrimitives'),
  fetchProduction: (...args: unknown[]) => fetchProduction(...args),
}));

import {
  AhrefsAdapter,
  scoreFromPresentMetrics,
  type AhrefsPresentMetrics,
} from '../../services/intelligence/adapters/ahrefsAdapter';

const metrics = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const present = (over: Partial<AhrefsPresentMetrics> = {}): AhrefsPresentMetrics => ({
  referring_domains: null,
  total_backlinks: null,
  domain_authority: null,
  trust_flow: null,
  ...over,
});

/** Distinct domains per test: the adapter's 24h cache is real and is not reset. */
let counter = 0;
const nextDomain = () => `authg-${++counter}.test`;

beforeEach(() => {
  fetchProduction.mockReset();
  process.env.AHREFS_API_KEY = 'test-key-not-a-real-credential';
});

afterEach(() => {
  delete process.env.AHREFS_API_KEY;
});

// ── 1. THE COMPOSITE — AN UNAVAILABLE COMPONENT IS NOT A ZERO COMPONENT ─────

describe('AUTH-G-002 — scoreFromPresentMetrics spends no weight on absent inputs', () => {
  it('returns null when nothing arrived, instead of 0', () => {
    expect(scoreFromPresentMetrics(present())).toBeNull();
  });

  it('an always-null trust_flow no longer caps the score at 80', () => {
    // THE DEFECT, quantified. Under `da * 0.5 + refLog * 0.3 + tf * 0.2` with
    // tf = null -> 0, a perfect profile scored at most 80.
    const perfect = scoreFromPresentMetrics(
      present({ domain_authority: 100, referring_domains: 10_000_000 }),
    );
    expect(perfect).toBe(100);
    expect(perfect).toBeGreaterThan(80);
  });

  it('a lone Domain Rating is reported as itself, not halved by a missing partner', () => {
    // Only DA arrived, so the composite is DA. Previously: 70 * 0.5 = 35.
    expect(scoreFromPresentMetrics(present({ domain_authority: 70 }))).toBe(70);
  });

  it('relative weights are unchanged when every component is present', () => {
    // 50/30/20 over da=80, refdomains=1000 (log10(1001)*25 = 75.03), tf=60.
    // 80*0.5 + 75.03*0.3 + 60*0.2 = 40 + 22.51 + 12 = 74.51 -> 75.
    expect(
      scoreFromPresentMetrics(present({ domain_authority: 80, referring_domains: 1000, trust_flow: 60 })),
    ).toBe(75);
  });

  it('PRESENT-AND-ZERO still measures zero — that is a real reading', () => {
    // A domain genuinely without referring domains. The fix must not erase this.
    expect(scoreFromPresentMetrics(present({ referring_domains: 0 }))).toBe(0);
    expect(scoreFromPresentMetrics(present({ domain_authority: 0, referring_domains: 0 }))).toBe(0);
  });
});

// ── 2. THE ADAPTER — AN EMPTY RESPONSE IS UNAVAILABLE ───────────────────────

describe('AUTH-G-002 — an empty Ahrefs response is unavailable, not measured 0', () => {
  it('a response with no metrics object yields `unavailable` with a null score', async () => {
    fetchProduction.mockResolvedValue(metrics({}));
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    expect(result.state).not.toBe('measured');
    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.score).not.toBe(0);
    expect(result.profile).toBeNull();
  });

  it('a metrics object carrying none of the authority fields is also unavailable', async () => {
    // `traffic` and `url_rating` are in the response type but contribute no authority.
    fetchProduction.mockResolvedValue(metrics({ metrics: { traffic: 1234, url_rating: 9 } }));
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
  });

  it('says it is missing provider data, not zero backlinks', async () => {
    fetchProduction.mockResolvedValue(metrics({}));
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    expect(result.reason_unavailable).toMatch(/not a measurement of zero backlinks/i);
  });

  it('will NOT be accepted by the mergeAuthorityInflowDimension gate', async () => {
    fetchProduction.mockResolvedValue(metrics({}));
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    // The gate is `state === 'measured' && score != null`. The old code passed it with 0.
    expect(result.state === 'measured' && result.score != null).toBe(false);
  });

  it('an absent metric contributes no observation and no confidence', async () => {
    // Only Domain Rating arrived. refdomains/backlinks must not appear as `:0` signals.
    fetchProduction.mockResolvedValue(metrics({ metrics: { domain_rating: 42 } }));
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    const signals = result.evidence.observations.map((o) => o.signal);
    expect(signals).toContain('ahrefs:domain_rating:42');
    expect(signals).not.toContain('ahrefs:refdomains:0');
    expect(signals).not.toContain('ahrefs:backlinks:0');
    expect(result.evidence.count).toBe(1);
  });
});

// ── 3. NON-VACUITY — A GENUINE FIGURE STILL MEASURES ────────────────────────

describe('AUTH-G-002 non-vacuity — this is not blanket suppression', () => {
  it('a real Ahrefs response is still MEASURED with its real figures', async () => {
    fetchProduction.mockResolvedValue(
      metrics({ metrics: { domain_rating: 64, refdomains: 1820, backlinks: 41_355 } }),
    );
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    expect(result.state).toBe('measured');
    expect(result.profile?.referring_domains).toBe(1820);
    expect(result.profile?.total_backlinks).toBe(41_355);
    expect(result.profile?.domain_authority).toBe(64);
    expect(typeof result.score).toBe('number');
    expect(result.score as number).toBeGreaterThan(0);
    expect(result.evidence.sources).toContain('backlink_api');
    expect(result.evidence.count).toBe(3);
    // And it DOES pass the merge gate, so Authority Inflow still becomes measured.
    expect(result.state === 'measured' && result.score != null).toBe(true);
  });

  it('a genuine zero-backlink domain is still MEASURED at zero', async () => {
    // The decisive non-vacuity case: Ahrefs explicitly answered 0. That is evidence,
    // and the fix must keep reporting it rather than hiding behind `unavailable`.
    fetchProduction.mockResolvedValue(
      metrics({ metrics: { domain_rating: 0, refdomains: 0, backlinks: 0 } }),
    );
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    expect(result.state).toBe('measured');
    expect(result.score).toBe(0);
    expect(result.profile?.referring_domains).toBe(0);
    expect(result.evidence.count).toBe(3);
  });

  it('a transport failure is still unavailable with the transport reason', async () => {
    fetchProduction.mockRejectedValue(new Error('ahrefs 503'));
    const result = await new AhrefsAdapter().lookup({ domain: nextDomain() });

    expect(result.state).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.reason_unavailable).not.toMatch(/zero backlinks/i);
  });
});
