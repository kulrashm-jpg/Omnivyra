/**
 * PI-LDB step E: /api/super-admin/mapping-profiles (PLATFORM vendor profiles).
 *
 * Asserts: only a Super Admin reaches the store; the approver is the VERIFIED
 * Super Admin, never a body field; no tenant can be named; only vendor sources
 * and the 'platform_approved' method are accepted; an approval that was not
 * stored never answers 2xx; a failed read never answers "no profile".
 */
jest.mock('@/config', () => ({ config: {} }), { virtual: true });

// The canonical capability gate. `superAdmin` = a principal who passes it
// (for POST: one WITH platform authority); null = refused (403 already sent).
let superAdmin: { id: string } | null = { id: '00000000-0000-4000-8000-0000000000d1' };
const requireCapability = jest.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }, _opts: unknown) => {
  if (!superAdmin) { res.status(403).json({ error: 'Forbidden', code: 'PLATFORM_SUPER_ADMIN_REQUIRED' }); return { ok: false, sent: true }; }
  return { ok: true, principal: { userId: superAdmin.id } };
});
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => (requireCapability as unknown as (...x: unknown[]) => unknown)(...a),
}));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const savePlatformProfileVersion = jest.fn();
const loadPlatformProfile = jest.fn();
jest.mock('../../services/leadMapping/mappingProfileStore', () => {
  class MappingProfileStoreError extends Error {
    constructor(message: string, readonly kind: string) { super(message); this.name = 'MappingProfileStoreError'; }
  }
  return {
    savePlatformProfileVersion: (...a: unknown[]) => savePlatformProfileVersion(...a),
    loadPlatformProfile: (...a: unknown[]) => loadPlatformProfile(...a),
    MappingProfileStoreError,
  };
});

import handler from '../../../pages/api/super-admin/mapping-profiles';
import { MappingProfileStoreError } from '../../services/leadMapping/mappingProfileStore';
import type { NextApiRequest, NextApiResponse } from 'next';

const FP = 'a'.repeat(64);
const SUPER = '00000000-0000-4000-8000-0000000000d1';

type Res = NextApiResponse & { _status: number; _json: Record<string, unknown> };
const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {} };
  r.status = ((c: number) => { (r as Res)._status = c; return r as Res; }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => { (r as Res)._json = b; return r as Res; }) as Res['json'];
  r.setHeader = (() => r as Res) as unknown as Res['setHeader'];
  return r as Res;
};
const entry = (over: Record<string, unknown> = {}) => ({
  sourceField: 'Email', target: 'email', transformation: 'lowercase_email',
  decision: 'approved', mappingMethod: 'platform_approved', ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  source: 'apollo', schemaFingerprint: FP, headers: ['Email'], entries: [entry()], ...over,
});
const call = async (r: Partial<NextApiRequest>) => {
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(
    { method: 'POST', query: {}, headers: {}, body: body(), ...r } as NextApiRequest, res,
  );
  return res;
};

beforeEach(() => {
  superAdmin = { id: SUPER };
  requireCapability.mockClear();
  savePlatformProfileVersion.mockReset();
  savePlatformProfileVersion.mockResolvedValue({ profileId: 'plat-1', version: 1 });
  loadPlatformProfile.mockReset();
});

describe('who can approve a vendor mapping', () => {
  it('the gate is SUPER_ADMIN_DASHBOARD_VIEW, and the WRITE requires platform authority (Closure-015); the read does not', async () => {
    const { SUPER_ADMIN_DASHBOARD_VIEW } = jest.requireActual('../../../shared/contracts/security');
    await call({});
    expect(requireCapability.mock.calls[0][2]).toMatchObject({ capability: SUPER_ADMIN_DASHBOARD_VIEW, requirePlatformAuthority: true });
    requireCapability.mockClear();
    loadPlatformProfile.mockResolvedValue(null);
    await call({ method: 'GET', query: { source: 'apollo', schemaFingerprint: FP } });
    expect(requireCapability.mock.calls[0][2]).toMatchObject({ capability: SUPER_ADMIN_DASHBOARD_VIEW, requirePlatformAuthority: false });
  });

  it('a non-Super-Admin is refused 403 and the store is never reached', async () => {
    superAdmin = null;
    const res = await call({});
    expect(res._status).toBe(403);
    expect(savePlatformProfileVersion).not.toHaveBeenCalled();
  });

  it('the approver is the VERIFIED Super Admin; the body cannot name an approver or a tenant', async () => {
    const res = await call({});
    expect(res._status).toBe(201);
    expect(savePlatformProfileVersion.mock.calls[0][0]).toMatchObject({ source: 'apollo', schemaFingerprint: FP, approvedBy: SUPER });
    for (const k of ['approvedBy', 'organization_id', 'company_id']) {
      savePlatformProfileVersion.mockClear();
      const bad = await call({ body: { ...body(), [k]: 'x' } });
      expect(bad._status).toBe(400);
      expect(savePlatformProfileVersion).not.toHaveBeenCalled();
    }
  });
});

describe('only vendor sources, only the platform method', () => {
  it.each(['csv', 'hubspot', ''])('a non-vendor source %j is refused', async (source) => {
    const res = await call({ body: body({ source }) });
    expect(res._status).toBe(400);
    expect(savePlatformProfileVersion).not.toHaveBeenCalled();
  });

  it.each(['tenant_confirmed', 'approved_profile_match'])('a tenant method %j is refused', async (m) => {
    const res = await call({ body: body({ entries: [entry({ mappingMethod: m })] }) });
    expect(res._status).toBe(400);
    expect(savePlatformProfileVersion).not.toHaveBeenCalled();
  });

  it('an invented destination is refused (shared validator)', async () => {
    const res = await call({ body: body({ entries: [entry({ target: 'not_a_field' })] }) });
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('UNKNOWN_TARGET');
  });
});

describe('never 2xx for an approval that was not stored', () => {
  it.each([
    ['conflict', 409, 'MAPPING_CONFLICT'],
    ['invalid_argument', 400, 'INVALID_MAPPING'],
    ['write_failed', 503, 'MAPPING_SAVE_FAILED'],
  ])('store %s -> %i %s', async (kind, status, code) => {
    savePlatformProfileVersion.mockRejectedValue(new (MappingProfileStoreError as unknown as new (m: string, k: string) => Error)('x', kind));
    const res = await call({});
    expect(res._status).toBe(status);
    expect(res._json.code).toBe(code);
  });
});

describe('GET', () => {
  it('reads the active platform profile for a vendor shape', async () => {
    loadPlatformProfile.mockResolvedValue({ profileId: 'plat-1', scope: 'platform' });
    const res = await call({ method: 'GET', query: { source: 'apollo', schemaFingerprint: FP } });
    expect(res._status).toBe(200);
    expect(res._json.profile).toMatchObject({ profileId: 'plat-1' });
  });

  it('an unreadable profile is 503, never "no profile"', async () => {
    loadPlatformProfile.mockRejectedValue(new Error('read failed'));
    const res = await call({ method: 'GET', query: { source: 'apollo', schemaFingerprint: FP } });
    expect(res._status).toBe(503);
    expect(res._json).not.toHaveProperty('profile');
  });

  it('a non-Super-Admin cannot read either', async () => {
    superAdmin = null;
    const res = await call({ method: 'GET', query: { source: 'apollo', schemaFingerprint: FP } });
    expect(res._status).toBe(403);
    expect(loadPlatformProfile).not.toHaveBeenCalled();
  });
});
