/**
 * STEP 3AH-91 integration — SEC91-B13: the Razorpay webhook secret no longer
 * falls back to the API key secret.
 *
 * Razorpay signs webhooks with the separate secret configured in its dashboard.
 * `getProviderCredentials` returned `process.env[webhook] ?? process.env[keySecret]`
 * for every provider, so with the Razorpay webhook variable unset the webhook
 * check validated against the API key secret. Now: Razorpay — the webhook
 * variable only (unset ⇒ every webhook rejected); Cashfree — fallback kept,
 * because Cashfree signs webhooks with the client secret by design.
 * All values are fake fixtures.
 */
import crypto from 'crypto';
import { getProviderCredentials } from '../../services/payments/orchestrator/providerConfig';
import { RazorpayAdapter } from '../../services/payments/orchestrator/razorpayAdapter';

const KEYS = ['PAYMENT_PROVIDER_MODE', 'RAZORPAY_TEST_KEY_ID', 'RAZORPAY_TEST_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_LIVE_KEY_ID', 'RAZORPAY_LIVE_KEY_SECRET', 'RAZORPAY_LIVE_WEBHOOK_SECRET',
  'CASHFREE_TEST_APP_ID', 'CASHFREE_TEST_SECRET_KEY', 'CASHFREE_WEBHOOK_SECRET'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const sign = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const BODY = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_fake' } } } });

describe('SEC91-B13 — Razorpay webhook secret is dedicated', () => {
  it('CRITICAL: webhook secret unset → no fallback to the API key secret; a delivery signed with the key secret is rejected', () => {
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_fake';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'fake-api-key-secret-b13';
    expect(getProviderCredentials('razorpay').webhookSecret).toBeUndefined();
    const adapter = new RazorpayAdapter();
    expect(adapter.verifyWebhookSignature(BODY, sign('fake-api-key-secret-b13', BODY))).toBe(false);
  });

  it('LEGITIMATE: the dedicated webhook secret verifies; the API key secret does not', () => {
    process.env.RAZORPAY_TEST_KEY_SECRET = 'fake-api-key-secret-b13';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'fake-webhook-secret-b13';
    const adapter = new RazorpayAdapter();
    expect(adapter.verifyWebhookSignature(BODY, sign('fake-webhook-secret-b13', BODY))).toBe(true);
    expect(adapter.verifyWebhookSignature(BODY, sign('fake-api-key-secret-b13', BODY))).toBe(false);
  });

  it('live mode: same rule (RAZORPAY_LIVE_WEBHOOK_SECRET required, no fallback)', () => {
    process.env.RAZORPAY_LIVE_KEY_SECRET = 'fake-live-key-secret-b13';
    expect(getProviderCredentials('razorpay', 'live').webhookSecret).toBeUndefined();
    process.env.RAZORPAY_LIVE_WEBHOOK_SECRET = 'fake-live-webhook-secret-b13';
    expect(getProviderCredentials('razorpay', 'live').webhookSecret).toBe('fake-live-webhook-secret-b13');
  });

  it('Cashfree keeps its by-design fallback to the client secret', () => {
    process.env.CASHFREE_TEST_SECRET_KEY = 'fake-cashfree-client-secret';
    expect(getProviderCredentials('cashfree').webhookSecret).toBe('fake-cashfree-client-secret');
    process.env.CASHFREE_WEBHOOK_SECRET = 'fake-cashfree-webhook-secret';
    expect(getProviderCredentials('cashfree').webhookSecret).toBe('fake-cashfree-webhook-secret');
  });

  it('key id / key secret resolution is unchanged', () => {
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_fake';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'fake-api-key-secret-b13';
    expect(getProviderCredentials('razorpay')).toEqual(expect.objectContaining({ keyId: 'rzp_test_fake', keySecret: 'fake-api-key-secret-b13' }));
  });
});
