/**
 * Deterministic sandbox-verification soak foundation (INTERNAL).
 *
 * A repeatable, in-process soak that exercises the full sandbox settlement
 * path end-to-end with NO DB and NO network — every dependency is in-memory.
 * It is a PRE-PRODUCTION GATE artifact: run it before any production
 * settlement activation to prove the sandbox lifecycle behaves deterministi-
 * cally.
 *
 * Scenarios:
 *   1-4  verified sandbox webhook — Razorpay / Stripe / Cashfree / PhonePe
 *   5    stale-timestamp rejection (replay window)
 *   6    replayed webhook → duplicate suppression
 *   7    expiry sweep idempotency
 *   8    post-expiry reconciliation → no_transition
 *
 * STRICTLY internal: no HTTP surface, no live settlement, no wallet/credit/
 * subscription side-effect. PRICING-BLIND — no amount is read or reported.
 */

import crypto from 'crypto';
import type { SupportedProvider } from './paymentProviderAdapter';
import { verifyProviderWebhookSignature } from './paymentWebhookVerifier';
import {
  reconcileSettlementWebhook,
  type SettlementOrchestratorDeps,
} from './paymentSettlementOrchestrator';
import { sweepStaleSettlements, type ExpirySweeperDeps } from './settlementExpirySweeper';
import type { CheckoutSettlementRecord } from './checkoutSessionStore';

export interface SoakScenarioResult {
  name: string;
  ok: boolean;
  detail: string;
}
export interface SoakReport {
  ok: boolean;
  passed: number;
  failed: number;
  scenarios: SoakScenarioResult[];
}

// Deterministic fixtures — fixed clock + fixed sandbox secrets.
const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;
const SECRET: Record<SupportedProvider, string> = {
  razorpay: 'soak_rzp_secret',
  stripe: 'soak_stripe_secret',
  cashfree: 'soak_cf_secret',
  phonepe: 'soak_pp_salt',
};
const ENV_NAME: Record<SupportedProvider, string> = {
  razorpay: 'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY',
  stripe: 'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE',
  cashfree: 'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE',
  phonepe: 'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE',
};

// ── signature builders (mirror each provider's sandbox scheme) ──────────────
const razorpaySig = (body: string) =>
  crypto.createHmac('sha256', SECRET.razorpay).update(body).digest('hex');
const stripeHeader = (body: string, t: number) =>
  `t=${t},v1=${crypto.createHmac('sha256', SECRET.stripe).update(`${t}.${body}`).digest('hex')}`;
const cashfreeSig = (body: string, ts: string) =>
  crypto.createHmac('sha256', SECRET.cashfree).update(`${ts}${body}`).digest('base64');
const phonepeXVerify = (body: string) => {
  const b64 = Buffer.from(body, 'utf8').toString('base64');
  return `${crypto.createHash('sha256').update(b64 + SECRET.phonepe).digest('hex')}###1`;
};

// ── webhook payloads ────────────────────────────────────────────────────────
const razorpayCaptured = (orderId: string, eventId: string) => ({
  id: eventId,
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_soak', order_id: orderId, status: 'captured' } } },
});

// ── in-memory stores ────────────────────────────────────────────────────────
function reconcileDeps(
  seed: Array<{ provider: SupportedProvider; ref: string; state: string }>,
): Partial<SettlementOrchestratorDeps> {
  const sessions = new Map<string, CheckoutSettlementRecord>();
  const events = new Set<string>();
  for (const s of seed) {
    sessions.set(`${s.provider}:${s.ref}`, {
      idempotencyKey: `idem-${s.ref}`, organizationId: 'org-soak', provider: s.provider,
      providerReference: s.ref, sessionStatus: 'created', settlementStatus: s.state,
    });
  }
  return {
    findCheckoutSessionByProviderReference: async (p, r) => sessions.get(`${p}:${r}`) ?? null,
    recordSettlementEvent: async (i) => {
      const k = `${i.provider}:${i.providerEventId}`;
      if (events.has(k)) return { duplicate: true };
      events.add(k);
      return { duplicate: false };
    },
    applySettlementTransition: async (i) => {
      for (const [k, s] of sessions) {
        if (s.idempotencyKey === i.idempotencyKey) {
          sessions.set(k, { ...s, settlementStatus: i.settlementStatus });
        }
      }
    },
  };
}

function sweepDeps(
  seed: Array<{ idempotencyKey: string; provider: string; settlementStatus: string; createdAt: string }>,
): Partial<ExpirySweeperDeps> {
  const sessions = seed.map((s) => ({
    ...s, providerReference: `ref-${s.idempotencyKey}`, lastReconciledAt: null as string | null,
  }));
  const events = new Set<string>();
  return {
    findSettlementSweepCandidates: async () =>
      sessions
        .filter((s) => s.settlementStatus === 'created' || s.settlementStatus === 'pending')
        .map((s) => ({ ...s })),
    recordSettlementEvent: async (i) => {
      const k = `${i.provider}:${i.providerEventId}`;
      if (events.has(k)) return { duplicate: true };
      events.add(k);
      return { duplicate: false };
    },
    applySettlementTransition: async (i) => {
      const s = sessions.find((x) => x.idempotencyKey === i.idempotencyKey);
      if (s) s.settlementStatus = i.settlementStatus;
    },
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * Run the deterministic sandbox-verification soak. Returns a per-scenario
 * pass/fail report — `ok` is true only when every scenario passes.
 */
export async function runSettlementSandboxSoak(): Promise<SoakReport> {
  const scenarios: SoakScenarioResult[] = [];
  const savedEnv: Record<string, string | undefined> = {};
  for (const p of Object.keys(ENV_NAME) as SupportedProvider[]) {
    savedEnv[ENV_NAME[p]] = process.env[ENV_NAME[p]];
    process.env[ENV_NAME[p]] = SECRET[p];
  }
  const savedSaltIdx = process.env.SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE;
  delete process.env.SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE; // default index '1'

  const run = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
      scenarios.push({ name, ok: true, detail: 'passed' });
    } catch (e) {
      scenarios.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };

  try {
    // ── 1-4 verified sandbox webhooks ──────────────────────────────────────
    await run('razorpay_verified_sandbox_webhook', () => {
      const body = '{"event":"payment.captured"}';
      const r = verifyProviderWebhookSignature({
        provider: 'razorpay', rawBody: body, nowMs: NOW_MS,
        headers: { 'x-razorpay-signature': razorpaySig(body) },
      });
      assert(r.ok && r.mode === 'verified', `razorpay verify expected verified — got ${JSON.stringify(r)}`);
    });
    await run('stripe_verified_sandbox_webhook', () => {
      const body = '{"id":"evt_soak","type":"payment_intent.succeeded"}';
      const r = verifyProviderWebhookSignature({
        provider: 'stripe', rawBody: body, nowMs: NOW_MS,
        headers: { 'stripe-signature': stripeHeader(body, NOW_SEC) },
      });
      assert(r.ok && r.mode === 'verified', `stripe verify expected verified — got ${JSON.stringify(r)}`);
    });
    await run('cashfree_verified_sandbox_webhook', () => {
      const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
      const ts = String(NOW_MS);
      const r = verifyProviderWebhookSignature({
        provider: 'cashfree', rawBody: body, nowMs: NOW_MS,
        headers: { 'x-webhook-signature': cashfreeSig(body, ts), 'x-webhook-timestamp': ts },
      });
      assert(r.ok && r.mode === 'verified', `cashfree verify expected verified — got ${JSON.stringify(r)}`);
    });
    await run('phonepe_verified_sandbox_webhook', () => {
      const body = '{"code":"PAYMENT_SUCCESS"}';
      const r = verifyProviderWebhookSignature({
        provider: 'phonepe', rawBody: body, nowMs: NOW_MS,
        headers: { 'x-verify': phonepeXVerify(body) },
      });
      assert(r.ok && r.mode === 'verified', `phonepe verify expected verified — got ${JSON.stringify(r)}`);
    });

    // ── 5 stale-timestamp rejection ────────────────────────────────────────
    await run('stale_timestamp_rejection', () => {
      const body = '{"id":"evt_stale"}';
      const staleT = NOW_SEC - 10_000; // far outside the 300s replay window
      const r = verifyProviderWebhookSignature({
        provider: 'stripe', rawBody: body, nowMs: NOW_MS,
        headers: { 'stripe-signature': stripeHeader(body, staleT) },
      });
      assert(!r.ok && r.reason === 'stale_timestamp', `expected stale_timestamp — got ${JSON.stringify(r)}`);
    });

    // ── 6 replayed webhook → duplicate suppression ─────────────────────────
    await run('replayed_webhook_duplicate_suppression', async () => {
      const deps = reconcileDeps([{ provider: 'razorpay', ref: 'order_soak_6', state: 'created' }]);
      const payload = razorpayCaptured('order_soak_6', 'evt_soak_6');
      const first = await reconcileSettlementWebhook({ provider: 'razorpay', payload }, deps);
      const second = await reconcileSettlementWebhook({ provider: 'razorpay', payload }, deps);
      assert(first.ok && first.status === 'reconciled', `first reconcile expected reconciled — got ${JSON.stringify(first)}`);
      assert(second.ok && second.status === 'duplicate', `replay expected duplicate — got ${JSON.stringify(second)}`);
    });

    // ── 7 expiry sweep idempotency ─────────────────────────────────────────
    await run('expiry_sweep_idempotency', async () => {
      const deps = sweepDeps([{
        idempotencyKey: 'idem-soak-7', provider: 'razorpay', settlementStatus: 'created',
        createdAt: new Date(NOW_MS - 60 * 60_000).toISOString(),
      }]);
      const policy = { createdMaxAgeMs: 30 * 60_000 };
      const first = await sweepStaleSettlements({ nowMs: NOW_MS, policy }, deps);
      const second = await sweepStaleSettlements({ nowMs: NOW_MS, policy }, deps);
      assert(first.expired === 1, `first sweep expected 1 expired — got ${first.expired}`);
      assert(second.expired === 0, `second sweep expected 0 expired (idempotent) — got ${second.expired}`);
    });

    // ── 8 post-expiry reconciliation → no_transition ───────────────────────
    await run('post_expiry_reconciliation_no_transition', async () => {
      const deps = reconcileDeps([{ provider: 'razorpay', ref: 'order_soak_8', state: 'expired' }]);
      const payload = razorpayCaptured('order_soak_8', 'evt_soak_8');
      const r = await reconcileSettlementWebhook({ provider: 'razorpay', payload }, deps);
      assert(
        r.ok && r.status === 'no_transition',
        `post-expiry reconcile expected no_transition — got ${JSON.stringify(r)}`,
      );
    });
  } finally {
    for (const p of Object.keys(ENV_NAME) as SupportedProvider[]) {
      if (savedEnv[ENV_NAME[p]] === undefined) delete process.env[ENV_NAME[p]];
      else process.env[ENV_NAME[p]] = savedEnv[ENV_NAME[p]];
    }
    if (savedSaltIdx === undefined) delete process.env.SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE;
    else process.env.SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE = savedSaltIdx;
  }

  const failed = scenarios.filter((s) => !s.ok).length;
  return { ok: failed === 0, passed: scenarios.length - failed, failed, scenarios };
}
