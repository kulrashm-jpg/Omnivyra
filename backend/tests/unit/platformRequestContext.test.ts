/**
 * Foundation Batch A (F-03) — Request Execution Context.
 *
 * Verifies the composed context: identity ALS + request memo ALS, trace-id
 * fallback chain, principal merge semantics, metadata bag, and — critically —
 * the fail-safe passthrough contract (unscoped code behaves exactly as before).
 */
import {
  runWithRequestExecutionContext,
  seedFromApiRequest,
  getTraceId,
  getRequestId,
  getTenantId,
  getPrincipal,
  setPrincipal,
  setContextMeta,
  getContextMeta,
  getRequestContext,
  memoRequest,
  hasRequestMemoScope,
} from '../../../lib/platform/requestContext';
import type { NextApiRequest } from 'next';

function fakeReq(headers: Record<string, string> = {}): NextApiRequest {
  return { headers, url: '/api/test', method: 'GET' } as unknown as NextApiRequest;
}

describe('F-03 request execution context', () => {
  test('outside any scope: accessors return undefined, memo passes through', async () => {
    expect(getRequestId()).toBeUndefined();
    expect(getTenantId()).toBeUndefined();
    expect(hasRequestMemoScope()).toBe(false);

    let calls = 0;
    const load = () => { calls += 1; return Promise.resolve(calls); };
    await memoRequest('k', load);
    await memoRequest('k', load);
    expect(calls).toBe(2); // no scope → no memoization (previous behavior)
  });

  test('composed scope activates identity + memo together', async () => {
    await runWithRequestExecutionContext({ requestId: 'r-1' }, async () => {
      expect(getRequestId()).toBe('r-1');
      expect(hasRequestMemoScope()).toBe(true);

      let calls = 0;
      const load = () => { calls += 1; return Promise.resolve(calls); };
      const a = await memoRequest('k', load);
      const b = await memoRequest('k', load);
      expect(calls).toBe(1);
      expect(a).toBe(b);
    });
    // Scope does not leak.
    expect(getRequestId()).toBeUndefined();
    expect(hasRequestMemoScope()).toBe(false);
  });

  test('seedFromApiRequest honors incoming headers and trace fallback chain', () => {
    runWithRequestExecutionContext({}, () => {
      const ctx = seedFromApiRequest(
        fakeReq({ 'x-request-id': 'req-abc', 'x-correlation-id': 'corr-xyz' }),
      );
      expect(ctx.requestId).toBe('req-abc');
      expect(ctx.correlationId).toBe('corr-xyz');
      // traceId falls back to correlationId when x-trace-id absent.
      expect(getTraceId()).toBe('corr-xyz');
    });
  });

  test('explicit x-trace-id wins the trace chain', () => {
    runWithRequestExecutionContext({}, () => {
      seedFromApiRequest(fakeReq({ 'x-trace-id': 'trace-777' }));
      expect(getTraceId()).toBe('trace-777');
    });
  });

  test('generates a requestId when no headers present', () => {
    runWithRequestExecutionContext({}, () => {
      const ctx = seedFromApiRequest(fakeReq());
      expect(ctx.requestId).toBeTruthy();
      expect(getTraceId()).toBeTruthy();
    });
  });

  test('setPrincipal merges without clobbering defined values with undefined', () => {
    runWithRequestExecutionContext({}, () => {
      setPrincipal({ userId: 'u-1', orgId: 'org-1' });
      expect(getPrincipal()).toEqual({ userId: 'u-1', orgId: 'org-1' });
      expect(getTenantId()).toBe('org-1');

      setPrincipal({ userId: 'u-2' }); // orgId omitted → preserved
      expect(getPrincipal()).toEqual({ userId: 'u-2', orgId: 'org-1' });
    });
  });

  test('context metadata bag set/get; isolated per scope', () => {
    runWithRequestExecutionContext({}, () => {
      setContextMeta('route', '/api/x');
      expect(getContextMeta('route')).toBe('/api/x');
      expect(getRequestContext().meta).toEqual({ route: '/api/x' });
    });
    expect(getContextMeta('route')).toBeUndefined();
  });

  test('failed memo loads are never cached (retry re-runs the loader)', async () => {
    await runWithRequestExecutionContext({}, async () => {
      let calls = 0;
      const failing = () => { calls += 1; return Promise.reject(new Error('boom')); };
      await expect(memoRequest('bad', failing)).rejects.toThrow('boom');
      await expect(memoRequest('bad', failing)).rejects.toThrow('boom');
      expect(calls).toBe(2);
    });
  });
});
