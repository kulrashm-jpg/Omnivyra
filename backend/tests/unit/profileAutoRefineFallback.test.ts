/**
 * getProfile's staleness auto-refine is background work for a READ (e9, 2026-11-13):
 *   - a refine failure must never fail the caller's request: serve the unrefined profile, log + count it;
 *   - the refine's provider usage runs INSIDE the caller's usage scope, so a billed caller (wirePhase2Route ->
 *     credit engine scope) sees it as its own consumption rather than free side work.
 */
const mockRefine = jest.fn();
const mockWarn = jest.fn();
const STALE_PROFILE = { company_id: 'co-1', name: 'Acme', last_refined_at: null, recommendation_context: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.single = async () => ({ data: { ...STALE_PROFILE }, error: null });
    return chain;
  },
}));
jest.mock('../../../lib/platform/rollout', () => ({
  defineRolloutFlag: (def: unknown) => def,
  resolveRolloutSync: () => ({ mode: 'off' }), // cache flag OFF -> autoRefine defaults ON (the risky default)
}));
jest.mock('../../services/logger', () => ({
  logger: { warn: (...a: unknown[]) => mockWarn(...a), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/companyProfileServiceRest1Rest2Competitors', () => ({
  refineProfileWithAI: (...a: unknown[]) => mockRefine(...a),
  refineProfileForPrompts: async (p: unknown) => p,
  sanitizeStoredCompetitorsForRead: (p: unknown) => p,
  revalidateStoredCompetitorsForProfileRead: async (p: unknown) => p,
}));

import { getProfile, getProfileAutoRefineFailureCount } from '../../services/companyProfileServiceRest1Rest2Pulse';
import { createUsageScope, recordProviderUsage } from '../../services/aiUsageCollector';

beforeEach(() => {
  mockRefine.mockReset();
  mockWarn.mockReset();
});

describe('getProfile auto-refine fallback', () => {
  it('a refine that THROWS serves the unrefined profile, logs and counts it (request not failed)', async () => {
    mockRefine.mockRejectedValue(new Error('provider 503'));
    const before = getProfileAutoRefineFailureCount();
    const profile = await getProfile('co-1');
    expect(mockRefine).toHaveBeenCalledTimes(1); // positive control: the refine really ran
    expect(profile).toMatchObject({ company_id: 'co-1', name: 'Acme' });
    expect(getProfileAutoRefineFailureCount()).toBe(before + 1);
    expect(mockWarn).toHaveBeenCalledWith('profile_auto_refine_failed', expect.objectContaining({
      companyId: 'co-1', message: 'provider 503',
    }));
  });

  it('a refine that succeeds is returned and nothing is counted', async () => {
    mockRefine.mockResolvedValue({ ...STALE_PROFILE, name: 'Acme (refined)' });
    const before = getProfileAutoRefineFailureCount();
    const profile = await getProfile('co-1');
    expect(profile).toMatchObject({ name: 'Acme (refined)' });
    expect(getProfileAutoRefineFailureCount()).toBe(before);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('autoRefine:false never refines (the route-level read in recommendations/generate)', async () => {
    await getProfile('co-1', { autoRefine: false });
    expect(mockRefine).not.toHaveBeenCalled();
  });
});

describe('the refine is inside the caller\'s billed usage scope', () => {
  it('provider usage recorded by the refine is collected by the enclosing scope', async () => {
    mockRefine.mockImplementation(async (p: object) => {
      recordProviderUsage(1200, 300); // what aiGateway records for the refine's completion
      return { ...p, name: 'Acme (refined)' };
    });
    const scope = createUsageScope();
    await scope.run(() => getProfile('co-1'));
    expect(scope.usage.inputTokens).toBe(1200);
    expect(scope.usage.outputTokens).toBe(300);
  });

  it('usage recorded before a refine FAILS is still collected (the attempt is not free)', async () => {
    mockRefine.mockImplementation(async () => {
      recordProviderUsage(800, 0);
      throw new Error('parse failure after the completion');
    });
    const scope = createUsageScope();
    const profile = await scope.run(() => getProfile('co-1'));
    expect(profile).toMatchObject({ name: 'Acme' });
    expect(scope.usage.inputTokens).toBe(800);
  });
});
