/**
 * settlementSandboxSoak — deterministic sandbox-verification soak coverage.
 *
 * Drives the soak foundation and asserts every scenario passes: per-provider
 * verified sandbox webhooks, stale-timestamp rejection, replayed-webhook
 * duplicate suppression, expiry-sweep idempotency, post-expiry reconciliation
 * no_transition — plus determinism and hidden-pricing preservation.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import { runSettlementSandboxSoak } from '../../services/billing/payments/settlementSandboxSoak';

const EXPECTED_SCENARIOS = [
  'razorpay_verified_sandbox_webhook',
  'stripe_verified_sandbox_webhook',
  'cashfree_verified_sandbox_webhook',
  'phonepe_verified_sandbox_webhook',
  'stale_timestamp_rejection',
  'replayed_webhook_duplicate_suppression',
  'expiry_sweep_idempotency',
  'post_expiry_reconciliation_no_transition',
];

describe('settlement sandbox soak — full scenario suite', () => {
  test('every soak scenario passes', async () => {
    const report = await runSettlementSandboxSoak();
    const failures = report.scenarios.filter((s) => !s.ok);
    // Surface the failing scenario detail if any scenario regressed.
    expect(failures.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(EXPECTED_SCENARIOS.length);
  });

  test('all required scenarios are present', async () => {
    const report = await runSettlementSandboxSoak();
    expect(report.scenarios.map((s) => s.name).sort()).toEqual([...EXPECTED_SCENARIOS].sort());
  });

  test('the four provider verification scenarios pass', async () => {
    const report = await runSettlementSandboxSoak();
    for (const name of EXPECTED_SCENARIOS.filter((n) => n.endsWith('_verified_sandbox_webhook'))) {
      expect(report.scenarios.find((s) => s.name === name)?.ok).toBe(true);
    }
  });

  test('the stale-webhook rejection scenario passes', async () => {
    const report = await runSettlementSandboxSoak();
    expect(report.scenarios.find((s) => s.name === 'stale_timestamp_rejection')?.ok).toBe(true);
  });

  test('the replay-suppression + expiry-idempotency scenarios pass', async () => {
    const report = await runSettlementSandboxSoak();
    expect(report.scenarios.find((s) => s.name === 'replayed_webhook_duplicate_suppression')?.ok).toBe(true);
    expect(report.scenarios.find((s) => s.name === 'expiry_sweep_idempotency')?.ok).toBe(true);
  });

  test('the post-expiry no_transition scenario passes', async () => {
    const report = await runSettlementSandboxSoak();
    expect(report.scenarios.find((s) => s.name === 'post_expiry_reconciliation_no_transition')?.ok).toBe(true);
  });
});

describe('settlement sandbox soak — determinism', () => {
  test('repeated runs produce an identical report', async () => {
    const a = await runSettlementSandboxSoak();
    const b = await runSettlementSandboxSoak();
    expect(b).toEqual(a);
  });

  test('the soak restores process.env (no sandbox secret leakage)', async () => {
    delete process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY;
    await runSettlementSandboxSoak();
    expect(process.env.SETTLEMENT_WEBHOOK_SANDBOX_SECRET_RAZORPAY).toBeUndefined();
  });
});

describe('settlement sandbox soak — hidden-pricing preservation', () => {
  test('the soak report carries no pricing fields', async () => {
    const report = await runSettlementSandboxSoak();
    const serialized = JSON.stringify(report).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
