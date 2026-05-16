jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(),
}));

import {
  isBillingFlagEnabled,
  BILLING_FLAGS,
  evaluateAllBillingFlags,
} from '../../services/billing/billingFeatureFlags';

type AnyMock = jest.Mock;

describe('billingFeatureFlags', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns enabled=true when underlying eval enables the flag', async () => {
    const { evaluateFeatureFlag } = jest.requireMock('../../services/featureFlagService') as { evaluateFeatureFlag: AnyMock };
    evaluateFeatureFlag.mockResolvedValueOnce({ enabled: true, reason: 'flag_enabled' });
    const r = await isBillingFlagEnabled({ organizationId: 'o', flag: BILLING_FLAGS.AI_ENFORCED });
    expect(r.enabled).toBe(true);
  });

  it('fails closed on evaluator throw', async () => {
    const { evaluateFeatureFlag } = jest.requireMock('../../services/featureFlagService') as { evaluateFeatureFlag: AnyMock };
    evaluateFeatureFlag.mockRejectedValueOnce(new Error('db_down'));
    const r = await isBillingFlagEnabled({ organizationId: 'o', flag: BILLING_FLAGS.ORCHESTRATOR_ENFORCED });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('eval_error_fail_closed');
  });

  it('evaluateAllBillingFlags returns an entry per known flag', async () => {
    const { evaluateFeatureFlag } = jest.requireMock('../../services/featureFlagService') as { evaluateFeatureFlag: AnyMock };
    evaluateFeatureFlag.mockResolvedValue({ enabled: false, reason: 'flag_disabled' });
    const { BILLING_FLAGS } = await import('../../services/billing/billingFeatureFlags');
    const all = await evaluateAllBillingFlags('o');
    const keys = Object.keys(all);
    expect(keys.length).toBe(Object.keys(BILLING_FLAGS).length);
  });
});
