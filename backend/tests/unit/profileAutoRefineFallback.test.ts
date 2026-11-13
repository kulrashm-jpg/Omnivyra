/**
 * getProfile's staleness auto-refine is background work for a READ (e9, 2026-11-13):
 *   - a refine failure must never fail the caller's request: serve the unrefined profile, log + count it;
 *   - the refine's provider usage runs INSIDE the caller's usage scope, so a billed caller (wirePhase2Route ->
 *     credit engine scope) sees it as its own consumption rather than free side work.
 */
const mockRefine = jest.fn();
const mockWarn = jest.fn();
let mockFlagMode = 'off';
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
  resolveRolloutSync: () => ({ mode: mockFlagMode }), // the old default refined when this was 'off'
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
    const profile = await getProfile('co-1', { autoRefine: true });
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
    const profile = await getProfile('co-1', { autoRefine: true });
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
    await scope.run(() => getProfile('co-1', { autoRefine: true }));
    expect(scope.usage.inputTokens).toBe(1200);
    expect(scope.usage.outputTokens).toBe(300);
  });

  it('usage recorded before a refine FAILS is still collected (the attempt is not free)', async () => {
    mockRefine.mockImplementation(async () => {
      recordProviderUsage(800, 0);
      throw new Error('parse failure after the completion');
    });
    const scope = createUsageScope();
    const profile = await scope.run(() => getProfile('co-1', { autoRefine: true }));
    expect(profile).toMatchObject({ name: 'Acme' });
    expect(scope.usage.inputTokens).toBe(800);
  });
});

describe('autoRefine is OPT-IN regardless of the profile-cache flag (e9 2026-11-13)', () => {
  afterEach(() => { mockFlagMode = 'off'; });
  it.each(['off', 'on'])('flag %s: a read with NO autoRefine option never refines (stale profile)', async (mode) => {
    mockFlagMode = mode;
    const profile = await getProfile('co-1');
    expect(profile).toMatchObject({ company_id: 'co-1' }); // positive control: the stale row was read
    expect(mockRefine).not.toHaveBeenCalled();
  });
  it('flag off: autoRefine:true still refines a stale profile', async () => {
    mockRefine.mockResolvedValue({ ...STALE_PROFILE, name: 'Acme (refined)' });
    await getProfile('co-1', { autoRefine: true });
    expect(mockRefine).toHaveBeenCalledTimes(1);
  });
});

describe('who may opt in (static pin): every autoRefine:true caller is reviewed', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const root = require('path').resolve(__dirname, '../../..') as string;
  const hits = execFileSync('git', ['grep', '-n', '-E', 'autoRefine:[[:space:]]*(true|useEnrichment)', '--', 'backend', 'pages', 'lib',
    ':!backend/tests', ':!**/*.md'], { cwd: root, encoding: 'utf8' }).trim().split('\n').map((l) => l.split(':')[0]);
  it('only the reviewed callers opt in', () => {
    expect([...new Set(hits)].sort()).toEqual([
      'backend/services/recommendationEngine/engine.ts', // inside the recommendations_generate billed unit
      'pages/api/onboarding/setup-company.ts',            // eager onboarding scoring - pricing pending (e1, pricing hold)
    ]);
  });
});

describe('Report 2 refresh: refine only inside the priced report scope (e9 2026-11-13)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runWithProfileRefineOptIn, isProfileRefineOptedIn } = require('../../services/profileRefineScope');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsx = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const root = require('path').resolve(__dirname, '../../..') as string;
  const src = (rel: string) => fsx.readFileSync(require('path').join(root, rel), 'utf8') as string;
  const SCOPED_READERS = ['backend/services/competitiveDatasetBootstrapService.ts', 'backend/services/competitorDiscoveryEngineService.ts'];

  it('PRICED side: a scoped reader refines a stale profile inside runWithProfileRefineOptIn', async () => {
    mockRefine.mockResolvedValue({ ...STALE_PROFILE, name: 'Acme (refined)' });
    const p = await runWithProfileRefineOptIn(() => getProfile('co-1', { autoRefine: isProfileRefineOptedIn() }));
    expect(mockRefine).toHaveBeenCalledTimes(1);
    expect(p).toMatchObject({ name: 'Acme (refined)' });
  });
  it('UNPRICED side: the same read outside the scope never refines', async () => {
    await getProfile('co-1', { autoRefine: isProfileRefineOptedIn() });
    expect(mockRefine).not.toHaveBeenCalled();
  });
  it.each(SCOPED_READERS)('%s reads the scope (and nothing else opts it in)', (rel) => {
    const s = src(rel);
    expect(s).toMatch(/getProfile\(params\.companyId, \{ autoRefine: isProfileRefineOptedIn\(\) \}\)/);
    expect(s).not.toMatch(/runWithProfileRefineOptIn/);
  });
  it('only the priced report-card pipeline opens the scope, around the performance compose', () => {
    const openers = execFileSync('git', ['grep', '-l', 'runWithProfileRefineOptIn(', '--', 'backend', 'pages', 'lib',
      ':!backend/tests', ':!backend/services/profileRefineScope.ts'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    expect(openers).toEqual(['backend/services/reportCardServiceAssembly.ts']);
    expect(src('backend/services/reportCardServiceAssembly.ts'))
      .toMatch(/runWithProfileRefineOptIn\(\(\) => composePerformanceIntelligenceReport\(/);
  });
});
