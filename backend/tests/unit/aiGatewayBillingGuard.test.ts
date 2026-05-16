/**
 * aiGatewayBillingGuard — unit tests
 *
 * Covers:
 *   - In shadow mode (default), a call without a credit handle is allowed
 *     and emits an anomaly + counter increment.
 *   - With BILLING_REQUIRE_AI_HANDLE=true, the same call is blocked.
 *   - A call with a credit handle is always allowed regardless of flag.
 *   - An allowlist entry in credit_untracked_actions short-circuits to allowed.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  checkAiBillingGuard,
  isAiBillingEnforced,
  invalidateAllowlistCache,
} from '../../services/billing/aiGatewayBillingGuard';
import {
  _resetBillingMetricsForTests,
  getCounter,
} from '../../services/billing/billingMetrics';

type AnyMock = jest.Mock;

function stubAllowlist(rows: Array<{ action_key: string; expires_at: string | null }>) {
  (supabase.from as AnyMock).mockReturnValue({
    select: jest.fn().mockResolvedValue({ data: rows, error: null }),
  });
}

describe('aiGatewayBillingGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAllowlistCache();
    _resetBillingMetricsForTests();
    delete process.env.BILLING_REQUIRE_AI_HANDLE;
  });

  it('allows when a credit handle is present (shadow mode)', async () => {
    stubAllowlist([]);
    const r = await checkAiBillingGuard({
      operation: 'refineVariant',
      creditHandle: {
        operationId: 'op',
        idempotencyKey: 'k',
        orgId: 'o',
        action: 'content_rewrite',
        source: 'http',
      },
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('has_handle');
  });

  it('allows in shadow mode without a handle but emits anomaly + bumps counter', async () => {
    stubAllowlist([]);
    const r = await checkAiBillingGuard({ operation: 'refineVariant' });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('shadow_mode');
    expect(getCounter('untracked_ai_call_blocked_total')).toBe(1);
  });

  it('blocks when flag enforced and no handle and not allowlisted', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    stubAllowlist([]);
    const r = await checkAiBillingGuard({ operation: 'refineVariant' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('enforced_block');
  });

  it('allows when operation is on the allowlist (even when enforced)', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    stubAllowlist([{ action_key: 'refineVariant', expires_at: null }]);
    const r = await checkAiBillingGuard({ operation: 'refineVariant' });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('allowlisted');
  });

  it('rejects expired allowlist entries', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    stubAllowlist([{ action_key: 'refineVariant', expires_at: '2020-01-01T00:00:00Z' }]);
    const r = await checkAiBillingGuard({ operation: 'refineVariant' });
    expect(r.allowed).toBe(false);
  });

  it('isAiBillingEnforced reads the env flag', () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    expect(isAiBillingEnforced()).toBe(true);
    process.env.BILLING_REQUIRE_AI_HANDLE = 'false';
    expect(isAiBillingEnforced()).toBe(false);
  });
});
