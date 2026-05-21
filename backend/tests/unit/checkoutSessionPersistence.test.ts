/**
 * checkoutSessionOrchestrator — persistence + idempotent-replay tests.
 *
 * Covers the additive persistence layer wired into the orchestrator:
 *   - first-time checkout persists the normalized session
 *   - a repeated identical request REPLAYS the persisted session and performs
 *     NO duplicate provider dispatch
 *   - replay is deterministic (same key, byte-identical session)
 *   - the persisted input + the replayed result stay pricing-blind
 *   - provider-governance still runs on the first-time (non-replay) path
 *
 * The orchestrator is dependency-injected, so these tests run with NO DB and
 * NO live provider — the store fns are injected.
 */

// Inert supabase mock — the orchestrator's module graph constructs a client at
// load time; injected deps mean it is never exercised.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  orchestrateCheckoutSession,
  deriveCheckoutIdempotencyKey,
  type OrchestratorDeps,
  type OrchestrateCheckoutArgs,
  type NormalizedCheckoutSession,
} from '../../services/billing/payments/checkoutSessionOrchestrator';
import type { PersistCheckoutSessionInput } from '../../services/billing/payments/checkoutSessionStore';

const BASE_ARGS: OrchestrateCheckoutArgs = {
  organizationId: 'org-1',
  initiatedByUserId: 'user-1',
  provider: 'razorpay',
  intentType: 'topup',
  reference: 'topup_credits_500', // real hidden-registry key → amount 500 INR
};

interface Recorder {
  dispatchCalls: any[];
  persistCalls: PersistCheckoutSessionInput[];
  findCalls: string[];
  amountCalls: any[];
  governanceCalls: any[];
}

interface FakeOpts {
  /** When set, findPersistedCheckoutSession returns this (a replay hit). */
  persisted?: NormalizedCheckoutSession | null;
  /** Back the store with a stateful in-memory map (find reads what persist wrote). */
  statefulStore?: boolean;
  dispatch?: OrchestratorDeps['dispatchCheckout'];
}

function makeDeps(opts: FakeOpts = {}): { deps: Partial<OrchestratorDeps>; rec: Recorder } {
  const rec: Recorder = { dispatchCalls: [], persistCalls: [], findCalls: [], amountCalls: [], governanceCalls: [] };
  const store = new Map<string, NormalizedCheckoutSession>();

  const deps: Partial<OrchestratorDeps> = {
    findPersistedCheckoutSession: async (key: string) => {
      rec.findCalls.push(key);
      if (opts.statefulStore) return store.get(key) ?? null;
      return opts.persisted ?? null;
    },
    persistCheckoutSession: async (input: PersistCheckoutSessionInput) => {
      rec.persistCalls.push(input);
      if (opts.statefulStore) store.set(input.idempotencyKey, input.session);
    },
    resolveOrgBillingContext: async () => ({
      country: 'IN', currency: 'INR', region: null, source: 'company_billing_profile',
    }),
    resolveAvailableProviders: async (ctx: any) => {
      rec.governanceCalls.push(ctx);
      return {
        available: [{
          provider: 'razorpay' as any,
          visible_in_checkout: true,
          subscriptions_enabled: false,
          topups_enabled: true,
          supported_payment_methods: ['card', 'upi'],
          supported_countries: [],
          supported_currencies: [],
          priority: 10,
          sandbox_mode: true,
        }],
        visible: [], supported_methods: [], recommended: null, source: 'db',
      };
    },
    isProviderAvailableForCheckout: async () => ({ ok: true }),
    resolveBillingAmount: async (a: any) => {
      rec.amountCalls.push(a);
      return { ok: true as const, amount: { amount: 500, currency: 'INR' } };
    },
    dispatchCheckout: async (req) => {
      rec.dispatchCalls.push(req);
      if (opts.dispatch) return opts.dispatch(req);
      return {
        ok: true, provider: req.provider, amount: req.amount, currency: req.currency,
        sessionId: 'order_test_1', redirectUrl: 'https://rzp.test/checkout/order_test_1',
      };
    },
    getProviderAdapter: ((p: string) => ({
      describe: () => ({ name: p as any, mode: 'test', capabilities: [] }),
      createCheckoutSession: async () => ({}) as any,
      handleWebhook: async () => ({}) as any,
    })) as any,
  };
  return { deps, rec };
}

const PERSISTED_SESSION: NormalizedCheckoutSession = {
  provider: 'razorpay',
  provider_mode: 'test',
  session_status: 'created',
  redirect_url: 'https://rzp.test/checkout/persisted_1',
  expires_at: null,
  provider_reference: 'order_persisted_1',
  supported_payment_methods: ['card', 'upi'],
};

describe('checkout persistence — first-time checkout persists the session', () => {
  test('a first-time checkout dispatches once and persists the normalized session', async () => {
    const { deps, rec } = makeDeps();
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replayed).toBe(false);
    expect(rec.dispatchCalls).toHaveLength(1);
    expect(rec.persistCalls).toHaveLength(1);
  });

  test('the persisted input is keyed by the deterministic idempotency key', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(rec.persistCalls[0].idempotencyKey).toBe(deriveCheckoutIdempotencyKey(BASE_ARGS));
    expect(rec.persistCalls[0].organizationId).toBe('org-1');
    expect(rec.persistCalls[0].intentType).toBe('topup');
    expect(rec.persistCalls[0].referenceKey).toBe('topup_credits_500');
  });

  test('find is consulted BEFORE dispatch (replay short-circuit ordering)', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(rec.findCalls).toHaveLength(1);
    expect(rec.findCalls[0]).toBe(deriveCheckoutIdempotencyKey(BASE_ARGS));
  });

  test('the persisted session equals the returned normalized session', async () => {
    const { deps, rec } = makeDeps();
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rec.persistCalls[0].session).toEqual(r.session);
  });

  test('a NOT_IMPLEMENTED passthrough session is also persisted', async () => {
    const { deps, rec } = makeDeps({
      dispatch: async () => ({
        ok: false, provider: 'razorpay', amount: 0, currency: 'INR',
        error: 'adapter not implemented', code: 'NOT_IMPLEMENTED',
      }),
    });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.session_status).toBe('not_implemented');
    expect(rec.persistCalls).toHaveLength(1);
  });

  test('a genuine provider error is NOT persisted (nothing to replay)', async () => {
    const { deps, rec } = makeDeps({
      dispatch: async () => ({
        ok: false, provider: 'razorpay', amount: 0, currency: 'INR',
        error: 'gateway down', code: 'PROVIDER_ERROR',
      }),
    });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(false);
    expect(rec.persistCalls).toHaveLength(0);
  });
});

describe('checkout persistence — idempotent replay (no duplicate dispatch)', () => {
  test('a persisted session is replayed: ok:true, replayed:true, no provider dispatch', async () => {
    const { deps, rec } = makeDeps({ persisted: PERSISTED_SESSION });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replayed).toBe(true);
    expect(r.session).toEqual(PERSISTED_SESSION);
    // The whole provider path is skipped — no dispatch, no amount resolution.
    expect(rec.dispatchCalls).toHaveLength(0);
    expect(rec.amountCalls).toHaveLength(0);
    // Nothing new is persisted on a replay.
    expect(rec.persistCalls).toHaveLength(0);
  });

  test('replay returns the deterministic idempotency key', async () => {
    const { deps } = makeDeps({ persisted: PERSISTED_SESSION });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idempotency_key).toBe(deriveCheckoutIdempotencyKey(BASE_ARGS));
  });

  test('two identical requests against a stateful store: dispatch once, replay once', async () => {
    const { deps, rec } = makeDeps({ statefulStore: true });
    const r1 = await orchestrateCheckoutSession(BASE_ARGS, deps);
    const r2 = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    // First request created + persisted; second replayed the persisted row.
    expect(r1.replayed).toBe(false);
    expect(r2.replayed).toBe(true);
    expect(rec.dispatchCalls).toHaveLength(1);  // NO duplicate provider dispatch
    expect(rec.persistCalls).toHaveLength(1);   // persisted exactly once
    // The replay reproduces the original session byte-identically.
    expect(r2.session).toEqual(r1.session);
    expect(r2.idempotency_key).toBe(r1.idempotency_key);
  });

  test('a different reference does NOT replay another reference\'s session', async () => {
    const { deps, rec } = makeDeps({ statefulStore: true });
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    const r2 = await orchestrateCheckoutSession(
      { ...BASE_ARGS, intentType: 'subscription', reference: 'plan_pro_monthly' }, deps);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.replayed).toBe(false);            // distinct key → fresh checkout
    expect(rec.dispatchCalls).toHaveLength(2);
  });
});

describe('checkout persistence — provider-governance compatibility', () => {
  test('the first-time (non-replay) path still runs provider governance', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(rec.governanceCalls).toHaveLength(1); // governance enforced before dispatch
  });

  test('a replay short-circuits BEFORE governance (the session was already governed)', async () => {
    const { deps, rec } = makeDeps({ persisted: PERSISTED_SESSION });
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(rec.governanceCalls).toHaveLength(0);
  });

  test('input validation still runs before the replay short-circuit', async () => {
    const { deps, rec } = makeDeps({ persisted: PERSISTED_SESSION });
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: 'paypal' as any }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_provider');
    expect(rec.findCalls).toHaveLength(0); // rejected before the store is consulted
  });
});

describe('checkout persistence — hidden-pricing preservation', () => {
  test('the persisted input carries NO amount / price field', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    const serialized = JSON.stringify(rec.persistCalls[0]).toLowerCase();
    for (const f of ['amount', 'amount_minor', 'price', 'plan_price', 'pricing', 'subtotal', 'total']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
    // currency is the only money-adjacent field, and it is geography metadata.
    expect(rec.persistCalls[0].currency).toBe('INR');
  });

  test('a replayed result carries NO pricing fields', async () => {
    const { deps } = makeDeps({ persisted: PERSISTED_SESSION });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });

  test('the persisted session carries exactly the 7 normalized fields', async () => {
    const { deps, rec } = makeDeps();
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(Object.keys(rec.persistCalls[0].session).sort()).toEqual([
      'expires_at', 'provider', 'provider_mode', 'provider_reference',
      'redirect_url', 'session_status', 'supported_payment_methods',
    ]);
  });
});
