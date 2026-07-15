/**
 * Foundation Batch A (F-01) — Route Factory.
 *
 * Contract under test: createApiRoute is PASS-THROUGH by construction —
 * identical response status/body/headers, thrown errors rethrown — while the
 * F-03 context is active inside the handler and error classes are counted.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createApiRoute, classifyError } from '../../../lib/platform/routeFactory';
import { getRequestId, getTraceId, hasRequestMemoScope } from '../../../lib/platform/requestContext';
import { registry } from '../../../backend/observability/registry';

function fakeReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: 'GET',
    url: '/api/platform-test',
    headers: { 'x-request-id': 'req-route-1' },
    ...overrides,
  } as unknown as NextApiRequest;
}

interface FakeRes extends NextApiResponse {
  _status?: number;
  _json?: unknown;
  _headers: Record<string, unknown>;
}

function fakeRes(): FakeRes {
  const listeners = new Map<string, Array<() => void>>();
  const res: Partial<FakeRes> = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
  };
  res.setHeader = ((k: string, v: unknown) => { res._headers![k] = v; return res; }) as FakeRes['setHeader'];
  res.status = ((code: number) => { res.statusCode = code; res._status = code; return res; }) as FakeRes['status'];
  res.json = ((body: unknown) => { res._json = body; emit('finish'); return res; }) as FakeRes['json'];
  res.send = ((body: unknown) => { res._json = body; emit('finish'); return res; }) as FakeRes['send'];
  res.end = (() => { emit('finish'); return res; }) as FakeRes['end'];
  res.on = ((event: string, cb: () => void) => {
    const list = listeners.get(event) ?? [];
    list.push(cb);
    listeners.set(event, list);
    return res;
  }) as FakeRes['on'];
  const emit = (event: string) => { for (const cb of listeners.get(event) ?? []) cb(); };
  return res as FakeRes;
}

describe('F-01 route factory', () => {
  test('passes request/response through verbatim', async () => {
    const wrapped = createApiRoute(async (req, res) => {
      res.status(201).json({ ok: true, echo: req.url });
    });
    const req = fakeReq();
    const res = fakeRes();
    await wrapped(req, res);
    expect(res._status).toBe(201);
    expect(res._json).toEqual({ ok: true, echo: '/api/platform-test' });
    // Batch A default: no response-header additions.
    expect(res._headers['x-request-id']).toBeUndefined();
  });

  test('F-03 context is active inside the handler', async () => {
    let seenRequestId: string | undefined;
    let seenTraceId: string | undefined;
    let memoActive = false;
    const wrapped = createApiRoute(async (_req, res) => {
      seenRequestId = getRequestId();
      seenTraceId = getTraceId();
      memoActive = hasRequestMemoScope();
      res.status(200).json({});
    });
    await wrapped(fakeReq(), fakeRes());
    expect(seenRequestId).toBe('req-route-1');
    expect(seenTraceId).toBe('req-route-1');
    expect(memoActive).toBe(true);
  });

  test('thrown errors are rethrown (Next error semantics preserved) and classified', async () => {
    const boom = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const wrapped = createApiRoute(async () => { throw boom; }, { route: '/api/platform-test' });
    await expect(wrapped(fakeReq(), fakeRes())).rejects.toBe(boom);

    const counter = registry
      .counterEntries()
      .find((c) => c.name === 'api.request.error_class' && c.labels?.class === 'timeout');
    expect(counter).toBeDefined();
    expect(counter!.labels?.route).toBe('/api/platform-test');
  });

  test('exposeRequestId opt-in sets the header (off by default)', async () => {
    const wrapped = createApiRoute(async (_req, res) => { res.status(200).json({}); }, {
      exposeRequestId: true,
    });
    const res = fakeRes();
    await wrapped(fakeReq(), res);
    expect(res._headers['x-request-id']).toBe('req-route-1');
  });

  test('middleware composes outermost-first and receives the handler', async () => {
    const order: string[] = [];
    const mw = (label: string) => (handler: any) => async (req: NextApiRequest, res: NextApiResponse) => {
      order.push(`before:${label}`);
      await handler(req, res);
      order.push(`after:${label}`);
    };
    const wrapped = createApiRoute(
      async (_req, res) => { order.push('handler'); res.status(200).json({}); },
      { use: [mw('outer'), mw('inner')] },
    );
    await wrapped(fakeReq(), fakeRes());
    expect(order).toEqual(['before:outer', 'before:inner', 'handler', 'after:inner', 'after:outer']);
  });
});

describe('classifyError', () => {
  test('bounded label set', () => {
    expect(classifyError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('abort');
    expect(classifyError(new Error('request timed out'))).toBe('timeout');
    expect(classifyError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('network');
    expect(classifyError(Object.assign(new Error('x'), { name: 'ZodError' }))).toBe('validation');
    expect(classifyError(Object.assign(new Error('x'), { status: 401 }))).toBe('auth');
    expect(classifyError(Object.assign(new Error('x'), { statusCode: 429 }))).toBe('rate_limit');
    expect(classifyError(Object.assign(new Error('x'), { status: 502 }))).toBe('upstream');
    expect(classifyError(Object.assign(new Error('x'), { status: 400 }))).toBe('client');
    expect(classifyError('weird')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
  });
});
