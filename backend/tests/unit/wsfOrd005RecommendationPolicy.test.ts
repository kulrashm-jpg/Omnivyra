/**
 * WSF-ORD-005 — pages/api/recommendation-policy.ts
 *
 * THE DEFECT: recommendation_policies is PLATFORM-GLOBAL, not tenant-scoped —
 * the active row is the policy every tenant's recommendations are ranked by.
 * POST, which only EDITS that row, was gated behind isSuperAdmin. GET, which
 * CREATED it, was gated behind nothing but authentication: any signed-in user
 * could install the platform's active ranking policy by issuing a GET.
 *
 * The fix gates the seeding insert behind the same platform check POST uses.
 * A non-admin GET is a pure read again.
 *
 * Only the database and the identity provider are faked; rbacService's real
 * isSuperAdmin runs against the harness's user_company_roles rows.
 */
import { seed, invoke, rows, writeCalls } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const recommendationPolicy = require('../../../pages/api/recommendation-policy').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const WEIGHTS = {
  trend_score: 1, geo_fit: 1, audience_fit: 1, category_fit: 1,
  platform_fit: 1, health_multiplier: 1, historical_accuracy: 1, effort_penalty: 0.1,
};

/** No policy exists yet — the state in which GET used to write one. */
const emptyWorld = () => seed({ recommendation_policies: [] });
const seededWorld = () =>
  seed({
    recommendation_policies: [
      { id: 'pol-1', name: 'Existing Policy', is_active: true, weights: WEIGHTS, updated_at: '2026-01-01' },
    ],
  });

const policyWrites = () => writeCalls(['recommendation_policies']);

describe('WSF-ORD-005 — recommendation-policy GET must not seed platform config', () => {
  it('unauthenticated GET → 401, nothing written', async () => {
    emptyWorld();
    const r = await invoke(recommendationPolicy, { method: 'GET', as: null });
    expect(r.status).toBe(401);
    expect(policyWrites()).toHaveLength(0);
  });

  it('THE EXPLOIT: a non-admin GET installed the platform-wide active policy — now a pure read', async () => {
    emptyWorld();
    const r = await invoke(recommendationPolicy, { method: 'GET', as: 'A' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ policy: null });
    expect(policyWrites()).toHaveLength(0);
    expect(rows('recommendation_policies')).toHaveLength(0);
  });

  it('a non-admin GET still READS an existing policy → 200 with the policy', async () => {
    seededWorld();
    const r = await invoke(recommendationPolicy, { method: 'GET', as: 'A' });
    expect(r.status).toBe(200);
    expect(r.body.policy).toMatchObject({ id: 'pol-1', name: 'Existing Policy' });
    expect(policyWrites()).toHaveLength(0);
  });

  it('a SUPER_ADMIN GET still seeds the default policy → 200, exactly one row written', async () => {
    emptyWorld();
    const r = await invoke(recommendationPolicy, { method: 'GET', as: 'SUPER' });
    expect(r.status).toBe(200);
    expect(r.body.policy).toMatchObject({ name: 'Default Policy', is_active: true });
    expect(policyWrites()).toHaveLength(1);
    expect(rows('recommendation_policies')).toHaveLength(1);
  });

  it('a SUPER_ADMIN GET does NOT re-seed when a policy already exists', async () => {
    seededWorld();
    const r = await invoke(recommendationPolicy, { method: 'GET', as: 'SUPER' });
    expect(r.status).toBe(200);
    expect(r.body.policy).toMatchObject({ id: 'pol-1' });
    expect(policyWrites()).toHaveLength(0);
  });

  describe('POST (unchanged)', () => {
    it('a non-admin POST is still refused → 403, nothing written', async () => {
      seededWorld();
      const r = await invoke(recommendationPolicy, { method: 'POST', as: 'A', body: { id: 'pol-1', weights: WEIGHTS } });
      expect(r.status).toBe(403);
      expect(policyWrites()).toHaveLength(0);
    });

    it('a SUPER_ADMIN POST still updates → 200', async () => {
      seededWorld();
      const r = await invoke(recommendationPolicy, {
        method: 'POST', as: 'SUPER',
        body: { id: 'pol-1', weights: { ...WEIGHTS, trend_score: 2 } },
      });
      expect(r.status).toBe(200);
      expect(policyWrites()).toHaveLength(1);
      expect(rows('recommendation_policies')[0].weights).toMatchObject({ trend_score: 2 });
    });
  });
});
