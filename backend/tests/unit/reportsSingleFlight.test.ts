/**
 * Command Center — one /api/reports request per company per concurrent moment.
 *
 * Production capture confirmed two byte-identical GETs overlapping ~3.9s in the
 * same load: the SWR report-card poll and the readiness wave. They share the
 * in-flight request rather than being merged, because their lifecycles differ.
 *
 * These pin the properties that make the sharing safe: it is a flight and not a
 * cache, tenants and cache modes never coalesce, and each consumer keeps its own
 * failure semantics.
 */
import { fetchReportsOnce, reportsKey, reportsUrl } from '@/hooks/reportsFetcher';

const okResponse = (body: unknown, status = 200) =>
  ({ ok: true, status, json: async () => body });
const failResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}) });

const BODY = { success: true, reports: [{ id: 'r1' }, { id: 'r2' }], reportState: 'free_available' };

const deferred = () => {
  let resolve!: (v: any) => void;
  const promise = new Promise<any>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('shared in-flight request', () => {
  it('CRITICAL — two concurrent callers produce ONE request; both receive it', async () => {
    const gate = deferred();
    const impl = jest.fn(() => gate.promise);

    const a = fetchReportsOnce('company-1', {}, impl as never);
    const b = fetchReportsOnce('company-1', {}, impl as never);
    await new Promise((r) => setTimeout(r, 10));

    expect(impl).toHaveBeenCalledTimes(1);

    gate.resolve(okResponse(BODY));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ outcome: 'ok', status: 200, json: BODY });
    expect(rb).toEqual(ra);
  });

  it('mutation check — two independent fetches would issue two requests', async () => {
    const impl = jest.fn(async () => okResponse(BODY));
    await Promise.all([impl(), impl()]);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('is a flight, not a cache — a later call re-requests', async () => {
    const impl = jest.fn(async () => okResponse(BODY));
    await fetchReportsOnce('company-2', {}, impl as never);
    await fetchReportsOnce('company-2', {}, impl as never);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('builds the expected URL and passes the method/headers through', async () => {
    const impl = jest.fn(async () => okResponse(BODY));
    await fetchReportsOnce('company-3', {}, impl as never);
    expect(impl).toHaveBeenCalledWith('/api/reports?company_id=company-3',
      { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    expect(reportsUrl('company-3')).toBe('/api/reports?company_id=company-3');
  });
});

describe('isolation', () => {
  it('different companies never share a flight', async () => {
    const gate = deferred();
    const impl = jest.fn(() => gate.promise);
    const a = fetchReportsOnce('company-a', {}, impl as never);
    const b = fetchReportsOnce('company-b', {}, impl as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(impl).toHaveBeenCalledTimes(2);
    gate.resolve(okResponse(BODY));
    await Promise.all([a, b]);
    expect(reportsKey('company-a', false)).not.toBe(reportsKey('company-b', false));
  });

  it('no-store never joins a cache-eligible flight', async () => {
    const gate = deferred();
    const impl = jest.fn(() => gate.promise);
    const cached = fetchReportsOnce('company-1', {}, impl as never);
    const fresh = fetchReportsOnce('company-1', { noStore: true }, impl as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(impl).toHaveBeenCalledTimes(2);
    gate.resolve(okResponse(BODY));
    await Promise.all([cached, fresh]);
    expect(reportsKey('company-1', true)).not.toBe(reportsKey('company-1', false));
  });

  it('no-store is passed to the transport only when requested', async () => {
    const impl = jest.fn(async () => okResponse(BODY));
    await fetchReportsOnce('company-4', { noStore: true }, impl as never);
    expect(impl.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    const impl2 = jest.fn(async () => okResponse(BODY));
    await fetchReportsOnce('company-5', {}, impl2 as never);
    expect(impl2.mock.calls[0][1]).not.toHaveProperty('cache');
  });
});

describe('failure semantics are preserved for both consumers', () => {
  it.each([401, 403, 404, 500, 503])('HTTP %s reports non_ok with the status intact', async (status) => {
    const impl = jest.fn(async () => failResponse(status));
    await expect(fetchReportsOnce('company-1', {}, impl as never))
      .resolves.toEqual({ outcome: 'non_ok', status });
  });

  it('a network failure reports error, carrying the cause', async () => {
    const boom = new Error('network down');
    const impl = jest.fn(async () => { throw boom; });
    await expect(fetchReportsOnce('company-1', {}, impl as never))
      .resolves.toEqual({ outcome: 'error', error: boom });
  });

  it('a malformed body reports error rather than a false success', async () => {
    const impl = jest.fn(async () => ({ ok: true, status: 200,
      json: async () => { throw new SyntaxError('bad json'); } }));
    const result = await fetchReportsOnce('company-1', {}, impl as never);
    expect(result.outcome).toBe('error');
  });

  it('a failure is shared by both callers without a second request', async () => {
    const impl = jest.fn(async () => failResponse(401));
    const [x, y] = await Promise.all([
      fetchReportsOnce('company-6', {}, impl as never),
      fetchReportsOnce('company-6', {}, impl as never),
    ]);
    expect(impl).toHaveBeenCalledTimes(1);
    expect(x).toEqual({ outcome: 'non_ok', status: 401 });
    expect(y).toEqual(x);
  });
});

describe('call sites', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../hooks/useCommandCenterCore.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('neither consumer fetches /api/reports directly any more', () => {
    expect(code).not.toContain('getJson(`/api/reports');
    expect(code).not.toContain("apiFetch(url, {\n        method: 'GET'");
  });

  it('both consumers go through the shared reader', () => {
    expect(code.split('fetchReportsOnce(').length - 1).toBe(2);
  });

  it('the SWR consumer still raises a status-bearing error for its retry policy', () => {
    expect(code).toContain('throw new ApiFetchError(url, result.status)');
  });

  it('the SWR consumer still passes its generating no-store flag', () => {
    expect(code).toContain('noStore: generatingRef.current');
  });

  it('readiness does not depend on SWR state', () => {
    expect(code).toContain('}, [authChecked, authUserId, selectedCompanyId, user?.userId]);');
  });
});
