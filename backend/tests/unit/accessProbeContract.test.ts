/**
 * The UNSTATED CONTRACT behind enforceCompanyAccessUniform, stated and pinned (05, 2026-11-12): the
 * capturing probe implements status / json / send / setHeader / getHeader / end, and the real
 * enforceCompanyAccess must use nothing else on ANY of its paths. The probe throws a NAMED
 * AccessProbeUnsupportedError on anything else, so if the access check ever starts using another
 * response method, these paths fail here, by name, instead of crashing an authorization path in prod.
 */
import { seed, invoke, failTable, CAMPAIGN_A, CAMPAIGN_B, CO_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());

import { enforceCompanyAccessUniform, createAccessProbe, AccessProbeUnsupportedError, UNIFORM_NOT_FOUND } from '../../services/userContextService';

/** A minimal route around the wrapper: 200 {ok} when access is granted. */
const route = (campaignId?: string) => async (req: any, res: any) => {
  const access = await enforceCompanyAccessUniform({ req, res, companyId: CO_A, campaignId: campaignId ?? null });
  if (access) res.status(200).json({ ok: true });
};
const call = (as: 'A' | 'B' | null, campaignId?: string) => invoke(route(campaignId) as never, { method: 'GET', as });

describe('every path of the REAL enforceCompanyAccess stays inside the probe', () => {
  beforeEach(() => seed());
  it('member: allowed (200)', async () => { expect((await call('A')).status).toBe(200); });
  it('member, own campaign bound: allowed', async () => { expect((await call('A', CAMPAIGN_A)).status).toBe(200); });
  it('anonymous: 401 passes through', async () => { expect((await call(null)).status).toBe(401); });
  it('non-member: 403 becomes the uniform 404', async () => {
    const r = await call('B');
    expect(r.status).toBe(404);
    expect(r.body).toEqual(UNIFORM_NOT_FOUND);
  });
  it('member, ANOTHER company\'s campaign bound: its 404 becomes the uniform 404', async () => {
    const r = await call('A', CAMPAIGN_B);
    expect(r.status).toBe(404);
    expect(r.body).toEqual(UNIFORM_NOT_FOUND);
  });
  it('membership lookup error: 503 passes through ("could not check" is never "not found")', async () => {
    failTable('user_company_roles');
    const r = await call('A');
    expect(r.status).toBe(503);
  });
});

describe('the probe itself', () => {
  it('an UNIMPLEMENTED response member fails with a NAMED error, not "x is not a function"', () => {
    const { res } = createAccessProbe();
    expect(() => (res as any).redirect('/x')).toThrow(AccessProbeUnsupportedError);
    expect(() => (res as any).appendHeader('a', 'b')).toThrow(/res\.appendHeader/);
  });
  it('is not a thenable (awaiting it is safe)', () => {
    const { res } = createAccessProbe();
    expect((res as any).then).toBeUndefined();
  });
  it('records headers, readable back through getHeader (case-insensitive)', () => {
    const { res, captured } = createAccessProbe();
    res.setHeader('Retry-After', '5');
    expect(res.getHeader('retry-after')).toBe('5');
    expect(captured.headers).toEqual({ 'retry-after': '5' });
  });
});
