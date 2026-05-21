/**
 * paymentWebhookVerifier — provider-specific SANDBOX signature verification.
 *
 * Covers per-provider verification (Razorpay HMAC / Stripe t+v1 / Cashfree /
 * PhonePe X-VERIFY), replay-window rejection, stale-signature rejection,
 * malformed/missing-signature handling, and the unverified-sandbox foundation
 * posture. Pure crypto — no DB, no network.
 */

import crypto from 'crypto';
import { verifyProviderWebhookSignature } from '../../services/billing/payments/paymentWebhookVerifier';

// Deterministic clock: nowMs = NOW_MS, Stripe t = NOW_SEC.
const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

const SECRET_ENV = [
  'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY',
  'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE',
  'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE',
  'SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE',
  'SETTLEMENT_WEBHOOK_SANDBOX_SALT_INDEX_PHONEPE',
  'SETTLEMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS',
];
const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const k of SECRET_ENV) delete process.env[k];
});
afterAll(() => { process.env = ORIGINAL_ENV; });

// ── helpers that produce a VALID signature for each provider ────────────────
function razorpaySig(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
function stripeHeader(body: string, secret: string, t: number): string {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}
function cashfreeSig(body: string, secret: string, ts: string): string {
  return crypto.createHmac('sha256', secret).update(`${ts}${body}`).digest('base64');
}
function phonepeXVerify(body: string, saltKey: string, saltIndex = '1'): string {
  const base64 = Buffer.from(body, 'utf8').toString('base64');
  const hash = crypto.createHash('sha256').update(base64 + saltKey).digest('hex');
  return `${hash}###${saltIndex}`;
}

describe('webhook verifier — Razorpay', () => {
  const SECRET = 'rzp_sbx_secret';
  const BODY = '{"event":"payment.captured"}';
  beforeEach(() => { process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY = SECRET; });

  test('a correct HMAC-SHA256 signature → verified', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'razorpay', rawBody: BODY,
      headers: { 'x-razorpay-signature': razorpaySig(BODY, SECRET) },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('verified');
  });
  test('a wrong signature → signature_mismatch', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'razorpay', rawBody: BODY, headers: { 'x-razorpay-signature': 'deadbeef'.repeat(8) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });
  test('a tampered body invalidates the signature', () => {
    const sig = razorpaySig(BODY, SECRET);
    const r = verifyProviderWebhookSignature({
      provider: 'razorpay', rawBody: BODY + ' ', headers: { 'x-razorpay-signature': sig },
    });
    expect(r.ok).toBe(false);
  });
  test('a missing signature header → missing_signature', () => {
    const r = verifyProviderWebhookSignature({ provider: 'razorpay', rawBody: BODY, headers: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_signature');
  });
});

describe('webhook verifier — Stripe', () => {
  const SECRET = 'whsec_sbx';
  const BODY = '{"id":"evt_1","type":"payment_intent.succeeded"}';
  beforeEach(() => { process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE = SECRET; });

  test('a correct t+v1 signature within the replay window → verified', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'stripe', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'stripe-signature': stripeHeader(BODY, SECRET, NOW_SEC) },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('verified');
  });
  test('a wrong v1 signature → signature_mismatch', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'stripe', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'stripe-signature': `t=${NOW_SEC},v1=${'0'.repeat(64)}` },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });
  test('a signature header missing t or v1 → malformed_signature', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'stripe', rawBody: BODY, nowMs: NOW_MS, headers: { 'stripe-signature': 'v1=abc' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_signature');
  });
  test('a missing signature header → missing_signature', () => {
    const r = verifyProviderWebhookSignature({ provider: 'stripe', rawBody: BODY, nowMs: NOW_MS, headers: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_signature');
  });
});

describe('webhook verifier — Cashfree', () => {
  const SECRET = 'cf_sbx_secret';
  const BODY = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const TS = String(NOW_MS);
  beforeEach(() => { process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE = SECRET; });

  test('a correct base64 HMAC over timestamp+body → verified', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'cashfree', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'x-webhook-signature': cashfreeSig(BODY, SECRET, TS), 'x-webhook-timestamp': TS },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('verified');
  });
  test('a wrong signature → signature_mismatch', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'cashfree', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'x-webhook-signature': 'bm90LXZhbGlk', 'x-webhook-timestamp': TS },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });
  test('the timestamp is part of the canonical payload (wrong ts → mismatch)', () => {
    const sig = cashfreeSig(BODY, SECRET, TS);
    const r = verifyProviderWebhookSignature({
      provider: 'cashfree', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'x-webhook-signature': sig, 'x-webhook-timestamp': String(NOW_MS + 1000) },
    });
    expect(r.ok).toBe(false);
  });
  test('a missing signature header → missing_signature', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'cashfree', rawBody: BODY, nowMs: NOW_MS, headers: { 'x-webhook-timestamp': TS },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_signature');
  });
});

describe('webhook verifier — PhonePe', () => {
  const SALT = 'pp_sbx_salt';
  const BODY = '{"code":"PAYMENT_SUCCESS"}';
  beforeEach(() => { process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_PHONEPE = SALT; });

  test('a correct X-VERIFY (sha256(base64+salt)###index) → verified', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'phonepe', rawBody: BODY, headers: { 'x-verify': phonepeXVerify(BODY, SALT) },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('verified');
  });
  test('a wrong hash → signature_mismatch', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'phonepe', rawBody: BODY, headers: { 'x-verify': `${'a'.repeat(64)}###1` },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });
  test('an X-VERIFY with no hash part → malformed_signature', () => {
    const r = verifyProviderWebhookSignature({
      provider: 'phonepe', rawBody: BODY, headers: { 'x-verify': '###1' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed_signature');
  });
  test('a missing X-VERIFY header → missing_signature', () => {
    const r = verifyProviderWebhookSignature({ provider: 'phonepe', rawBody: BODY, headers: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_signature');
  });
});

describe('webhook verifier — replay-window / stale-signature rejection', () => {
  test('Stripe: a timestamp outside the replay window → stale_timestamp', () => {
    const SECRET = 'whsec_sbx';
    process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE = SECRET;
    const BODY = '{"id":"evt_old"}';
    const staleT = NOW_SEC - 10_000; // 10 000s old, default tolerance 300s
    const r = verifyProviderWebhookSignature({
      provider: 'stripe', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'stripe-signature': stripeHeader(BODY, SECRET, staleT) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_timestamp');
  });

  test('Stripe: a fresh timestamp just inside the window → verified', () => {
    const SECRET = 'whsec_sbx';
    process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE = SECRET;
    const BODY = '{"id":"evt_fresh"}';
    const t = NOW_SEC - 120; // 2 min — inside the 300s window
    const r = verifyProviderWebhookSignature({
      provider: 'stripe', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'stripe-signature': stripeHeader(BODY, SECRET, t) },
    });
    expect(r.ok).toBe(true);
  });

  test('Cashfree: a stale x-webhook-timestamp → stale_timestamp', () => {
    const SECRET = 'cf_sbx_secret';
    process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_CASHFREE = SECRET;
    const BODY = '{"type":"X"}';
    const staleTs = String(NOW_MS - 10 * 60_000); // 10 min old
    const r = verifyProviderWebhookSignature({
      provider: 'cashfree', rawBody: BODY, nowMs: NOW_MS,
      headers: { 'x-webhook-signature': cashfreeSig(BODY, SECRET, staleTs), 'x-webhook-timestamp': staleTs },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_timestamp');
  });

  test('the replay tolerance is configurable (a wide window accepts an old signature)', () => {
    const SECRET = 'whsec_sbx';
    process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_STRIPE = SECRET;
    const BODY = '{"id":"evt_wide"}';
    const t = NOW_SEC - 10_000;
    const r = verifyProviderWebhookSignature({
      provider: 'stripe', rawBody: BODY, nowMs: NOW_MS, replayToleranceSeconds: 20_000,
      headers: { 'stripe-signature': stripeHeader(BODY, SECRET, t) },
    });
    expect(r.ok).toBe(true);
  });
});

describe('webhook verifier — unverified-sandbox foundation posture', () => {
  test.each(['razorpay', 'stripe', 'cashfree', 'phonepe'] as const)(
    '%s with NO sandbox secret configured → accepted unverified_sandbox',
    (provider) => {
      const r = verifyProviderWebhookSignature({ provider, rawBody: '{}', headers: {}, nowMs: NOW_MS });
      expect(r.ok).toBe(true);
      expect(r.mode).toBe('unverified_sandbox');
    },
  );
});
