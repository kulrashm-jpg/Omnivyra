/**
 * P1 (Truth & Safety) — M2/M3 mode authority.
 *
 * The defect these lock down: `create-order` stamped `provider_mode: 'test'` as
 * a literal and the Cashfree SDK was pinned to `'sandbox'` in the browser. Both
 * would have survived a flip to live mode, so real charges would have been
 * recorded as test data and the checkout SDK would have disagreed with the
 * order it was rendering.
 *
 * Covers matrix TEST 10 (mode correctness) plus the fail-safe contract on
 * authoritative provider lookups.
 */

import fs from 'fs';
import path from 'path';

const ORIGINAL_ENV = { ...process.env };

function reloadOrchestrator() {
  let mod: typeof import('../../services/payments/orchestrator/providerConfig');
  jest.isolateModules(() => {
    mod = require('../../services/payments/orchestrator/providerConfig');
  });
  return mod!;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ═══════════════════════════════════════════════════════════════════════════
describe('TEST 10 — getActiveMode is the single mode authority', () => {
  it('defaults to test when PAYMENT_PROVIDER_MODE is unset', () => {
    delete process.env.PAYMENT_PROVIDER_MODE;
    expect(reloadOrchestrator().getActiveMode()).toBe('test');
  });

  it('resolves test when explicitly test', () => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    expect(reloadOrchestrator().getActiveMode()).toBe('test');
  });

  it('resolves live only on an exact "live" opt-in', () => {
    process.env.PAYMENT_PROVIDER_MODE = 'live';
    expect(reloadOrchestrator().getActiveMode()).toBe('live');
  });

  it('does not fall into live on a near-miss value', () => {
    for (const v of ['LIVE', 'production', 'prod', 'live ', '1', 'true']) {
      process.env.PAYMENT_PROVIDER_MODE = v;
      expect(reloadOrchestrator().getActiveMode()).toBe('test');
    }
  });
});

describe('TEST 10 — credentials follow the active mode, so row and request agree', () => {
  it('reads TEST credentials in test mode', () => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_aaa';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'secret_test';
    process.env.RAZORPAY_LIVE_KEY_ID = 'rzp_live_bbb';
    process.env.RAZORPAY_LIVE_KEY_SECRET = 'secret_live';

    const { getActiveMode, getProviderCredentials } = reloadOrchestrator();
    expect(getActiveMode()).toBe('test');
    expect(getProviderCredentials('razorpay').keyId).toBe('rzp_test_aaa');
  });

  it('reads LIVE credentials in live mode', () => {
    process.env.PAYMENT_PROVIDER_MODE = 'live';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_aaa';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'secret_test';
    process.env.RAZORPAY_LIVE_KEY_ID = 'rzp_live_bbb';
    process.env.RAZORPAY_LIVE_KEY_SECRET = 'secret_live';

    const { getActiveMode, getProviderCredentials } = reloadOrchestrator();
    expect(getActiveMode()).toBe('live');
    expect(getProviderCredentials('razorpay').keyId).toBe('rzp_live_bbb');
  });

  it('reports a provider unconfigured when the ACTIVE mode has no keys', () => {
    process.env.PAYMENT_PROVIDER_MODE = 'live';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_aaa';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'secret_test';
    delete process.env.RAZORPAY_LIVE_KEY_ID;
    delete process.env.RAZORPAY_LIVE_KEY_SECRET;

    // Test keys must NOT satisfy live mode — otherwise a live deploy would
    // silently transact against the sandbox.
    expect(reloadOrchestrator().isProviderConfigured('razorpay')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('M2 — no hardcoded provider_mode survives in the order path', () => {
  const createOrderSrc = fs.readFileSync(
    path.join(process.cwd(), 'pages/api/billing/checkout/create-order.ts'), 'utf8',
  );

  it('writes provider_mode from getActiveMode(), not a literal', () => {
    expect(createOrderSrc).toMatch(/provider_mode:\s*providerMode/);
    expect(createOrderSrc).toMatch(/const\s+providerMode\s*=\s*getActiveMode\(\)/);
    expect(createOrderSrc).not.toMatch(/provider_mode:\s*['"]test['"]/);
    expect(createOrderSrc).not.toMatch(/provider_mode:\s*['"]live['"]/);
  });

  it('returns the resolved mode to the client so the SDK can follow it', () => {
    expect(createOrderSrc).toMatch(/provider_mode:\s*providerMode,/);
  });
});

describe('M3 — the browser takes its SDK mode from the server', () => {
  const panelSrc = fs.readFileSync(
    path.join(process.cwd(), 'components/billing/TopUpPanel.tsx'), 'utf8',
  );

  it('no longer pins the Cashfree SDK to sandbox', () => {
    expect(panelSrc).not.toMatch(/Cashfree\(\{\s*mode:\s*['"]sandbox['"]\s*\}\)/);
  });

  it('derives the SDK mode from the order response', () => {
    expect(panelSrc).toMatch(/loadCashfree\(order\.provider_mode\)/);
    expect(panelSrc).toMatch(/providerMode === 'live' \? 'production' : 'sandbox'/);
  });

  it('maps server mode to SDK mode, defaulting to sandbox for anything but live', () => {
    // Mirrors the mapping in loadCashfree — anything that is not an explicit
    // 'live' must stay sandbox, so an absent/garbled field cannot open a
    // production checkout.
    const toSdkMode = (m: string | null | undefined) => (m === 'live' ? 'production' : 'sandbox');
    expect(toSdkMode('live')).toBe('production');
    expect(toSdkMode('test')).toBe('sandbox');
    expect(toSdkMode(null)).toBe('sandbox');
    expect(toSdkMode(undefined)).toBe('sandbox');
    expect(toSdkMode('LIVE')).toBe('sandbox');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('authoritative provider lookup is fail-safe', () => {
  it('resolves unknown — never unpaid — when the provider is unconfigured', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    delete process.env.RAZORPAY_TEST_KEY_ID;
    delete process.env.RAZORPAY_TEST_KEY_SECRET;

    let outcome: any;
    await jest.isolateModulesAsync(async () => {
      const { RazorpayAdapter } = require('../../services/payments/orchestrator/razorpayAdapter');
      outcome = await new RazorpayAdapter().fetchOrderOutcome('order_x');
    });

    expect(outcome.outcome).toBe('unknown');
    expect(outcome.reason).toBe('razorpay_not_configured');
  });

  it('resolves unknown when no provider order id exists', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_aaa';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'secret_test';

    let outcome: any;
    await jest.isolateModulesAsync(async () => {
      const { RazorpayAdapter } = require('../../services/payments/orchestrator/razorpayAdapter');
      outcome = await new RazorpayAdapter().fetchOrderOutcome('');
    });

    expect(outcome.outcome).toBe('unknown');
  });

  it('resolves unknown when the provider request throws', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_aaa';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'secret_test';

    const fetchSpy = jest.spyOn(global, 'fetch' as never)
      .mockRejectedValue(new Error('ETIMEDOUT') as never);

    let outcome: any;
    await jest.isolateModulesAsync(async () => {
      const { RazorpayAdapter } = require('../../services/payments/orchestrator/razorpayAdapter');
      outcome = await new RazorpayAdapter().fetchOrderOutcome('order_x');
    });

    expect(outcome.outcome).toBe('unknown');
    expect(String(outcome.reason)).toContain('ETIMEDOUT');
    fetchSpy.mockRestore();
  });

  it('maps a non-paid Razorpay order to unpaid, and paid to paid', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_aaa';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'secret_test';

    const fetchSpy = jest.spyOn(global, 'fetch' as never);

    // attempted → a payment was tried and did NOT succeed
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'attempted' }) } as never);
    let attempted: any;
    await jest.isolateModulesAsync(async () => {
      const { RazorpayAdapter } = require('../../services/payments/orchestrator/razorpayAdapter');
      attempted = await new RazorpayAdapter().fetchOrderOutcome('order_a');
    });
    expect(attempted.outcome).toBe('unpaid');

    // paid → captured, with the payment id resolved from the payments list
    fetchSpy
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'paid' }) } as never)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'pay_ok', status: 'captured' }] }) } as never);
    let paid: any;
    await jest.isolateModulesAsync(async () => {
      const { RazorpayAdapter } = require('../../services/payments/orchestrator/razorpayAdapter');
      paid = await new RazorpayAdapter().fetchOrderOutcome('order_b');
    });
    expect(paid.outcome).toBe('paid');
    expect(paid.providerPaymentId).toBe('pay_ok');

    fetchSpy.mockRestore();
  });
});
