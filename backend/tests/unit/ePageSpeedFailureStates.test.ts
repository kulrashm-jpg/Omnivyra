/**
 * E — PAGESPEED: A FAILURE IS NEVER A SLOW SITE, AND NEVER A ZERO.
 *
 * WHAT WAS WRONG. Four different things produced `state: 'unavailable'` on a
 * performance observation, and only an English sentence told them apart:
 *
 *   the capability is switched off     (no quota, no opt-in)
 *   the quota is exhausted            (HTTP 429)
 *   the request did not complete      (timeout / reset / 5xx)
 *   the provider has no metric here   (it answered, with nothing usable)
 *
 * A consumer that wanted to treat a transient failure differently from "the
 * provider has nothing for this URL" had to pattern-match prose, so nothing did,
 * and all four read as one undifferentiated absence. `failureKind` is the
 * machine-readable half, in the project's existing `ProviderFailureKind`
 * vocabulary (CPG-012 §10).
 *
 * NO NETWORK. Every request here is served by an injected `fetchImpl`. No call
 * reaches Google, and no credential is read: PageSpeed is keyless.
 */

// `digitalExperienceRepository` (imported only for the gate-agreement test)
// reaches Supabase at module load; stub it so this stays a unit test.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  aggregatePerformanceEvidence,
  describePageSpeedReadiness,
  fetchPageSpeed,
  isPageSpeedConfigured,
  parsePageSpeedResponse,
  unavailableObservation,
  type PerformanceObservation,
} from '../../services/performanceEvidence';
import { pageSpeedEnabled } from '../../services/digitalExperienceRepository';

const URL_UNDER_TEST = 'https://acme.test/';

/** A PSI response with real CrUX field data — the genuinely measurable case. */
const PSI_WITH_FIELD = {
  loadingExperience: {
    overall_category: 'AVERAGE',
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3200, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8, category: 'FAST' },
    },
  },
  lighthouseResult: { finalUrl: URL_UNDER_TEST, categories: { performance: { score: 0.62 } } },
};

const respond = (status: number, body: unknown): typeof fetch =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of ['PAGESPEED_API_KEY', 'PAGESPEED_ENABLED']) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
});

/** The invariant that must survive every failure path. */
function expectNoMeasurementLeaked(observation: PerformanceObservation): void {
  expect(observation.state).toBe('unavailable');
  expect(observation.providerPerformanceScore).toBeNull();
  expect(observation.overallCategory).toBe('NONE');
  for (const metric of observation.metrics) {
    expect(metric.value).toBeNull();
    expect(metric.verdict).toBe('unknown');
    expect(metric.state).toBe('unavailable');
  }
}

describe('E — PageSpeed readiness states the exact prerequisite', () => {
  it('is DISABLED, not CREDENTIAL_REQUIRED, when nothing is set', () => {
    // PSI works keyless, so a missing key is a decision not to call it — the
    // shared quota is routinely exhausted. Calling that "credential required"
    // would misdescribe the remedy.
    const readiness = describePageSpeedReadiness();
    expect(readiness.availability).toBe('DISABLED');
    expect(readiness.prerequisite).toEqual(['PAGESPEED_API_KEY', 'PAGESPEED_ENABLED']);
    expect(readiness.detail).toContain('No performance claim is made about the site');
    expect(isPageSpeedConfigured()).toBe(false);
  });

  it('is CONFIGURED with a dedicated quota — NON-VACUITY', () => {
    process.env.PAGESPEED_API_KEY = 'placeholder-not-a-real-credential';
    const readiness = describePageSpeedReadiness();
    expect(readiness.availability).toBe('CONFIGURED');
    expect(readiness.prerequisite).toEqual([]);
    expect(isPageSpeedConfigured()).toBe(true);
  });

  it('is CONFIGURED on the shared quota but still names the key to add', () => {
    process.env.PAGESPEED_ENABLED = 'true';
    const readiness = describePageSpeedReadiness();
    expect(readiness.availability).toBe('CONFIGURED');
    expect(readiness.prerequisite).toEqual(['PAGESPEED_API_KEY']);
    expect(readiness.detail).toContain('SHARED quota');
  });

  it('never reports a credential VALUE', () => {
    const secret = 'placeholder-not-a-real-credential';
    process.env.PAGESPEED_API_KEY = secret;
    expect(JSON.stringify(describePageSpeedReadiness())).not.toContain(secret);
  });

  it('agrees with the gate that actually decides — the DRIFT GUARD', () => {
    // `pageSpeedEnabled()` in `digitalExperienceRepository` is the gate in
    // force. A readiness report that described a different gate would be worse
    // than none, so the two are checked against each other on every
    // combination of the two variables.
    for (const key of [undefined, 'placeholder-not-a-real-credential']) {
      for (const flag of [undefined, 'true', 'false']) {
        if (key === undefined) delete process.env.PAGESPEED_API_KEY;
        else process.env.PAGESPEED_API_KEY = key;
        if (flag === undefined) delete process.env.PAGESPEED_ENABLED;
        else process.env.PAGESPEED_ENABLED = flag;

        expect(describePageSpeedReadiness().availability === 'CONFIGURED')
          .toBe(pageSpeedEnabled());
      }
    }
  });
});

describe('E — each PageSpeed failure mode carries its own kind', () => {
  it('429 is rate_limited, and says how to get a dedicated quota', async () => {
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile',
      fetchImpl: respond(429, { error: { message: 'Quota exceeded' } }),
    });
    expect(observation.failureKind).toBe('rate_limited');
    expect(observation.reasonUnavailable).toContain('PAGESPEED_API_KEY');
    expectNoMeasurementLeaked(observation);
  });

  it('5xx is retrieval_failed', async () => {
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: respond(503, {}),
    });
    expect(observation.failureKind).toBe('retrieval_failed');
    expectNoMeasurementLeaked(observation);
  });

  it('403 is inaccessible — distinct from a quota problem', async () => {
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: respond(403, {}),
    });
    expect(observation.failureKind).toBe('inaccessible');
    expect(observation.failureKind).not.toBe('rate_limited');
    expectNoMeasurementLeaked(observation);
  });

  it('a transport error is retrieval_failed', async () => {
    const failing = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: failing,
    });
    expect(observation.failureKind).toBe('retrieval_failed');
    expect(observation.reasonUnavailable).toContain('ECONNRESET');
    expectNoMeasurementLeaked(observation);
  });

  it('a timeout is retrieval_failed and says how long it waited', async () => {
    // The abort that `AbortSignal.timeout` fires, as the platform `fetch`
    // surfaces it. A stub that merely never settles would hang this test rather
    // than exercise the timeout path.
    const abortedByTimeout = (async () => {
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as typeof fetch;
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', timeoutMs: 10, fetchImpl: abortedByTimeout,
    });
    expect(observation.failureKind).toBe('retrieval_failed');
    expect(observation.reasonUnavailable).toContain('timed out');
    expectNoMeasurementLeaked(observation);
  });

  it('a 200 whose body will not parse is malformed_response, not a zero', async () => {
    const garbled = (async () => ({
      ok: true, status: 200,
      json: async () => { throw new Error('Unexpected token < in JSON'); },
    })) as unknown as typeof fetch;
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: garbled,
    });
    expect(observation.failureKind).toBe('malformed_response');
    expect(observation.failureKind).not.toBe('retrieval_failed');
    expectNoMeasurementLeaked(observation);
  });

  it('an answer with no usable metric is not_found — the provider DID answer', async () => {
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: respond(200, { lighthouseResult: {} }),
    });
    // "We asked, it answered, and it holds nothing for this URL" is its own
    // finding: not a transport failure, and emphatically not a measured zero.
    expect(observation.failureKind).toBe('not_found');
    expectNoMeasurementLeaked(observation);
  });

  it('a measured observation has NO failure kind — the NON-VACUITY control', async () => {
    const observation = await fetchPageSpeed({
      url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: respond(200, PSI_WITH_FIELD),
    });
    expect(observation.state).toBe('measured');
    expect(observation.failureKind).toBeNull();
    // And the measurement is real: Google's own category, Google's own score.
    expect(observation.providerPerformanceScore).toBe(62);
    const lcp = observation.metrics.find((m) => m.key === 'LCP')!;
    expect(lcp.state).toBe('measured');
    expect(lcp.source).toBe('crux_field');
    expect(lcp.verdict).toBe('needs_improvement');
  });

  it('every failure kind is one of the declared vocabulary terms', async () => {
    const kinds = await Promise.all([403, 429, 500].map(async (status) =>
      (await fetchPageSpeed({
        url: URL_UNDER_TEST, formFactor: 'mobile', fetchImpl: respond(status, {}),
      })).failureKind));
    for (const kind of kinds) {
      expect([
        'inaccessible', 'auth_required', 'rate_limited', 'retrieval_failed',
        'malformed_response', 'not_found', 'ambiguous', 'invalid_identifier',
        'unsupported', 'provider_error',
      ]).toContain(kind);
    }
  });
});

describe('E — the kind survives aggregation', () => {
  it('report-level evidence carries the first failure kind', () => {
    const evidence = aggregatePerformanceEvidence({
      observations: [
        unavailableObservation({
          url: URL_UNDER_TEST, formFactor: 'mobile',
          reason: 'PageSpeed quota exceeded.', failureKind: 'rate_limited',
        }),
      ],
      eligiblePages: 4,
    });
    expect(evidence.state).toBe('unavailable');
    expect(evidence.failureKind).toBe('rate_limited');
    // Coverage is a statement about evidence, never a verdict about the site.
    expect(evidence.byFormFactor.mobile.verdict).toBe('unknown');
    expect(evidence.byFormFactor.desktop.verdict).toBe('unknown');
  });

  it('a measured report has no failure kind — NON-VACUITY', () => {
    const evidence = aggregatePerformanceEvidence({
      observations: [parsePageSpeedResponse({
        body: PSI_WITH_FIELD, url: URL_UNDER_TEST, formFactor: 'mobile',
      })],
      eligiblePages: 4,
    });
    expect(evidence.state).toBe('measured');
    expect(evidence.failureKind).toBeNull();
    expect(evidence.byFormFactor.mobile.verdict).toBe('needs_improvement');
  });

  it('nothing attempted reports no provider failure at all', () => {
    // Zero observations is not a provider failure — it is an absence of
    // attempts, and inventing a kind for it would be a fabricated diagnosis.
    const evidence = aggregatePerformanceEvidence({ observations: [], eligiblePages: 7 });
    expect(evidence.state).toBe('unavailable');
    expect(evidence.failureKind).toBeNull();
    expect(evidence.coverage).toEqual({ measured: 0, attempted: 0, eligible: 7 });
  });
});
