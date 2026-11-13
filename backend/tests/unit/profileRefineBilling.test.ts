/**
 * e9 2026-11-13 (BLOCKING at the flip): the company-profile AI refine is ONE billed unit ('profile_refine').
 * The auto refine inside getProfile (every stale read, incl. onboarding's eager refine) is billed at one point and a
 * read NEVER fails because of billing; the manual refine route goes through wirePhase2Route.
 */
const ledger = new Map<string, 'settled' | 'released'>();
let charges = 0;
const mockEngine = {
  makeIdempotencyKey: jest.fn((u: string, a: string, r: string) => `${u}|${a}|${r}`),
  executeWithEntryConsumption: jest.fn(async (opts: any) => {
    const st = ledger.get(opts.idempotencyKey);
    if (st === 'settled') return { status: 'already_settled' };
    if (st === 'released') return { status: 'already_released' };
    try {
      const result = await opts.executor();
      ledger.set(opts.idempotencyKey, 'settled'); charges++;
      return { status: 'executed', result, settlement: {} };
    } catch (e) { ledger.set(opts.idempotencyKey, 'released'); throw e; }
  }),
};
jest.mock('../../services/creditExecutionService', () => mockEngine);
let mockMode = 'enforce';
jest.mock('../../services/billing/creditEconomyActivation', () => ({ getCreditEconomyExecutionMode: jest.fn(async () => mockMode) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { runAutoRefineBilled, profileRefineIdentity, PROFILE_REFINE_UNIT_CALLS } from '../../services/billing/profileRefineBilling';
import { resolveActivityEconomics } from '../../services/activityEconomyCatalog';
import { resolveMonetizationFeature } from '../../../shared/monetization/featureRegistry';

const BASE = { companyId: 'c-1', lastRefinedAt: '2026-11-01T00:00:00Z' };
const key = (slot = 0) => `c-1|profile_refine|${profileRefineIdentity('c-1', BASE.lastRefinedAt)}${slot ? `:r${slot}` : ''}`;

beforeEach(() => { ledger.clear(); charges = 0; mockMode = 'enforce'; mockEngine.executeWithEntryConsumption.mockClear(); });

it('not enforced: the refine runs exactly as before - no engine call', async () => {
  mockMode = 'off';
  const refine = jest.fn(async () => ({ p: 1 }));
  expect(await runAutoRefineBilled({ ...BASE, refine })).toEqual({ p: 1 });
  expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
});

it('enforced: ONE token-metered profile_refine unit per company per staleness window, hold sized for the unit', async () => {
  const refine = jest.fn(async () => ({ p: 2 }));
  expect(await runAutoRefineBilled({ ...BASE, refine })).toEqual({ p: 2 });
  expect(mockEngine.executeWithEntryConsumption.mock.calls[0][0]).toMatchObject({
    orgId: 'c-1', action: 'profile_refine', referenceType: 'profile_refine', collectViaCollector: true,
    referenceId: 'profile_refine:auto:c-1:2026-11-01T00:00:00Z',
    llmPricing: { actionKey: 'profile_refine', maxInputTokens: 8000 * PROFILE_REFINE_UNIT_CALLS, maxOutputTokens: 1500 * PROFILE_REFINE_UNIT_CALLS },
  });
  expect(charges).toBe(1);
});

it('a concurrent stale read of the SAME window (already charged) SKIPS the refine: null, no re-run, no second charge', async () => {
  ledger.set(key(), 'settled');
  const refine = jest.fn();
  expect(await runAutoRefineBilled({ ...BASE, refine })).toBeNull();
  expect(refine).not.toHaveBeenCalled();
});

it.each([
  [{ status: 'insufficient_credits', available: 0, required: 9 }],
  [{ status: 'no_credit_account' }],
  [{ status: 'org_control_blocked', code: 'ORG_BLOCKED', reason: 'x' }],
])('a refusal %j SKIPS the refine (null) - the read never fails because of billing', async (res) => {
  mockEngine.executeWithEntryConsumption.mockResolvedValueOnce(res as any);
  const refine = jest.fn();
  expect(await runAutoRefineBilled({ ...BASE, refine })).toBeNull();
  expect(refine).not.toHaveBeenCalled();
});

it('a failed refine throws as before (exposure released); the next read reclaims the next slot and is charged once', async () => {
  const refine = jest.fn().mockRejectedValueOnce(new Error('llm down')).mockResolvedValueOnce({ p: 3 });
  await expect(runAutoRefineBilled({ ...BASE, refine })).rejects.toThrow('llm down');
  expect(await runAutoRefineBilled({ ...BASE, refine })).toEqual({ p: 3 });
  expect(mockEngine.executeWithEntryConsumption.mock.calls.at(-1)![0].referenceId).toMatch(/:r1$/);
  expect(charges).toBe(1);
});

it('a NEW staleness window (a newer last_refined_at) is a new unit', async () => {
  await runAutoRefineBilled({ ...BASE, refine: async () => 1 });
  await runAutoRefineBilled({ ...BASE, lastRefinedAt: '2026-11-08T00:00:00Z', refine: async () => 2 });
  expect(charges).toBe(2);
});

it('profile_refine is a registered, chargeable action (engine registries): catalog class + monetization feature', () => {
  expect(resolveActivityEconomics('profile_refine').activityClass).toBe('LONG_GENERATION');
  expect(resolveMonetizationFeature({ action_key: 'profile_refine' })).toMatchObject({
    feature_key: 'intelligence.profile_refine', action_key: 'profile_refine', pricing_key: 'profile_refine',
  });
});
