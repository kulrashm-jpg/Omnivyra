/**
 * Tenant data-controller acknowledgement: the accept route and the server-side
 * enforcement points (owner requirement, 2026-11-11).
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000a1';
let ackState: Record<string, { state: string; allowed: boolean }> = {};
const recorded: Array<Record<string, unknown>> = [];
let recordError: unknown = null;
const tenantCalls: unknown[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: async (_req: unknown, _res: unknown, companyId: unknown) => { tenantCalls.push(companyId); return { userId: USER }; },
}));
jest.mock('../../apiHandlers/externalApis/indexShared', () => ({ requireExternalApiAccess: async () => ({ ok: true }) }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: async () => ({ ok: true, principal: { userId: USER } }) }));
jest.mock('../../services/compliance/tenantDataAck', () => {
  const actual = jest.requireActual('../../services/compliance/tenantDataAck');
  const status = () => ({
    notice: actual.loadTenantDataNotice(), readable: true,
    categories: Object.fromEntries(actual.DATA_CATEGORIES.map((c: string) => [c, {
      state: ackState[c]?.state ?? 'required', allowed: ackState[c]?.allowed ?? false,
      acceptedVersion: null, acceptedAt: null, acceptedBy: 'secret-user', graceEndsAt: null }])),
  });
  return {
    ...actual,
    getTenantDataAckStatus: async () => status(),
    assertTenantDataAck: async (_o: string, c: string) => {
      const s = status().categories[c];
      if (!s.allowed) throw new actual.TenantDataAckRequired(c, s.state);
      return s;
    },
    recordTenantDataAck: async (input: Record<string, unknown>) => {
      recorded.push(input);
      if (recordError) throw recordError;
      return { acceptedVersion: 'v', categories: input.categories };
    },
  };
});
const writes: unknown[] = [];
jest.mock('../../services/enrichment/apolloFieldGroups', () => {
  const actual = jest.requireActual('../../services/enrichment/apolloFieldGroups');
  return { ...actual, writeTenantFieldGroups: async (...a: unknown[]) => { writes.push(a); return ['job_role']; }, readTenantFieldGroups: async () => ['job_role'] };
});
jest.mock('../../services/enrichment/centralVendorAccess', () => ({
  CentralAccessSelectionRefused: class extends Error {},
  writeCentralVendorOptIns: async (...a: unknown[]) => { writes.push(a); return []; },
  readCentralVendorOptIns: async () => [],
  quoteCentralVendorAccess: async () => [],
}));

import ackHandler from '../../../pages/api/compliance/tenant-data-ack';
import groupsHandler from '../../../pages/api/prospect-sources/apollo-field-groups';
import centralHandler from '../../../pages/api/billing/central-vendor-access';
import { TenantDataAckRefused } from '../../services/compliance/tenantDataAck';

type Res = { statusCode?: number; body?: Record<string, unknown> };
function call(h: unknown, method: string, query: Record<string, unknown>, body?: unknown): Promise<Res> {
  const out: Res = {};
  const res = {
    status(c: number) { out.statusCode = c; return res; },
    json(b: Record<string, unknown>) { out.body = b; return res; },
    setHeader() { return res; }, end() { return res; },
  };
  return (h as (q: unknown, s: unknown) => Promise<unknown>)({ method, query, body, headers: {} }, res).then(() => out);
}

beforeEach(() => { ackState = {}; recorded.length = 0; recordError = null; tenantCalls.length = 0; writes.length = 0; });

describe('accept route', () => {
  it('GET: any member sees the notice and per-category state; the acceptor id is NOT exposed', async () => {
    const r = await call(ackHandler, 'GET', { companyId: ORG });
    expect(r.statusCode).toBe(200);
    expect((r.body!.notice as Record<string, unknown>).status).toBe('PENDING COUNSEL REVIEW');
    expect(JSON.stringify(r.body)).not.toContain('secret-user');
  });

  it('POST: the tenant is the session-bound QUERY id and the acceptor the verified user; a body org is ignored', async () => {
    const r = await call(ackHandler, 'POST', { companyId: ORG },
      { categories: ['vendor_data'], shownVersion: 'v', shownTextSha256: 'h', organizationId: 'evil-org', userId: 'evil-user' });
    expect(r.statusCode).toBe(201);
    expect(tenantCalls).toEqual([ORG]);
    expect(recorded[0]).toMatchObject({ organizationId: ORG, userId: USER, categories: ['vendor_data'], shownVersion: 'v', shownTextSha256: 'h' });
  });

  it.each([
    ['invalid_categories', 400], ['not_company_admin', 403], ['stale_notice', 409], ['membership_unknown', 503], ['write_failed', 503],
  ])('refusal %s -> %i with the code', async (code, status) => {
    recordError = new TenantDataAckRefused(code as never);
    const r = await call(ackHandler, 'POST', { companyId: ORG }, { categories: ['vendor_data'], shownVersion: 'v', shownTextSha256: 'h' });
    expect(r.statusCode).toBe(status);
    expect(r.body).toMatchObject({ error: 'TENANT_DATA_ACK_REFUSED', code });
  });
});

describe('enforcement', () => {
  it('saving Apollo field groups without vendor_data -> 403, nothing written; with it -> saved', async () => {
    let r = await call(groupsHandler, 'PUT', { companyId: ORG }, { groups: ['job_role'] });
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ error: 'DATA_CONTROLLER_ACK_REQUIRED', category: 'vendor_data', state: 'required' });
    expect(writes).toEqual([]);
    ackState = { vendor_data: { state: 'grace', allowed: true } };
    r = await call(groupsHandler, 'PUT', { companyId: ORG }, { groups: ['job_role'] });
    expect(r.statusCode).toBe(200);
  });

  it('a contact group is passed through only with contact_data allowed', async () => {
    ackState = { vendor_data: { state: 'current', allowed: true } };
    await call(groupsHandler, 'PUT', { companyId: ORG }, { groups: ['job_role'] });
    expect((writes[0] as unknown[])[3]).toEqual({ contactAllowed: false });
    ackState = { vendor_data: { state: 'current', allowed: true }, contact_data: { state: 'current', allowed: true } };
    await call(groupsHandler, 'PUT', { companyId: ORG }, { groups: ['job_role'] });
    expect((writes[1] as unknown[])[3]).toEqual({ contactAllowed: true });
  });

  it('central vendor access: opting IN needs vendor_data; opting OUT is never blocked', async () => {
    let r = await call(centralHandler, 'PUT', { companyId: ORG }, { vendors: ['apollo'] });
    expect(r.statusCode).toBe(403);
    expect(writes).toEqual([]);
    r = await call(centralHandler, 'PUT', { companyId: ORG }, { vendors: [] });
    expect(r.statusCode).toBe(200);
  });
});
