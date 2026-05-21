/**
 * paymentSettlementOrchestrator — sandbox settlement-lifecycle foundation tests.
 *
 * The orchestrator is dependency-injected, so these tests run with NO DB. They
 * cover: webhook normalization, the forward-only state machine, duplicate
 * webhook replay safety, deterministic reconciliation, provider identity
 * validation, provider compatibility, hidden-pricing preservation, and the
 * absence of any downstream wallet/credit/subscription action.
 */

// Inert supabase mock — the orchestrator transitively imports the store which
// constructs a client at load time; injected deps mean it is never exercised.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  reconcileSettlementWebhook,
  normalizeSettlementWebhook,
  canTransition,
  type SettlementOrchestratorDeps,
  type SettlementState,
} from '../../services/billing/payments/paymentSettlementOrchestrator';
import type { CheckoutSettlementRecord } from '../../services/billing/payments/checkoutSessionStore';

// ── provider webhook payload builders ───────────────────────────────────────
const razorpay = (event: string, status: string, orderId = 'order_abc', id = 'evt_rzp_1') => ({
  id, event,
  payload: { payment: { entity: { id: 'pay_1', order_id: orderId, status, amount: 50000 } } },
});
const stripe = (type: string, status: string, piId = 'pi_abc', id = 'evt_stripe_1') => ({
  id, type, data: { object: { id: piId, status, amount: 50000 } },
});
const cashfree = (type: string, payStatus: string, orderId = 'cf_order_abc') => ({
  type,
  data: {
    order: { order_id: orderId, order_status: 'ACTIVE' },
    payment: { cf_payment_id: '88990011', payment_status: payStatus, payment_amount: 500 },
  },
});
const phonepe = (code: string, state: string, txn = 'pp_txn_abc', id = 'T123') => ({
  code, merchantId: 'M1', transactionId: id,
  data: { merchantTransactionId: txn, transactionId: id, state, amount: 50000 },
});

// ── in-memory store deps ────────────────────────────────────────────────────
interface StoreHandle {
  deps: Partial<SettlementOrchestratorDeps>;
  sessions: Map<string, CheckoutSettlementRecord>;
  events: Set<string>;
  transitions: any[];
}
function makeStore(seed: Array<{ provider: string; ref: string; state: SettlementState }> = []): StoreHandle {
  const sessions = new Map<string, CheckoutSettlementRecord>();
  const events = new Set<string>();
  const transitions: any[] = [];
  for (const s of seed) {
    sessions.set(`${s.provider}:${s.ref}`, {
      idempotencyKey: `idem-${s.provider}-${s.ref}`,
      organizationId: 'org-1',
      provider: s.provider,
      providerReference: s.ref,
      sessionStatus: 'created',
      settlementStatus: s.state,
    });
  }
  const deps: Partial<SettlementOrchestratorDeps> = {
    findCheckoutSessionByProviderReference: async (provider, ref) =>
      sessions.get(`${provider}:${ref}`) ?? null,
    recordSettlementEvent: async (input) => {
      const k = `${input.provider}:${input.providerEventId}`;
      if (events.has(k)) return { duplicate: true };
      events.add(k);
      return { duplicate: false };
    },
    applySettlementTransition: async (input) => {
      transitions.push(input);
      for (const [key, s] of sessions) {
        if (s.idempotencyKey === input.idempotencyKey) {
          sessions.set(key, { ...s, settlementStatus: input.settlementStatus });
        }
      }
    },
  };
  return { deps, sessions, events, transitions };
}

const NORMALIZED_STATES: SettlementState[] =
  ['created', 'pending', 'authorized', 'succeeded', 'failed', 'cancelled', 'expired'];

describe('settlement — webhook normalization', () => {
  test('razorpay payment.captured → succeeded', () => {
    const r = normalizeSettlementWebhook('razorpay', razorpay('payment.captured', 'captured'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.normalizedStatus).toBe('succeeded');
    expect(r.event.sessionReference).toBe('order_abc');
    expect(r.event.providerEventId).toBe('evt_rzp_1');
    expect(r.event.providerRawStatus).toBe('captured');
  });
  test('razorpay payment.authorized → authorized; payment.failed → failed', () => {
    const a = normalizeSettlementWebhook('razorpay', razorpay('payment.authorized', 'authorized'));
    const f = normalizeSettlementWebhook('razorpay', razorpay('payment.failed', 'failed'));
    expect(a.ok && a.event.normalizedStatus).toBe('authorized');
    expect(f.ok && f.event.normalizedStatus).toBe('failed');
  });
  test('stripe payment_intent.succeeded → succeeded; .canceled → cancelled', () => {
    const s = normalizeSettlementWebhook('stripe', stripe('payment_intent.succeeded', 'succeeded'));
    const c = normalizeSettlementWebhook('stripe', stripe('payment_intent.canceled', 'canceled'));
    expect(s.ok && s.event.normalizedStatus).toBe('succeeded');
    expect(c.ok && c.event.normalizedStatus).toBe('cancelled');
  });
  test('stripe checkout.session.expired → expired', () => {
    const e = normalizeSettlementWebhook('stripe', stripe('checkout.session.expired', ''));
    expect(e.ok && e.event.normalizedStatus).toBe('expired');
  });
  test('cashfree SUCCESS → succeeded; FAILED → failed; USER_DROPPED → cancelled', () => {
    const s = normalizeSettlementWebhook('cashfree', cashfree('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS'));
    const f = normalizeSettlementWebhook('cashfree', cashfree('PAYMENT_FAILED_WEBHOOK', 'FAILED'));
    const d = normalizeSettlementWebhook('cashfree', cashfree('PAYMENT_DROPPED_WEBHOOK', 'USER_DROPPED'));
    expect(s.ok && s.event.normalizedStatus).toBe('succeeded');
    expect(f.ok && f.event.normalizedStatus).toBe('failed');
    expect(d.ok && d.event.normalizedStatus).toBe('cancelled');
  });
  test('phonepe COMPLETED → succeeded; FAILED → failed', () => {
    const s = normalizeSettlementWebhook('phonepe', phonepe('PAYMENT_SUCCESS', 'COMPLETED'));
    const f = normalizeSettlementWebhook('phonepe', phonepe('PAYMENT_ERROR', 'FAILED'));
    expect(s.ok && s.event.normalizedStatus).toBe('succeeded');
    expect(f.ok && f.event.normalizedStatus).toBe('failed');
  });
  test('missing session reference → invalid', () => {
    const r = normalizeSettlementWebhook('razorpay', razorpay('payment.captured', 'captured', ''));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_session_reference');
  });
  test('unmapped provider status → invalid (no silent fallthrough)', () => {
    const r = normalizeSettlementWebhook('cashfree', cashfree('WEIRD', 'TELEPORTED'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unmapped_status');
  });
  test('normalizedStatus is ALWAYS one of the 7 internal states (no provider leakage)', () => {
    const all = [
      normalizeSettlementWebhook('razorpay', razorpay('payment.captured', 'captured')),
      normalizeSettlementWebhook('stripe', stripe('payment_intent.processing', 'processing')),
      normalizeSettlementWebhook('cashfree', cashfree('X', 'PENDING')),
      normalizeSettlementWebhook('phonepe', phonepe('PAYMENT_PENDING', 'PENDING')),
    ];
    for (const r of all) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(NORMALIZED_STATES).toContain(r.event.normalizedStatus);
    }
  });
});

describe('settlement — forward-only state machine', () => {
  test('forward progressive transitions are allowed', () => {
    expect(canTransition('created', 'pending')).toBe(true);
    expect(canTransition('pending', 'authorized')).toBe(true);
    expect(canTransition('authorized', 'succeeded')).toBe(true);
    expect(canTransition('created', 'succeeded')).toBe(true);
  });
  test('a failure terminal is reachable from any non-terminal state', () => {
    expect(canTransition('created', 'failed')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('authorized', 'expired')).toBe(true);
  });
  test('backward / regressive transitions are rejected', () => {
    expect(canTransition('authorized', 'pending')).toBe(false);
    expect(canTransition('succeeded', 'authorized')).toBe(false);
    expect(canTransition('pending', 'created')).toBe(false);
  });
  test('terminal states are final', () => {
    for (const t of ['succeeded', 'failed', 'cancelled', 'expired'] as SettlementState[]) {
      for (const to of NORMALIZED_STATES) {
        expect(canTransition(t, to)).toBe(false);
      }
    }
  });
  test('an identical-state transition is a no-op (idempotent)', () => {
    for (const s of NORMALIZED_STATES) expect(canTransition(s, s)).toBe(false);
  });
});

describe('settlement — provider identity validation', () => {
  test('an unknown provider is rejected', async () => {
    const { deps } = makeStore();
    const r = await reconcileSettlementWebhook(
      { provider: 'paypal' as any, payload: razorpay('payment.captured', 'captured') }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('unknown_provider');
  });
  test('a malformed payload is rejected as invalid_payload', async () => {
    const { deps } = makeStore();
    const r = await reconcileSettlementWebhook({ provider: 'razorpay', payload: { junk: true } }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('invalid_payload');
  });
});

describe('settlement — reconciliation + state transitions', () => {
  test('a first webhook reconciles a seeded session created → succeeded', async () => {
    const store = makeStore([{ provider: 'razorpay', ref: 'order_abc', state: 'created' }]);
    const r = await reconcileSettlementWebhook(
      { provider: 'razorpay', payload: razorpay('payment.captured', 'captured') }, store.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('reconciled');
    expect(r.replayed).toBe(false);
    expect(r.previous_state).toBe('created');
    expect(r.settlement_state).toBe('succeeded');
    expect(store.transitions).toHaveLength(1);
    expect(store.transitions[0].settlementStatus).toBe('succeeded');
    expect(store.transitions[0].settledAt).toEqual(expect.any(String)); // settled_at set on success
  });

  test('a stale / out-of-order event against a terminal session → no_transition', async () => {
    const store = makeStore([{ provider: 'stripe', ref: 'pi_abc', state: 'succeeded' }]);
    const r = await reconcileSettlementWebhook(
      { provider: 'stripe', payload: stripe('payment_intent.requires_action', 'requires_action') }, store.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('no_transition');
    expect(r.settlement_state).toBe('succeeded'); // unchanged
    expect(store.transitions).toHaveLength(0);     // nothing persisted
  });

  test('an event with no matching persisted session → unmatched (recorded, not actioned)', async () => {
    const store = makeStore(); // no sessions seeded
    const r = await reconcileSettlementWebhook(
      { provider: 'phonepe', payload: phonepe('PAYMENT_SUCCESS', 'COMPLETED') }, store.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('unmatched');
    expect(store.transitions).toHaveLength(0);
  });

  test('progressive lifecycle: pending → authorized → succeeded across webhooks', async () => {
    const store = makeStore([{ provider: 'razorpay', ref: 'order_abc', state: 'created' }]);
    const r1 = await reconcileSettlementWebhook(
      { provider: 'razorpay', payload: razorpay('payment.pending', 'pending', 'order_abc', 'evt_1') }, store.deps);
    const r2 = await reconcileSettlementWebhook(
      { provider: 'razorpay', payload: razorpay('payment.authorized', 'authorized', 'order_abc', 'evt_2') }, store.deps);
    const r3 = await reconcileSettlementWebhook(
      { provider: 'razorpay', payload: razorpay('payment.captured', 'captured', 'order_abc', 'evt_3') }, store.deps);
    expect([r1, r2, r3].every((r) => r.ok && r.status === 'reconciled')).toBe(true);
    expect(store.transitions.map((t) => t.settlementStatus)).toEqual(['pending', 'authorized', 'succeeded']);
  });
});

describe('settlement — duplicate webhook replay safety', () => {
  test('a redelivered (identical) webhook is a safe no-op', async () => {
    const store = makeStore([{ provider: 'razorpay', ref: 'order_abc', state: 'created' }]);
    const payload = razorpay('payment.captured', 'captured');
    const first = await reconcileSettlementWebhook({ provider: 'razorpay', payload }, store.deps);
    const second = await reconcileSettlementWebhook({ provider: 'razorpay', payload }, store.deps);
    expect(first.ok && first.status).toBe('reconciled');
    expect(second.ok && second.status).toBe('duplicate');
    if (second.ok) expect(second.replayed).toBe(true);
    // The transition was applied EXACTLY once — no duplicate persistence.
    expect(store.transitions).toHaveLength(1);
  });

  test('repeated reconciliation N times applies the transition exactly once', async () => {
    const store = makeStore([{ provider: 'stripe', ref: 'pi_abc', state: 'created' }]);
    const payload = stripe('payment_intent.succeeded', 'succeeded');
    for (let i = 0; i < 5; i++) {
      await reconcileSettlementWebhook({ provider: 'stripe', payload }, store.deps);
    }
    expect(store.transitions).toHaveLength(1);
    expect(store.events.size).toBe(1); // event recorded exactly once
  });

  test('two DISTINCT events on the same session are NOT collapsed as duplicates', async () => {
    const store = makeStore([{ provider: 'cashfree', ref: 'cf_order_abc', state: 'created' }]);
    const pending = await reconcileSettlementWebhook(
      { provider: 'cashfree', payload: cashfree('PAYMENT_PENDING_WEBHOOK', 'PENDING') }, store.deps);
    const success = await reconcileSettlementWebhook(
      { provider: 'cashfree', payload: cashfree('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS') }, store.deps);
    expect(pending.ok && pending.status).toBe('reconciled');
    expect(success.ok && success.status).toBe('reconciled');
    expect(store.transitions.map((t) => t.settlementStatus)).toEqual(['pending', 'succeeded']);
  });
});

describe('settlement — deterministic reconciliation', () => {
  test('the same webhook yields a deterministic outcome shape', async () => {
    const s1 = makeStore([{ provider: 'phonepe', ref: 'pp_txn_abc', state: 'created' }]);
    const s2 = makeStore([{ provider: 'phonepe', ref: 'pp_txn_abc', state: 'created' }]);
    const payload = phonepe('PAYMENT_SUCCESS', 'COMPLETED');
    const r1 = await reconcileSettlementWebhook({ provider: 'phonepe', payload }, s1.deps);
    const r2 = await reconcileSettlementWebhook({ provider: 'phonepe', payload }, s2.deps);
    expect(r1).toEqual(r2);
  });
  test('normalization is deterministic — same payload → same event', () => {
    const p = stripe('payment_intent.succeeded', 'succeeded');
    expect(normalizeSettlementWebhook('stripe', p)).toEqual(normalizeSettlementWebhook('stripe', p));
  });
});

describe('settlement — provider compatibility', () => {
  test.each([
    ['razorpay', razorpay('payment.captured', 'captured', 'r_ref'), 'r_ref'],
    ['stripe', stripe('payment_intent.succeeded', 'succeeded', 's_ref'), 's_ref'],
    ['cashfree', cashfree('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS', 'c_ref'), 'c_ref'],
    ['phonepe', phonepe('PAYMENT_SUCCESS', 'COMPLETED', 'p_ref'), 'p_ref'],
  ])('%s reconciles through the same canonical path', async (provider, payload, ref) => {
    const store = makeStore([{ provider, ref, state: 'created' }]);
    const r = await reconcileSettlementWebhook({ provider: provider as any, payload }, store.deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe('reconciled');
    expect(r.settlement_state).toBe('succeeded');
  });
});

describe('settlement — NO downstream wallet / credit / subscription activation', () => {
  test('reconciliation only ever calls the 3 settlement-store deps', async () => {
    const store = makeStore([{ provider: 'razorpay', ref: 'order_abc', state: 'created' }]);
    // The injected deps surface is EXACTLY the settlement store — there is no
    // wallet / credit / ledger / subscription dependency to invoke.
    expect(Object.keys(store.deps).sort()).toEqual([
      'applySettlementTransition', 'findCheckoutSessionByProviderReference', 'recordSettlementEvent',
    ]);
    await reconcileSettlementWebhook(
      { provider: 'razorpay', payload: razorpay('payment.captured', 'captured') }, store.deps);
    // The persisted transition carries ONLY lifecycle fields — no credits,
    // no wallet balance, no entitlement, no invoice.
    const t = store.transitions[0];
    expect(Object.keys(t).sort()).toEqual([
      'idempotencyKey', 'providerEventReference', 'providerRawStatus', 'settledAt', 'settlementStatus',
    ]);
    const serialized = JSON.stringify(store.transitions).toLowerCase();
    for (const f of ['credit', 'wallet', 'entitlement', 'subscription', 'invoice', 'balance']) {
      expect(serialized).not.toContain(f);
    }
  });
});

describe('settlement — hidden-pricing preservation', () => {
  test('the reconcile result carries NO amount / price field', async () => {
    const store = makeStore([{ provider: 'razorpay', ref: 'order_abc', state: 'created' }]);
    const r = await reconcileSettlementWebhook(
      { provider: 'razorpay', payload: razorpay('payment.captured', 'captured') }, store.deps);
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
  test('the normalized event carries NO amount even when the payload does', () => {
    // razorpay()/stripe() payloads embed amount: 50000 — it must not survive.
    const r = normalizeSettlementWebhook('razorpay', razorpay('payment.captured', 'captured'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.event).toLowerCase();
    for (const f of ['amount', 'price', 'pricing']) {
      expect(serialized).not.toContain(f);
    }
  });
  test('the persisted transition carries NO amount', async () => {
    const store = makeStore([{ provider: 'stripe', ref: 'pi_abc', state: 'created' }]);
    await reconcileSettlementWebhook(
      { provider: 'stripe', payload: stripe('payment_intent.succeeded', 'succeeded') }, store.deps);
    expect(JSON.stringify(store.transitions[0]).toLowerCase()).not.toContain('amount');
  });
});

// Provider-specific sandbox signature verification is covered by
// paymentWebhookVerifier.test.ts.
