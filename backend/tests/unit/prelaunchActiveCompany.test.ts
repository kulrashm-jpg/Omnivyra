/**
 * Pre-launch active-company sweep (e9 list, 2026-11-13). users.active_company_id is a MUTABLE pointer that in prod
 * often names a company whose membership is INACTIVE; it must never decide a tenant.
 *  - bootstrap-super-admin: SUPER_ADMIN binds to the caller-named org, else the user's ONLY active membership
 *    (412 organization_ambiguous with several, 412 no_organization_to_bind with none) - never the pointer, never an
 *    inactive role row.
 *  - super-admin suspend / resume / force-logout: a USER-level action is audited with company_id NULL (it used to be
 *    filed under the target's pointer company, showing target_email in an unrelated company's audit); the pointer is
 *    kept only as forensic metadata.
 * (generate-response precedence: engagementDraftOwnershipP11 T6/T6b/T6c.)
 */
import fs from 'fs';
import path from 'path';

const dbMock = jest.fn();
jest.mock('../../services/requestAccessService', () => ({
  ...jest.requireActual('../../services/requestAccessService'),
  requireAdminRateLimit: async () => true,
}));
jest.mock('../../db/supabaseClient', () => {
  const client = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.assign_super_admin' } }) };
  return { supabase: client, default: client };
});
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (...args: unknown[]) => dbMock(...args) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn().mockResolvedValue(undefined),
  logCookieSuperAdminUsage: jest.fn().mockResolvedValue(undefined),
  snapshotFromPrincipal: jest.fn().mockReturnValue({}),
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  createSession: jest.fn().mockResolvedValue({ session: { id: 's1' }, cookieValue: 'c' }),
  attachSessionCookie: jest.fn(),
}));
jest.mock('../../security/startup/superAdminIdentityCheck', () => ({ resetSuperAdminIdentityCache: jest.fn() }));

import type { NextApiRequest, NextApiResponse } from 'next';

let handler: any;
let resetLimit: any;
beforeAll(async () => {
  const mod = await import('../../../pages/api/admin/bootstrap-super-admin');
  handler = mod.default;
  resetLimit = mod._resetEnvCredentialRateLimit;
});

const TARGET = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CO_A = '00000000-0000-4000-8000-00000000000a';
const CO_B = '00000000-0000-4000-8000-00000000000b';
const STALE = '00000000-0000-4000-8000-0000000000ff';
const ENV_USER = 'admin';
const ENV_PASS = 'longenoughpassword123';
const TOKEN = 'token-token-token-token-token-token-32+';

type RoleRow = { company_id: string; status: string };
let roleRows: RoleRow[] = [];
let inserted: Array<Record<string, unknown>> = [];

function withDb(): void {
  dbMock.mockImplementation((table: string) => {
    if (table === 'user_company_roles') {
      return {
        select: jest.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count === 'exact' && opts?.head === true) {
            const t: any = { eq: jest.fn(() => t), then(resolve: (v: { count: number }) => void) { resolve({ count: 0 }); return t; } };
            return t;
          }
          const filters: Array<[string, unknown]> = [];
          const rows = () => roleRows.filter((r) => filters.every(([c, v]) => c === 'user_id' || (r as Record<string, unknown>)[c] === v));
          const chain: any = {
            eq: jest.fn((c: string, v: unknown) => { filters.push([c, v]); return chain; }),
            order: jest.fn(() => chain),
            limit: jest.fn(() => chain),
            maybeSingle: jest.fn(async () => ({ data: null })), // existing SUPER_ADMIN row lookup: none
            then(resolve: (v: { data: RoleRow[] }) => void) { resolve({ data: rows() }); return chain; },
          };
          return chain;
        }),
        insert: jest.fn((row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: 'role-row-1' }, error: null }) })) };
        }),
        update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) })),
      };
    }
    if (table === 'users') {
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: TARGET, supabase_uid: TARGET, email: 'op@x', is_deleted: false, active_company_id: STALE },
            }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function makeRes() {
  const captured = { status: 0, body: {} as any };
  const res = {
    setHeader() {}, getHeader() { return undefined; },
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
  } as unknown as NextApiResponse;
  return { res, captured };
}
const req = (extra: Record<string, unknown> = {}) => ({
  method: 'POST',
  body: { mode: 'env-credential', username: ENV_USER, password: ENV_PASS, bootstrapToken: TOKEN, targetUserId: TARGET, ...extra },
  headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'jest' },
  cookies: {}, socket: { remoteAddress: '1.2.3.4' },
}) as unknown as NextApiRequest;

beforeEach(() => {
  process.env.SUPER_ADMIN_USERNAME = ENV_USER;
  process.env.SUPER_ADMIN_PASSWORD = ENV_PASS;
  process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN = TOKEN;
  dbMock.mockReset();
  resetLimit();
  roleRows = [];
  inserted = [];
  withDb();
});

describe('bootstrap-super-admin binds only to an ACTIVE membership', () => {
  it('one active membership -> bound to it (the stale pointer is ignored)', async () => {
    roleRows = [{ company_id: CO_A, status: 'active' }, { company_id: STALE, status: 'inactive' }];
    const { res, captured } = makeRes();
    await handler(req(), res);
    expect(captured.status).toBe(201);
    expect(inserted).toEqual([expect.objectContaining({ company_id: CO_A, role: 'SUPER_ADMIN' })]);
  });
  it('no active membership -> 412 no_organization_to_bind (never the pointer, never an inactive row)', async () => {
    roleRows = [{ company_id: STALE, status: 'inactive' }];
    const { res, captured } = makeRes();
    await handler(req(), res);
    expect(captured.status).toBe(412);
    expect(captured.body.error).toBe('no_organization_to_bind');
    expect(inserted).toHaveLength(0);
  });
  it('several active memberships -> 412 organization_ambiguous (the caller must name the org)', async () => {
    roleRows = [{ company_id: CO_A, status: 'active' }, { company_id: CO_B, status: 'active' }];
    const { res, captured } = makeRes();
    await handler(req(), res);
    expect(captured.status).toBe(412);
    expect(captured.body.error).toBe('organization_ambiguous');
    expect(inserted).toHaveLength(0);
  });
  it('CONTROL: a caller-named org is used as before', async () => {
    roleRows = [{ company_id: CO_A, status: 'active' }, { company_id: CO_B, status: 'active' }];
    const { res, captured } = makeRes();
    await handler(req({ organizationId: CO_B }), res);
    expect(captured.status).toBe(201);
    expect(inserted).toEqual([expect.objectContaining({ company_id: CO_B })]);
  });
});

describe('super-admin user actions are audited with NO company', () => {
  const files = ['suspend', 'resume', 'force-logout'].map((n) => path.resolve(__dirname, '../../../pages/api/super-admin/users/[id]', `${n}.ts`));
  it.each(files)('%s: companyId null; the pointer only as forensic metadata', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const audit = src.slice(src.indexOf('await insertAuditLogStrict({'));
    expect(audit).toMatch(/targetUserId: userId,[\s\S]{0,400}companyId: null,/);
    expect(audit).toContain('target_active_company_id: u.active_company_id ?? null,');
    expect(src).not.toContain('companyId: u.active_company_id');
  });
});
