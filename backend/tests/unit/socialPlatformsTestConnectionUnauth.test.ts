/**
 * SECURITY (2026-11-13): POST /api/social-platforms/test-connection ran its company access check only
 * `if (organizationId)`. resolveUserContext does not refuse an anonymous caller (unauthenticated context, no
 * default company), so an anonymous request with no organization_id reached `process.env[<body-supplied name>]`
 * and the platform adapter - server credentials spent for anyone, and set/unset env names distinguishable.
 *
 * Now: unauthenticated -> 401; a company is ALWAYS access-checked before any credential is resolved; an env name
 * only through the real external-API allowlist (assertTestableEnvVarName - not mocked here; only its registry
 * read is faked, empty, so the allowlist is no kinder than production's).
 */
import { randomBytes } from 'crypto';

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
  ownedDbRpc: async () => ({ data: null, error: null }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockUser = { current: null as null | Record<string, unknown> };
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => mockUser.current,
  enforceCompanyAccess: async (i: { companyId?: string; res: any }) => {
    const u = mockUser.current as { authenticated?: boolean; companyIds?: string[]; userId?: string } | null;
    if (u?.authenticated && u.companyIds?.includes(String(i.companyId))) return { userId: u.userId };
    i.res.status(403).json({ error: 'forbidden' });
    return null;
  },
}));
jest.mock('../../services/platformRegistryService', () => ({ validatePlatformKey: async () => true }));
const mockTestConnection = jest.fn(async (_c: { access_token: string }) => ({ success: true }));
jest.mock('../../services/platformAdapters', () => ({ getPlatformAdapter: () => ({ testConnection: mockTestConnection }) }));

import { resetFakeDb } from '../helpers/fakeWhatsappDb';
import { canonicalDescriptorEnvNames } from '../../services/externalApi/testEnvAllowlist';
/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/social-platforms/test-connection').default;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const anonymous = { userId: '', role: 'user', companyIds: [], defaultCompanyId: '', authenticated: false, authError: 'MISSING_AUTH' };
const userA = { userId: 'user-a', role: 'user', companyIds: [A], defaultCompanyId: A, authenticated: true, authError: null };

const INFRA = 'SUPABASE_SERVICE_ROLE_KEY';
const ALLOWED = [...canonicalDescriptorEnvNames()][0];
const saved: Record<string, string | undefined> = {};
const infraValue = randomBytes(16).toString('hex');
const allowedValue = randomBytes(16).toString('hex');

async function post(body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
}

beforeAll(() => {
  for (const k of [INFRA, ALLOWED]) saved[k] = process.env[k];
  process.env[INFRA] = infraValue;
  process.env[ALLOWED] = allowedValue;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
beforeEach(() => {
  resetFakeDb({ external_api_sources: [] });
  mockTestConnection.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('arrangement: the allowlist has a canonical name to test with', () => {
  expect(typeof ALLOWED).toBe('string');
  expect(ALLOWED).not.toBe(INFRA);
});

it('ANONYMOUS naming a server env var, no organization -> 401, adapter never called', async () => {
  mockUser.current = anonymous;
  const res = await post({ platform_key: 'linkedin', api_key_env_name: INFRA });
  expect(res.statusCode).toBe(401);
  expect(mockTestConnection).not.toHaveBeenCalled();
});

it('ANONYMOUS with its own token, no organization -> 401, adapter never called', async () => {
  mockUser.current = anonymous;
  const res = await post({ platform_key: 'linkedin', credentials: { access_token: 'caller-token' } });
  expect(res.statusCode).toBe(401);
  expect(mockTestConnection).not.toHaveBeenCalled();
});

it('a user of A naming an infrastructure secret -> 400 ENV_VAR_NOT_TESTABLE, its value never used', async () => {
  mockUser.current = userA;
  const res = await post({ platform_key: 'linkedin', api_key_env_name: INFRA });
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual(expect.objectContaining({ code: 'ENV_VAR_NOT_TESTABLE' }));
  expect(mockTestConnection).not.toHaveBeenCalled();
  expect(JSON.stringify(res.body)).not.toContain(infraValue);
});

it('a user of A naming company B -> 403 before any credential is resolved', async () => {
  mockUser.current = userA;
  const res = await post({ platform_key: 'linkedin', organization_id: B, api_key_env_name: ALLOWED });
  expect(res.statusCode).toBe(403);
  expect(mockTestConnection).not.toHaveBeenCalled();
});

it('CONTROL: a user of A tests with its own token, and with an allowlisted env name', async () => {
  mockUser.current = userA;
  const own = await post({ platform_key: 'linkedin', credentials: { access_token: 'caller-token' } });
  expect(own.statusCode).toBe(200);
  expect(mockTestConnection).toHaveBeenLastCalledWith(expect.objectContaining({ access_token: 'caller-token' }));
  const viaEnv = await post({ platform_key: 'linkedin', organization_id: A, api_key_env_name: ALLOWED });
  expect(viaEnv.statusCode).toBe(200);
  expect(mockTestConnection).toHaveBeenLastCalledWith(expect.objectContaining({ access_token: allowedValue }));
});
