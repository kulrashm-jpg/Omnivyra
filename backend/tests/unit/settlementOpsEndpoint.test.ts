/**
 * /api/super-admin/settlement-ops — hidden settlement-operations endpoint tests.
 *
 * Covers: admin authorization, method gate, deterministic metrics aggregation
 * in the response, lock operational visibility in the response, and
 * hidden-pricing preservation. The metrics + lock services are mocked — their
 * logic is covered by their own suites.
 */

let __authOk = true;
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async (_req: any, res: any) => {
    if (__authOk) return { ok: true, principal: { userId: 'admin-007' } };
    res.status(403).json({ error: 'forbidden' });
    return { ok: false };
  },
}));

let __metrics: any;
jest.mock('../../services/billing/payments/settlementMetrics', () => ({
  aggregateSettlementMetrics: async () => __metrics,
}));

let __locks: any;
jest.mock('../../services/billing/payments/settlementRuntimeLock', () => ({
  listSettlementLocks: async () => __locks,
}));

import handler from '../../../pages/api/super-admin/settlement-ops';

function mockReqRes(method: string) {
  const req: any = { method, query: {}, headers: {}, body: undefined };
  const res: any = {
    _status: 0, _json: null, _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    setHeader(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  __authOk = true;
  __metrics = {
    candidates_scanned: 42,
    sessions_expired: 9,
    duplicate_expiry_suppressions: 2,
    stale_webhook_rejections: 3,
    signature_verification_failures: 1,
  };
  __locks = {
    degraded: false,
    locks: [{
      lock_key: 'settlement_expiry_sweep',
      owner_token: 'owner-xyz',
      acquired_at: '2026-05-21T10:00:00.000Z',
      expires_at: '2026-05-21T10:15:00.000Z',
      is_expired: false,
    }],
  };
});

describe('settlement-ops endpoint — authorization + method', () => {
  test('non-super-admin → 403', async () => {
    __authOk = false;
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(403);
  });
  test('non-GET method → 405', async () => {
    const { req, res } = mockReqRes('POST');
    await handler(req, res);
    expect(res._status).toBe(405);
  });
  test('GET as super-admin → 200', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});

describe('settlement-ops endpoint — metrics aggregation', () => {
  test('the response carries exactly the five settlement metrics', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    const metrics = (res._json as any).metrics;
    expect(Object.keys(metrics).sort()).toEqual([
      'candidates_scanned', 'duplicate_expiry_suppressions', 'sessions_expired',
      'signature_verification_failures', 'stale_webhook_rejections',
    ]);
    expect(metrics.candidates_scanned).toBe(42);
    expect(metrics.sessions_expired).toBe(9);
  });

  test('the aggregation is surfaced deterministically (same mock → same body)', async () => {
    const a = mockReqRes('GET'); await handler(a.req, a.res);
    const b = mockReqRes('GET'); await handler(b.req, b.res);
    expect(b.res._json).toEqual(a.res._json);
  });
});

describe('settlement-ops endpoint — lock operational visibility', () => {
  test('the response surfaces lock holder / acquired_at / expires_at / is_expired', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    const locks = (res._json as any).locks;
    expect(locks.degraded).toBe(false);
    expect(locks.locks[0]).toMatchObject({
      lock_key: 'settlement_expiry_sweep',
      owner_token: 'owner-xyz',
      acquired_at: '2026-05-21T10:00:00.000Z',
      expires_at: '2026-05-21T10:15:00.000Z',
      is_expired: false,
    });
  });

  test('the degraded / fail-open mode state is surfaced', async () => {
    __locks = { degraded: true, locks: [] };
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect((res._json as any).locks.degraded).toBe(true);
  });

  test('the endpoint exposes no lock mutation surface (GET-only, read-only body)', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    const body = res._json as any;
    // Only the two read-only sections — no acquire/release/override field.
    expect(Object.keys(body).sort()).toEqual(['locks', 'metrics']);
  });
});

describe('settlement-ops endpoint — hidden-pricing preservation', () => {
  test('the response carries no pricing / revenue / invoice field', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    const serialized = JSON.stringify(res._json).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'revenue', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
