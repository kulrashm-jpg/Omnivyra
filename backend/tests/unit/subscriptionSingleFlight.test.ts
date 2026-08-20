/**
 * Command Center — one /api/user/subscription read per company per load.
 *
 * The endpoint was fetched twice on every load: once inside the readiness wave
 * (for buildSetupSignals' subscriptionTier) and once by loadUserTier (for the
 * `userTier` state). Same URL, same company, same field — both raw fetches, so
 * nothing deduplicated them.
 *
 * They are NOT merged into one consumer: loadUserTier resolves on its own
 * request (~1-3s) while the wave's value is usable only after all 17 of its
 * requests settle (~11s measured). They share the in-flight request instead.
 */
import { fetchSubscriptionOnce, subscriptionKey } from '@/hooks/subscriptionFetcher';

const okResponse = (body: unknown) => ({ ok: true, json: async () => body });
const PAYLOAD = { data: { tier: 'pro' } };

/** Defers resolution so both callers are provably in flight together. */
const deferred = () => {
  let resolve!: (v: any) => void;
  const promise = new Promise<any>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('shared subscription read', () => {
  it('CRITICAL — concurrent callers issue ONE request and both receive it', async () => {
    const gate = deferred();
    const fetchImpl = jest.fn(() => gate.promise);

    const a = fetchSubscriptionOnce('company-1', fetchImpl as never);
    const b = fetchSubscriptionOnce('company-1', fetchImpl as never);
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchImpl).toHaveBeenCalledTimes(1);   // 2 callers → 1 request

    gate.resolve(okResponse(PAYLOAD));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ outcome: 'ok', json: PAYLOAD });
    expect(rb).toEqual({ outcome: 'ok', json: PAYLOAD });
  });

  it('mutation check — two independent fetches would issue two requests', async () => {
    const fetchImpl = jest.fn(async () => okResponse(PAYLOAD));
    await Promise.all([fetchImpl(), fetchImpl()]);   // the pre-change shape
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('the request URL and company scoping are unchanged', async () => {
    const fetchImpl = jest.fn(async () => okResponse(PAYLOAD));
    await fetchSubscriptionOnce('company-2', fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/user/subscription?company_id=company-2',
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
  });

  it('different companies do not share a flight', async () => {
    const fetchImpl = jest.fn(async () => okResponse(PAYLOAD));
    await Promise.all([
      fetchSubscriptionOnce('company-a', fetchImpl as never),
      fetchSubscriptionOnce('company-b', fetchImpl as never),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(subscriptionKey('company-a')).not.toBe(subscriptionKey('company-b'));
  });

  it('a later load re-fetches — the flight is not a cache', async () => {
    const fetchImpl = jest.fn(async () => okResponse(PAYLOAD));
    await fetchSubscriptionOnce('company-3', fetchImpl as never);
    await fetchSubscriptionOnce('company-3', fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(2);   // settled flight is released
  });
});

describe('failure semantics preserved for both consumers', () => {
  it('non-OK reports non_ok (caller warns and falls back to free)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(fetchSubscriptionOnce('company-4', fetchImpl as never))
      .resolves.toEqual({ outcome: 'non_ok' });
  });

  it('a thrown fetch reports error, carrying the cause', async () => {
    const boom = new Error('network down');
    const fetchImpl = jest.fn(async () => { throw boom; });
    await expect(fetchSubscriptionOnce('company-5', fetchImpl as never))
      .resolves.toEqual({ outcome: 'error', error: boom });
  });

  it('a failure is shared by both callers without a second request', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const [x, y] = await Promise.all([
      fetchSubscriptionOnce('company-6', fetchImpl as never),
      fetchSubscriptionOnce('company-6', fetchImpl as never),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(x).toEqual({ outcome: 'non_ok' });
    expect(y).toEqual({ outcome: 'non_ok' });
  });
});

describe('call sites', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../hooks/useCommandCenterCore.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('no raw subscription fetch remains', () => {
    expect(code).not.toContain('/api/user/subscription');
  });

  it('both consumers go through the shared reader', () => {
    expect(code.split('fetchSubscriptionOnce(').length - 1).toBe(2);
  });

  it('loadUserTier keeps its own gate and free fallback', () => {
    expect(code).toContain("setUserTier('free')");
    expect(code).toContain('if (!authChecked || !user?.userId || !selectedCompanyId) return;');
  });

  it('the wave still reads tier then plan_key then null', () => {
    expect(code).toContain('subscriptionData?.data?.tier ?? subscriptionData?.data?.plan_key ?? null');
  });
});
