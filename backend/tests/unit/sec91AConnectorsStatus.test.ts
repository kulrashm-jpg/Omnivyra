/**
 * SEC-91A (STEP 3AH-91) — A2: GET /api/community-ai/connectors/status
 * authorized `tenant_id` but READ `organization_id`.
 *
 * A connector manager of company A could call
 *   ?tenant_id=A&organization_id=B
 * and receive B's connected platforms and configured-platform list. The ids must
 * now match (Community AI's own convention) and only the authorized id is read.
 */
import { seed, invoke, CO_A, CO_B, CANARY_B } from '../helpers/routeAuthHarness';
import { bearer } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
// The SSR-cookie fallback in requireManageConnectors: no session cookie here.
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const byCompany: Record<string, string[]> = {
  'co-a-0000-0000-0000-00000000000a': ['linkedin'],
  'co-b-0000-0000-0000-00000000000b': [`x-${'CANARY-COMPANY-B-CONFIDENTIAL'}`],
};
const getPlatformsWithTokensForOrg = jest.fn(async (org: string) => byCompany[org] ?? []);
const getCompanyConfiguredPlatformsForConnectors = jest.fn(async (org: string) => (byCompany[org] ?? []).map((p) => ({ platform: p })));
jest.mock('../../services/platformTokenService', () => ({
  getPlatformsWithTokensForOrg: (org: string) => getPlatformsWithTokensForOrg(org),
}));
jest.mock('../../services/companyPlatformService', () => ({
  getCompanyConfiguredPlatformsForConnectors: (org: string) => getCompanyConfiguredPlatformsForConnectors(org),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const status = require('../../../pages/api/community-ai/connectors/status').default;
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  seed();
  getPlatformsWithTokensForOrg.mockClear();
  getCompanyConfiguredPlatformsForConnectors.mockClear();
});

const readsOf = () => [
  ...getPlatformsWithTokensForOrg.mock.calls.map((c) => c[0]),
  ...getCompanyConfiguredPlatformsForConnectors.mock.calls.map((c) => c[0]),
];

describe('GET /api/community-ai/connectors/status', () => {
  it('unauthenticated → 401, nothing read', async () => {
    const r = await invoke(status, { query: { tenant_id: CO_A, organization_id: CO_A } });
    expect(r.status).toBe(401);
    expect(readsOf()).toEqual([]);
  });

  it('THE EXPLOIT: authorize as A, read B (tenant_id=A&organization_id=B) → 400, B never read', async () => {
    const r = await invoke(status, { query: { tenant_id: CO_A, organization_id: CO_B }, headers: bearer('A') });
    expect(r.status).toBe(400);
    expect(readsOf()).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain(CANARY_B);
  });

  it('member of A asking for B outright → 403, nothing read', async () => {
    const r = await invoke(status, { query: { tenant_id: CO_B, organization_id: CO_B }, headers: bearer('A') });
    expect(r.status).toBe(403);
    expect(readsOf()).toEqual([]);
  });

  it('member of A reads A → 200 with only A\'s platforms', async () => {
    const r = await invoke(status, { query: { tenant_id: CO_A, organization_id: CO_A }, headers: bearer('A') });
    expect(r.status).toBe(200);
    expect(r.body.connections.map((c: { platform: string }) => c.platform)).toEqual(['linkedin']);
    expect(new Set(readsOf())).toEqual(new Set([CO_A]));
    expect(JSON.stringify(r.body)).not.toContain(CANARY_B);
  });

  it('missing ids → 400', async () => {
    const r = await invoke(status, { query: { tenant_id: CO_A }, headers: bearer('A') });
    expect(r.status).toBe(400);
  });
});
