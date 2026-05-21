/**
 * POST /api/billing/checkout-session — endpoint tests.
 *
 * Covers: authenticated-only enforcement, method gate, intent/reference
 * validation, geography-override rejection, delegation to the orchestrator,
 * result mapping, hidden-pricing preservation. The orchestrator itself is
 * mocked — its logic is covered by checkoutSessionOrchestrator.test.ts.
 */

let __authOk = true;
let __activeOrgId: string | null = 'org-1';
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async () =>
    __authOk
      ? { ok: true, principal: { userId: 'u1', activeOrgId: __activeOrgId, organizations: [] } }
      : { ok: false, reason: 'no_session' },
}));

let __orchestratorResult: any = null;
let __orchestratorArgs: any[] = [];
jest.mock('../../services/billing/payments/checkoutSessionOrchestrator', () => ({
  orchestrateCheckoutSession: async (args: any) => {
    __orchestratorArgs.push(args);
    return __orchestratorResult;
  },
}));

import handler from '../../../pages/api/billing/checkout-session';

function mockReqRes(method: string, body?: unknown) {
  const req: any = { method, query: {}, headers: {}, body };
  const res: any = {
    _status: 0, _json: null, _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    setHeader(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return { req, res };
}

const OK_RESULT = {
  ok: true,
  idempotency_key: 'abc123',
  session: {
    provider: 'razorpay', provider_mode: 'test', session_status: 'created',
    redirect_url: 'https://rzp.test/checkout/x', expires_at: null,
    provider_reference: 'order_x', supported_payment_methods: ['card', 'upi'],
  },
};

beforeEach(() => {
  __authOk = true; __activeOrgId = 'org-1';
  __orchestratorResult = OK_RESULT; __orchestratorArgs = [];
});

describe('checkout-session endpoint — auth + method', () => {
  test('non-POST → 405', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(405);
  });
  test('unauthenticated → 401 (authenticated-only enforcement)', async () => {
    __authOk = false;
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    expect(res._status).toBe(401);
  });
  test('no active organization → 409', async () => {
    __activeOrgId = null;
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    expect(res._status).toBe(409);
  });
});

describe('checkout-session endpoint — geography override prohibited', () => {
  test('country in body → 400 geography_override_prohibited', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1', country: 'US' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('geography_override_prohibited');
  });
  test('currency in body → 400 geography_override_prohibited', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1', currency: 'USD' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('geography_override_prohibited');
  });
});

describe('checkout-session endpoint — intent / reference validation', () => {
  test('invalid intent_type → 400', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'gift' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_intent_type');
  });
  test('subscription intent without plan_reference → 400', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'subscription' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('plan_reference_required');
  });
  test('topup intent without topup_reference → 400', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('topup_reference_required');
  });
  test('subscription intent with a topup_reference → 400 reference_intent_mismatch', async () => {
    const { req, res } = mockReqRes('POST', {
      provider: 'razorpay', intent_type: 'subscription', plan_reference: 'p1', topup_reference: 't1',
    });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('reference_intent_mismatch');
  });
  test('unknown provider → 400', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'paypal', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('unknown_provider');
  });
});

describe('checkout-session endpoint — delegation + mapping', () => {
  test('valid topup → 200, delegates to orchestrator with derived args', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 'topup_500' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect((res._json as any).session.session_status).toBe('created');
    expect((res._json as any).idempotency_key).toBe('abc123');
    // Orchestrator received the org from the session, the userId, and the reference.
    expect(__orchestratorArgs[0]).toMatchObject({
      organizationId: 'org-1', initiatedByUserId: 'u1',
      provider: 'razorpay', intentType: 'topup', reference: 'topup_500',
    });
  });

  test('valid subscription → reference is the plan_reference', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'subscription', plan_reference: 'plan_pro' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__orchestratorArgs[0].reference).toBe('plan_pro');
    expect(__orchestratorArgs[0].intentType).toBe('subscription');
  });

  test('orchestrator client rejection → 400', async () => {
    __orchestratorResult = { ok: false, code: 'provider_disabled', reason: 'provider razorpay not available: provider_disabled' };
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('provider_disabled');
  });

  test('orchestrator provider error → 502', async () => {
    __orchestratorResult = { ok: false, code: 'provider_error', reason: 'gateway down' };
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    expect(res._status).toBe(502);
    expect((res._json as any).error).toBe('provider_error');
  });

  test('NOT_IMPLEMENTED passthrough → 200 with session_status=not_implemented', async () => {
    __orchestratorResult = {
      ok: true, idempotency_key: 'k2',
      session: {
        provider: 'stripe', provider_mode: 'unknown', session_status: 'not_implemented',
        redirect_url: null, expires_at: null, provider_reference: null, supported_payment_methods: ['card'],
      },
    };
    const { req, res } = mockReqRes('POST', { provider: 'stripe', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect((res._json as any).session.session_status).toBe('not_implemented');
  });
});

describe('checkout-session endpoint — hidden-pricing preservation', () => {
  test('response carries no pricing fields', async () => {
    const { req, res } = mockReqRes('POST', { provider: 'razorpay', intent_type: 'topup', topup_reference: 't1' });
    await handler(req, res);
    const serialized = JSON.stringify(res._json).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
