/**
 * fetchReadinessData — readiness-score must not queue behind feature-completion.
 *
 * readiness-score takes only companyId and reads nothing from the features
 * result on its success path, but it used to be issued after features resolved.
 * Production: feature-completion 11,288ms, then readiness-score 1,318ms starting
 * 14ms after it ended — a pure serial tail.
 *
 * Failure semantics are load-bearing here and must survive: a non-OK or throwing
 * score falls back to deriveReadinessFromFeatures(features).
 */
import { fetchReadinessData } from '../../services/commandCenterReadinessService';

type Deferred = { promise: Promise<any>; resolve: (v: any) => void; reject: (e: any) => void };
const defer = (): Deferred => {
  let resolve!: (v: any) => void, reject!: (e: any) => void;
  const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const jsonRes = (body: unknown, ok = true) => ({
  ok, statusText: ok ? 'OK' : 'Server Error', json: async () => body,
});

const FEATURES_BODY = { data: { features: [
  { key: 'report_generated', status: 'completed', score: 1 },
  { key: 'first_post', status: 'pending', score: 0 },
] } };
const SCORE_BODY = { data: { score: 62, level: 'growing', completedFeatures: 3, totalFeatures: 8 } };

let calls: string[] = [];
const realFetch = global.fetch;

/** Routes by URL; profile-signals calls resolve immediately so they never gate. */
function installFetch(handlers: { features?: () => any; score?: () => any }) {
  (global as any).fetch = jest.fn(async (url: string) => {
    calls.push(String(url).split('?')[0]);
    if (String(url).includes('/api/feature-completion')) return handlers.features ? handlers.features() : jsonRes(FEATURES_BODY);
    if (String(url).includes('/api/readiness-score')) return handlers.score ? handlers.score() : jsonRes(SCORE_BODY);
    return jsonRes({});                       // company-profile signals etc.
  });
}

beforeEach(() => { calls = []; });
afterAll(() => { (global as any).fetch = realFetch; });

describe('A — concurrency', () => {
  it('issues readiness-score before feature-completion resolves', async () => {
    const features = defer();
    installFetch({ features: () => features.promise });

    const pending = fetchReadinessData('company-1');
    await new Promise((r) => setTimeout(r, 20));

    // Both in flight while feature-completion is still unresolved.
    expect(calls).toContain('/api/feature-completion');
    expect(calls).toContain('/api/readiness-score');

    features.resolve(jsonRes(FEATURES_BODY));
    const out = await pending;
    expect(out).not.toBeNull();
  });
});

describe('B — readiness-score throws', () => {
  it('falls back to the features-derived score and still returns data', async () => {
    installFetch({ score: () => { throw new Error('network down'); } });
    const out = await fetchReadinessData('company-1');
    expect(out).not.toBeNull();
    expect(out!.readiness).toBeDefined();
    expect(out!.readiness.score).not.toBe(62);           // not the canonical value
    expect(Array.isArray(out!.features)).toBe(true);
  });

  it('a rejected (not thrown) score promise also falls back', async () => {
    installFetch({ score: () => Promise.reject(new Error('reset')) });
    const out = await fetchReadinessData('company-1');
    expect(out).not.toBeNull();
    expect(out!.readiness.score).not.toBe(62);
  });
});

describe('C — readiness-score non-OK', () => {
  it('preserves the features-derived fallback', async () => {
    installFetch({ score: () => jsonRes({}, false) });
    const out = await fetchReadinessData('company-1');
    expect(out).not.toBeNull();
    expect(out!.readiness.score).not.toBe(62);
    expect(out!.readiness.features).toBeDefined();
  });
});

describe('D — success contract', () => {
  it('returns the canonical score and the unchanged feature list', async () => {
    installFetch({});
    const out = await fetchReadinessData('company-1');
    expect(out).not.toBeNull();
    // K3: the result now carries featuresDegraded so a consumer can tell an
    // authoritative dataset from the 3-key profile fallback. On this success
    // path it must be false — the API answered, so the features are real.
    expect(Object.keys(out!).sort()).toEqual(['features', 'featuresDegraded', 'readiness']);
    expect(out!.featuresDegraded).toBe(false);
    expect(out!.readiness.score).toBe(62);
    expect(out!.readiness.level).toBe('growing');
    expect(out!.readiness.completedFeatures).toBe(3);
    expect(out!.readiness.totalFeatures).toBe(8);
    expect(out!.features.some((f) => f.key === 'report_generated')).toBe(true);
    expect(calls.filter((c) => c === '/api/readiness-score')).toHaveLength(1);
    expect(calls.filter((c) => c === '/api/feature-completion')).toHaveLength(1);
  });

  it('a failing feature-completion fetch still returns null overall', async () => {
    installFetch({ features: () => { throw new Error('boom'); } });
    await expect(fetchReadinessData('company-1')).resolves.toBeNull();
  });
});
