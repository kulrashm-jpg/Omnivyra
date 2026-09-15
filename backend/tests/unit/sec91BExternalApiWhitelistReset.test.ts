/**
 * SEC91-B2 — a tenant edit voids Super Admin approval of an external API source.
 *
 * THE DEFECT: `PUT /api/external-apis/[id]` let a tenant admin (MANAGE_EXTERNAL_APIS)
 * change base_url, auth_type, api_key_env_name, headers and query_params of a row that a
 * Super Admin had whitelisted, and the row stayed whitelisted — i.e. executable — with a
 * configuration nobody approved (new destination, new {{ENV_NAME}} templates).
 *
 * NOW: when a caller without platform scope changes any of those fields on a whitelisted
 * row, the same UPDATE sets is_whitelisted=false (re-approval required). No-op edits and
 * cosmetic edits keep the approval; Super Admin edits keep their explicit handling.
 * The real route runs; only auth, RBAC verdicts and the data layer are scripted.
 */
export {};

type Row = Record<string, unknown>;

const TENANT_ADMIN = 'user-tenant-admin';
const PLATFORM_ADMIN = 'user-platform-admin';
const COMPANY_A = 'company-a';
const ROW_ID = 'src-approved';

let authUser: string | null = TENANT_ADMIN;
let stored: Row;
const updates: Row[] = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => (authUser ? { user: { id: authUser }, error: null } : { user: null, error: 'MISSING_AUTH' })),
}));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: jest.fn(() => null) }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => ({ userId: authUser ?? '', role: 'user', companyIds: [COMPANY_A], defaultCompanyId: COMPANY_A, authenticated: Boolean(authUser) })),
}));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: jest.fn(async (id: string) => id === 'user-platform-admin'),
  isSuperAdmin: jest.fn(async (id: string) => id === 'user-platform-admin'),
  getUserRole: jest.fn(async (id: string, companyId: string) =>
    id === 'user-tenant-admin' && companyId === 'company-a' ? { role: 'COMPANY_ADMIN', error: null } : { role: null, error: 'COMPANY_ACCESS_DENIED' }),
  getCompanyRoleIncludingInvited: jest.fn(async () => null),
  hasPermission: jest.fn(async (role: string) => role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN'),
}));
jest.mock('../../services/externalApiService', () => ({
  validatePlatformConfig: jest.fn(() => ({ ok: true })),
  VALID_API_CATEGORIES: ['social', 'others'],
}));
jest.mock('../../auth/credentialEncryption', () => ({ encryptCredential: jest.fn((v: string) => v) }));
jest.mock('../../services/companyApiConfigCache', () => ({ invalidateCompanyConfigCacheForApiSource: jest.fn(async () => {}) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let op = 'select';
      let payload: Row | undefined;
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
      b.update = (p: Row) => { op = 'update'; payload = p; return b; };
      const resolve = () => {
        if (table !== 'external_api_sources') return { data: null, error: null };
        if (filters.id !== stored.id) return { data: null, error: { message: 'no rows' } };
        if ('company_id' in filters && filters.company_id !== stored.company_id) return { data: null, error: { message: 'no rows' } };
        if (op === 'update') { updates.push(payload!); stored = { ...stored, ...payload }; }
        return { data: { ...stored }, error: null };
      };
      b.single = () => Promise.resolve(resolve());
      b.then = (r: any) => Promise.resolve(resolve()).then(r);
      return b;
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../pages/api/external-apis/[id]').default;

const APPROVED: Row = {
  id: ROW_ID, company_id: COMPANY_A, name: 'Tenant feed', category: 'others', is_whitelisted: true,
  base_url: 'https://feed.partner.example/v1', method: 'GET', auth_type: 'bearer',
  api_key_env_name: 'NEWS_API_KEY', api_key_name: null,
  headers: { Accept: 'application/json' }, query_params: { q: '{{category}}' }, platform_type: 'social',
};
const sameBody = () => ({
  name: APPROVED.name, base_url: APPROVED.base_url, method: APPROVED.method, auth_type: APPROVED.auth_type,
  api_key_env_name: APPROVED.api_key_env_name, headers: { ...(APPROVED.headers as Row) }, query_params: { ...(APPROVED.query_params as Row) },
  platform_type: 'social',
});

async function put(body: Row, as: string = TENANT_ADMIN, query: Row = { companyId: COMPANY_A }) {
  authUser = as;
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await handler({ method: 'PUT', url: `/api/external-apis/${ROW_ID}`, query: { id: ROW_ID, ...query }, body } as never, res);
  return res;
}

beforeEach(() => {
  stored = { ...APPROVED };
  updates.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

describe.each([
  ['base_url', { base_url: 'https://attacker.example/collect' }],
  ['api_key_env_name', { api_key_env_name: 'OPENAI_API_KEY' }],
  ['headers template', { headers: { Accept: 'application/json', 'X-K': '{{OPENAI_API_KEY}}' } }],
  ['query template', { query_params: { q: '{{category}}', k: '{{SERPAPI_KEY}}' } }],
  ['auth_type', { auth_type: 'query' }],
])('tenant edit of %s on a whitelisted row', (_label, change) => {
  it('revokes is_whitelisted in the same update', async () => {
    const res = await put({ ...sameBody(), ...change });
    expect(res.statusCode).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].is_whitelisted).toBe(false);
    expect(res.body.whitelist_reset).toBe(true);
    expect(stored.is_whitelisted).toBe(false);
  });
});

describe('approval is kept when nothing security-relevant changed', () => {
  it('a no-op tenant save keeps the approval', async () => {
    const res = await put(sameBody());
    expect(res.statusCode).toBe(200);
    expect(updates[0]).not.toHaveProperty('is_whitelisted');
    expect(stored.is_whitelisted).toBe(true);
  });

  it('a cosmetic tenant edit (name) keeps the approval', async () => {
    await put({ ...sameBody(), name: 'Renamed feed' });
    expect(updates[0]).not.toHaveProperty('is_whitelisted');
    expect(stored.is_whitelisted).toBe(true);
  });

  it('a Super Admin editing the base_url does not self-revoke (it is the approver)', async () => {
    await put({ ...sameBody(), base_url: 'https://feed.partner.example/v2' }, PLATFORM_ADMIN);
    expect(updates[0]).not.toHaveProperty('is_whitelisted');
    expect(stored.is_whitelisted).toBe(true);
  });

  it('a tenant PUT for a row it does not own is 404 with no write', async () => {
    stored = { ...APPROVED, company_id: 'company-b' };
    const res = await put({ ...sameBody(), base_url: 'https://attacker.example' });
    expect(res.statusCode).toBe(404);
    expect(updates).toHaveLength(0);
  });
});
