/**
 * SEC-91A (STEP 3AH-91) — A1: per-HTTP-method authentication gaps.
 *
 * The ROUTE-AUTH-001 gate is per FILE: a route passes when ANY branch invokes an
 * approved primitive. These routes had one branch that did and one that did not
 * (SEC-F's per-method gate R1-METHOD reports them as F1-01..F1-03):
 *
 *   F1-01 accounts/[platform]        POST  unauthenticated mock "connect", logged the OAuth `code`
 *   F1-02 track/angle-industry-matrix GET  unauthenticated read of a platform-wide aggregate
 *   F1-03 track/angle-industry-matrix POST any member of ANY company wrote the GLOBAL aggregate
 *
 * Only the database and identity provider are faked; the guard chain is real.
 */
import { seed, invoke, rows, writeCalls, CO_A } from '../helpers/routeAuthHarness';
import { bearer, USER_EXSUPER } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../services/platformIntelligenceService', () => ({
  getPlatformRules: async (p: string) => ({ platform: { canonical_key: p } }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const accountsPlatform = require('../../../pages/api/accounts/[platform]').default;
const angleMatrix = require('../../../pages/api/track/angle-industry-matrix').default;
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  seed({
    user_company_roles: [{ user_id: USER_EXSUPER, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' }],
    angle_industry_matrix: [
      { industry: 'saas', angle_type: 'analytical', post_count: 5, score_sum: 350, avg_score: 70, prior_rank: 1, prior_note: 'n' },
      { industry: 'saas', angle_type: 'contrarian', post_count: 5, score_sum: 300, avg_score: 60, prior_rank: 2, prior_note: 'n' },
    ],
  });
});

describe('F1-01 POST /api/accounts/[platform] (mock connect)', () => {
  it('unauthenticated → 401 (was 200 for anyone)', async () => {
    const r = await invoke(accountsPlatform, { method: 'POST', query: { platform: 'linkedin' }, body: { code: 'oauth-code-secret' } });
    expect(r.status).toBe(401);
  });

  it('never logs the caller-supplied OAuth code', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await invoke(accountsPlatform, { method: 'POST', query: { platform: 'linkedin' }, body: { code: 'oauth-code-secret' }, headers: bearer('A') });
      expect(log.mock.calls.flat().join(' ')).not.toContain('oauth-code-secret');
    } finally {
      log.mockRestore();
    }
  });

  it('authenticated → 200, the mock response is unchanged', async () => {
    const r = await invoke(accountsPlatform, { method: 'POST', query: { platform: 'linkedin' }, body: { code: 'c' }, headers: bearer('A') });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('sibling GET still requires auth → 401', async () => {
    const r = await invoke(accountsPlatform, { method: 'GET', query: { platform: 'linkedin' } });
    expect(r.status).toBe(401);
  });
});

describe('F1-02 GET /api/track/angle-industry-matrix', () => {
  it('unauthenticated → 401, table never read (was 200 for anyone)', async () => {
    const r = await invoke(angleMatrix, { method: 'GET', query: { industry: 'saas' } });
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty('angles');
  });

  it('any authenticated user → 200 with the rankings', async () => {
    const r = await invoke(angleMatrix, { method: 'GET', query: { industry: 'saas' }, headers: bearer('B') });
    expect(r.status).toBe(200);
    expect(r.body.angles).toHaveLength(2);
  });
});

describe('F1-03 POST /api/track/angle-industry-matrix (global aggregate write)', () => {
  const body = { company_id: CO_A, industry: 'saas', angle_type: 'contrarian', content_score: 100 };
  const contrarian = () => rows('angle_industry_matrix').find((r) => r.angle_type === 'contrarian')!;

  it('unauthenticated → 401, nothing written', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body });
    expect(r.status).toBe(401);
    expect(writeCalls(['angle_industry_matrix'])).toEqual([]);
  });

  it('THE EXPLOIT: an admin of their own company cannot write the shared aggregate → 403, nothing written', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('A') });
    expect(r.status).toBe(403);
    expect(writeCalls(['angle_industry_matrix'])).toEqual([]);
    expect(contrarian().post_count).toBe(5);
  });

  it('a deactivated super admin cannot either → 403', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('EXSUPER') });
    expect(r.status).toBe(403);
    expect(writeCalls(['angle_industry_matrix'])).toEqual([]);
  });

  it('an active platform super admin (operator curation) → 200, aggregate incremented', async () => {
    const r = await invoke(angleMatrix, { method: 'POST', body, headers: bearer('SUPER') });
    expect(r.status).toBe(200);
    expect(writeCalls(['angle_industry_matrix'])).toHaveLength(1);
  });
});
