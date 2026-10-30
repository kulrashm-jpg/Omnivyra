/**
 * PI WS-4D — the owned-identity control plane on the REAL authorization chain.
 *
 * ─── WHY THIS FILE EXISTS BESIDE `piWs4bOwnedIdentityRoutes.test.ts` ──────
 * `piWs4b` replaces `requireTenantAccess` and `requireCapability` with
 * `jest.fn`s. That is the right shape for what it proves — ROUTING: that the
 * guards are consulted in the right order, with the right arguments, bound to
 * the VERIFIED tenant on every method, and that when the injected guard answers
 * "deny" the handler early-returns, writes no response, calls no registry port
 * and issues no store read. Every one of those properties is real and is kept.
 *
 * What `piWs4b` structurally CANNOT host is the enforcement question, because
 * no role, no membership row, no principal and no capability set exists in that
 * file: its "ordinary member" is a mock told to say no. A guard that was never
 * asked to decide cannot prove that an ordinary member would be denied — only
 * that the handler obeys a denial it is handed.
 *
 * THIS suite answers the enforcement question. Nothing in the authorization
 * chain is mocked: `resolvePrincipal` (IdentityResolver) -> `resolveUserCapabilities`
 * (CapabilityService) -> `capabilitiesForRole` (capabilityRegistry) ->
 * `requireTenantAccess` (TenantGuard, including the real `rbacService`
 * platform-super-admin read) -> `requireCapability` -> `decideCapability`
 * (AuthorizationService, CPG-060 per-organisation check) all run for real,
 * against seeded membership rows, through the two real route handlers. Only I/O
 * is replaced: the two database seams, the identity lookup, the session lookup,
 * the legacy cookie bridge, the audit sink, the logger and the route wrapper.
 *
 * In one sentence: `piWs4b` proves the routes STOP when a guard says stop; this
 * file proves the guards SAY STOP for an ordinary member of the tenant, and say
 * yes for its administrator.
 *
 * ─── WHAT IS DELIBERATELY NOT RE-PROVEN HERE ─────────────────────────────
 * `crossOrganizationCapabilityScope.test.ts` already drives
 * `decideCapability` / `capabilitiesForRole` / `holdsCapabilityInOrganization`
 * exhaustively, and its `TENANT_ADMIN_ONLY` set already includes
 * `PROSPECT_INGEST`. Its end-to-end 403 through a real handler, however, uses
 * `PROSPECT_ICP_MANAGE` on `/api/prospect-icp/ratify` and `/api/team/self-joined`.
 * This file closes exactly that gap: `PROSPECT_INGEST`, on THESE four surfaces.
 * The capability-layer facts are cited, not duplicated.
 *
 * ─── THE POSITIVE CONTROL IS LOAD-BEARING ────────────────────────────────
 * A suite that only asserts denials passes just as well when the routes are
 * broken, unreachable, or deny everyone. So a COMPANY_ADMIN of the same tenant
 * is driven through the same four surfaces and must be ALLOWED, with the
 * registry port called exactly once.
 */

// Module scope, not script scope: without this the file's top-level helpers
// collide with identically named globals in sibling test files.
export {};

import type { NextApiRequest, NextApiResponse } from 'next';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures. Declared before the mock factories only for readability — the
// factories below close over the bindings and never touch them at factory
// time, so there is no temporal-dead-zone problem.
// ═══════════════════════════════════════════════════════════════════════════

const ORG_A = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ORG_B = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';

const VIEWER = 'u-viewer';
const ARCHITECT = 'u-architect';
const PUBLISHER = 'u-publisher';
const REVIEWER = 'u-reviewer';
const CREATOR = 'u-creator';
const ADMIN = 'u-admin';
const OTHER_ADMIN = 'u-other-admin';
const LAPSED_ADMIN = 'u-lapsed-admin';

/**
 * The five canonical roles that are NOT an administrator of a tenant.
 * `capabilityRegistry.CanonicalRole` has exactly seven members; the other two
 * are COMPANY_ADMIN and SUPER_ADMIN, and both are asserted as holders below.
 */
const ORDINARY_MEMBERS: ReadonlyArray<readonly [string, string]> = [
  [VIEWER, 'VIEW_ONLY'],
  [ARCHITECT, 'CONTENT_ARCHITECT'],
  [PUBLISHER, 'CONTENT_PUBLISHER'],
  [REVIEWER, 'CONTENT_REVIEWER'],
  [CREATOR, 'CONTENT_CREATOR'],
];

type Row = Record<string, unknown>;

const roleRow = (user_id: string, company_id: string, role: string, status = 'active'): Row =>
  ({ id: `${user_id}:${company_id}:${role}`, user_id, company_id, role, status });

const ROLE_ROWS: Row[] = [
  ...ORDINARY_MEMBERS.map(([user, role]) => roleRow(user, ORG_A, role)),
  roleRow(ADMIN, ORG_A, 'COMPANY_ADMIN'),
  roleRow(OTHER_ADMIN, ORG_B, 'COMPANY_ADMIN'),
  // One row only, and it is not active. "An inactive membership grants nothing"
  // has to be tested with nothing else standing in for it.
  roleRow(LAPSED_ADMIN, ORG_A, 'COMPANY_ADMIN', 'inactive'),
];

/** Both tenants exist and are active, so a refusal is never an org-status artefact. */
const COMPANY_ROWS: Row[] = [
  { id: ORG_A, status: 'active' },
  { id: ORG_B, status: 'active' },
];

// The engagement store the candidate path reads. Shaped exactly as the real
// relations are: a thread carries the tenant, a message carries the thread, and
// the author row is the ONLY place the identity pair lives.
const THREAD_A = '11111111-1111-4111-8111-111111111111';
const THREAD_B = '22222222-2222-4222-8222-222222222222';
const AUTHOR_OK = 'aaaaaaaa-0001-4000-8000-000000000001';
const ENTRY_ID = 'dddddddd-0001-4000-8000-000000000001';
const OK_IDENTITY = 'https://www.linkedin.com/in/Dana-Okonkwo-7A1/';

const ENGAGEMENT_ROWS: Record<string, Row[]> = {
  engagement_threads: [
    { id: THREAD_A, platform: 'linkedin', organization_id: ORG_A },
    { id: THREAD_B, platform: 'linkedin', organization_id: ORG_B },
  ],
  engagement_messages: [
    { id: 'm-1', thread_id: THREAD_A, author_id: AUTHOR_OK, platform_created_at: '2026-09-10T09:00:00.000Z' },
    { id: 'm-2', thread_id: THREAD_A, author_id: AUTHOR_OK, platform_created_at: '2026-09-12T09:00:00.000Z' },
  ],
  engagement_authors: [
    { id: AUTHOR_OK, platform: 'linkedin', platform_user_id: OK_IDENTITY },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Seam 1 — `db/supabaseClient`, the chain's own reads: memberships, capability
// assignments and organisation status. A query builder over in-memory rows,
// the shape `crossOrganizationCapabilityScope.test.ts` established.
// ═══════════════════════════════════════════════════════════════════════════

const supaTables: Record<string, Row[]> = {};
/** Every mutation attempted through this seam. Asserted EMPTY, positively. */
const supaWrites: { table: string; op: string }[] = [];

function supaBuilder(table: string) {
  let rows = [...(supaTables[table] ?? [])];
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, gt: chain, lt: chain, gte: chain, lte: chain, neq: chain, range: chain,
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return b; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return b; },
    limit: (n: number) => { rows = rows.slice(0, n); return b; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } }),
    update: () => { supaWrites.push({ table, op: 'update' }); return b; },
    delete: () => { supaWrites.push({ table, op: 'delete' }); return b; },
    insert: () => { supaWrites.push({ table, op: 'insert' }); return b; },
    upsert: () => { supaWrites.push({ table, op: 'upsert' }); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  });
  return b;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => supaBuilder(t),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'redacted@example.test' } } }) } },
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Seam 2 — `db/writeOwner`. Two REAL consumers run through it here: the
// candidate service's engagement reads, and `rbacService`'s
// platform-super-admin probe inside `requireTenantAccess`. It records every
// mutation so "no write was recorded" can be asserted as an empty list rather
// than as the absence of an assertion.
// ═══════════════════════════════════════════════════════════════════════════

interface Mutation { table: string; op: 'insert' | 'update' | 'upsert' | 'delete' }
interface ReadTrace { table: string; filters: Array<{ col: string; val?: unknown; vals?: unknown[] }> }

class OwnedStore {
  readonly mutations: Mutation[] = [];
  readonly reads: ReadTrace[] = [];

  constructor(private readonly data: Record<string, Row[]>) {}

  table(table: string): unknown {
    const trace: ReadTrace = { table, filters: [] };
    this.reads.push(trace);
    let rows = [...(this.data[table] ?? [])];
    const mutate = (op: Mutation['op']) => { this.mutations.push({ table, op }); return b; };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    Object.assign(b, {
      select: chain,
      order: chain,
      eq: (col: string, val: unknown) => {
        trace.filters.push({ col, val });
        rows = rows.filter((r) => (r[col] ?? null) === (val ?? null));
        return b;
      },
      is: (col: string, val: unknown) => {
        trace.filters.push({ col, val });
        rows = rows.filter((r) => (r[col] ?? null) === (val ?? null));
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        trace.filters.push({ col, vals: [...vals] });
        rows = rows.filter((r) => vals.includes(r[col]));
        return b;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return b; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: () => mutate('insert'),
      update: () => mutate('update'),
      upsert: () => mutate('upsert'),
      delete: () => mutate('delete'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(res, rej),
    });
    return b;
  }
}

let store: OwnedStore;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => store.table(table),
  ownedDbRpc: () => { throw new Error('WS-4D reads only — no rpc'); },
}));

// ═══════════════════════════════════════════════════════════════════════════
// Seams 3..8 — identity, session, bridge, audit, logger, user projection and
// the route wrapper. Exactly the set `crossOrganizationCapabilityScope` replaces
// so that the authorization chain itself can stay real.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers: Record<string, string> }) => {
    const id = req.headers['x-test-user'];
    return id
      ? { user: { id, supabaseUid: `sb-${id}`, email: `${id}@example.test`, emailVerified: true }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
  extractAccessToken: () => 'tok',
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  resolveSessionFromRequest: async () => ({ ok: false, reason: 'NO_SESSION' }),
  touchSession: async () => undefined,
}));
jest.mock('../../security/legacyCookieSuperAdminBridge', () => ({
  resolveLegacyCookieSuperAdminPrincipal: async () => null,
}));
const auditTrail: Record<string, unknown>[] = [];
jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: async (e: Record<string, unknown>) => { auditTrail.push(e); },
  snapshotFromPrincipal: () => ({}),
}));
jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/userColumnProjection', () => ({ tolerantUserSelect: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import { resolvePrincipal } from '../../security/IdentityResolver';
import { capabilitiesForRole } from '../../security/capabilityRegistry';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
import candidatesHandler from '../../../pages/api/prospect-identity/owned-identity-candidates';
import identitiesHandler, {
  __setOwnedIdentityRegistryPorts,
} from '../../../pages/api/prospect-identity/owned-identities';

// ═══════════════════════════════════════════════════════════════════════════
// The registry port. Spies, so "never called" is observable; the enforcement
// under test is whether the handler ever gets this far.
// ═══════════════════════════════════════════════════════════════════════════

const attestIdentity = jest.fn();
const revokeIdentity = jest.fn();
const listActiveAttestedIdentities = jest.fn();

const noPortCall = () => {
  expect(attestIdentity).not.toHaveBeenCalled();
  expect(revokeIdentity).not.toHaveBeenCalled();
  expect(listActiveAttestedIdentities).not.toHaveBeenCalled();
};

/** Positively: the mutation lists are EMPTY, on both database seams. */
const noWriteRecorded = () => {
  expect(store.mutations).toEqual([]);
  expect(supaWrites).toEqual([]);
};

beforeEach(() => {
  for (const k of Object.keys(supaTables)) delete supaTables[k];
  supaTables.user_company_roles = ROLE_ROWS;
  // EMPTY on purpose: every allow below must come from a ROLE, never from an
  // explicit grant. An assignment row here would make the admin control pass
  // for a reason the product does not rely on.
  supaTables.capability_assignments = [];
  supaTables.companies = COMPANY_ROWS;
  supaTables.users = [];
  supaWrites.length = 0;
  auditTrail.length = 0;

  // `user_company_roles` is seeded on this seam too: `rbacService`'s
  // platform-super-admin probe reads it through `ownedDbTable`, and it must
  // find no SUPER_ADMIN row — otherwise the tenant guard would bypass.
  store = new OwnedStore({ ...ENGAGEMENT_ROWS, user_company_roles: ROLE_ROWS });

  attestIdentity.mockResolvedValue({ ok: true, id: ENTRY_ID, alreadyActive: false });
  revokeIdentity.mockResolvedValue({ ok: true, revoked: true });
  listActiveAttestedIdentities.mockResolvedValue([{
    id: ENTRY_ID,
    organizationId: ORG_A,
    platform: 'linkedin',
    platformUserId: OK_IDENTITY,
    attestedAs: 'tenant_own',
    statement: 'our founder account',
    attestedByUserId: ADMIN,
    attestedAt: '2026-10-01T10:00:00.000Z',
    revokedAt: null,
    revokedByUserId: null,
    revokedReason: null,
  }]);
  __setOwnedIdentityRegistryPorts({
    attestIdentity: (...a: unknown[]) => attestIdentity(...a),
    revokeIdentity: (...a: unknown[]) => revokeIdentity(...a),
    listActiveAttestedIdentities: (...a: unknown[]) => listActiveAttestedIdentities(...a),
  } as never);
});

afterAll(() => { __setOwnedIdentityRegistryPorts(null); });

// ═══════════════════════════════════════════════════════════════════════════
// Harness.
// ═══════════════════════════════════════════════════════════════════════════

interface Answer {
  statusCode: number;
  body: Record<string, unknown> | undefined;
  headers: Record<string, unknown>;
}

function makeRes(): Answer {
  const r: Answer & Record<string, unknown> = { statusCode: 0, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b as Record<string, unknown>; return r; };
  r.setHeader = (k: string, v: unknown) => { r.headers[k] = v; return r; };
  r.end = () => r;
  return r;
}

const makeReq = (user: string, over: Record<string, unknown> = {}): NextApiRequest => ({
  method: 'GET',
  url: '/api/test',
  headers: { 'x-test-user': user, 'user-agent': 'ws4d-suite' },
  query: { companyId: ORG_A },
  body: undefined,
  socket: {},
  ...over,
} as unknown as NextApiRequest);

const run = async (handler: unknown, req: NextApiRequest): Promise<Answer> => {
  const res = makeRes();
  await (handler as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res as never);
  return res;
};

const STATEMENT = 'this is our founder own LinkedIn account, used for outbound';

const registryList = (user: string, org = ORG_A) =>
  run(identitiesHandler, makeReq(user, { method: 'GET', query: { companyId: org } }));

const registryAttest = (user: string, org = ORG_A) =>
  run(identitiesHandler, makeReq(user, {
    method: 'POST',
    query: { companyId: org },
    body: { candidateAuthorId: AUTHOR_OK, statement: STATEMENT, confirmed: true },
  }));

const registryRevoke = (user: string, org = ORG_A) =>
  run(identitiesHandler, makeReq(user, {
    method: 'DELETE',
    query: { companyId: org, id: ENTRY_ID, reason: 'the account was closed' },
  }));

const candidateList = (user: string, org = ORG_A) =>
  run(candidatesHandler, makeReq(user, { method: 'GET', query: { companyId: org } }));

/** The four surfaces this control plane exposes, with the allowed status each answers. */
const SURFACES: ReadonlyArray<readonly [string, (user: string, org?: string) => Promise<Answer>, number]> = [
  ['GET /api/prospect-identity/owned-identities', registryList, 200],
  ['POST /api/prospect-identity/owned-identities', registryAttest, 201],
  ['DELETE /api/prospect-identity/owned-identities', registryRevoke, 200],
  ['GET /api/prospect-identity/owned-identity-candidates', candidateList, 200],
];

// ═══════════════════════════════════════════════════════════════════════════
// 1 · PRECONDITIONS — the seeded world really is the one the claim needs
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4D preconditions · the ordinary members ARE members, and hold the capability nowhere', () => {
  it.each(ORDINARY_MEMBERS)(
    '%s is an ACTIVE member of ORG_A whose capability scope there excludes the ingest capability',
    async (user) => {
      const resolved = await resolvePrincipal(makeReq(user));
      expect(resolved.ok).toBe(true);
      if (resolved.ok !== true) return;
      const principal = resolved.principal;
      // Active member — so a 403 below is a CAPABILITY decision, not a
      // membership one. The response code asserted later says which.
      expect(principal.organizations.some(
        (m) => m.organizationId === ORG_A && m.status === 'active',
      )).toBe(true);
      expect(principal.capabilities).not.toContain(PROSPECT_INGEST);
      expect(principal.capabilityScope?.byOrganization[ORG_A] ?? []).not.toContain(PROSPECT_INGEST);
    },
  );

  it('the COMPANY_ADMIN of ORG_A holds the capability IN ORG_A', async () => {
    const resolved = await resolvePrincipal(makeReq(ADMIN));
    expect(resolved.ok).toBe(true);
    if (resolved.ok !== true) return;
    expect(resolved.principal.capabilityScope?.byOrganization[ORG_A]).toContain(PROSPECT_INGEST);
  });

  it('no SUPER_ADMIN row exists, so the tenant guard platform bypass is never taken', () => {
    expect(ROLE_ROWS.some((r) => r.role === 'SUPER_ADMIN')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE CLAIM — an ordinary member of the tenant is REFUSED, and the refusal
//     is the capability decision, on every method of both surfaces
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4D · an ordinary member of the tenant is refused by the real capability decision', () => {
  for (const [name, call] of SURFACES) {
    it.each(ORDINARY_MEMBERS)(`${name} · %s (%s) is refused 403 CAPABILITY_NOT_HELD`, async (user) => {
      const res = await call(user);

      expect(res.statusCode).toBe(403);
      expect(res.body?.code).toBe('CAPABILITY_NOT_HELD');
      // The capability named in the refusal is the one this surface gates on,
      // so a route re-gated on something weaker could not pass this test.
      expect(res.body?.capability).toBe(PROSPECT_INGEST);
      noPortCall();
      noWriteRecorded();
      // Nothing from the registry reached the caller.
      expect(JSON.stringify(res.body ?? {})).not.toContain(OK_IDENTITY);
    });
  }

  it('the refusal is recorded as a denial against the ingest capability', async () => {
    await registryAttest(VIEWER);
    expect(auditTrail.some(
      (e) => e.capability === PROSPECT_INGEST && e.decision === 'denied' && e.organizationId === ORG_A,
    )).toBe(true);
    expect(auditTrail.some((e) => e.decision === 'allowed')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · THE POSITIVE CONTROL — without this, section 2 would also pass against
//     a control plane that refused everyone
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4D · the COMPANY_ADMIN of the same tenant is allowed, and the port is reached once', () => {
  it('GET owned-identities lists the tenant entries', async () => {
    const res = await registryList(ADMIN);
    expect(res.statusCode).toBe(200);
    expect(listActiveAttestedIdentities).toHaveBeenCalledTimes(1);
    expect(listActiveAttestedIdentities).toHaveBeenCalledWith(ORG_A);
    expect((res.body?.entries as unknown[]).length).toBe(1);
  });

  it('POST owned-identities records the attestation', async () => {
    const res = await registryAttest(ADMIN);
    expect(res.statusCode).toBe(201);
    expect(attestIdentity).toHaveBeenCalledTimes(1);
    expect(attestIdentity).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A,
      platform: 'linkedin',
      platformUserId: OK_IDENTITY,
      attestedByUserId: ADMIN,
    }));
  });

  it('DELETE owned-identities revokes by the entry own uuid', async () => {
    const res = await registryRevoke(ADMIN);
    expect(res.statusCode).toBe(200);
    expect(revokeIdentity).toHaveBeenCalledTimes(1);
    expect(revokeIdentity).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A, id: ENTRY_ID, revokedByUserId: ADMIN,
    }));
  });

  it('GET owned-identity-candidates answers the attestable identity', async () => {
    const res = await candidateList(ADMIN);
    expect(res.statusCode).toBe(200);
    const list = res.body?.candidates as Array<Record<string, unknown>>;
    expect(list.map((c) => c.authorId)).toEqual([AUTHOR_OK]);
    noPortCall();
  });

  it('the whole allowed path still writes nothing through either seam', async () => {
    await registryList(ADMIN);
    await candidateList(ADMIN);
    noWriteRecorded();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · THE OTHER TENANT'S ADMINISTRATOR — `requireTenantAccess`'s job, and
//     unprovable in `piWs4b` where that guard is a `jest.fn`
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4D · a COMPANY_ADMIN of another tenant cannot name this one', () => {
  for (const [name, call] of SURFACES) {
    it(`${name} · ORG_B administrator naming companyId=ORG_A is refused with no port call`, async () => {
      const res = await call(OTHER_ADMIN, ORG_A);

      expect(res.statusCode).toBe(403);
      // The membership guard, not the capability guard: this principal IS an
      // administrator — just not here.
      expect(res.body?.code).toBe('NOT_A_MEMBER');
      noPortCall();
      noWriteRecorded();
    });
  }

  it('the same administrator IS served for their OWN tenant, so the refusal is about the tenant named', async () => {
    const res = await registryList(OTHER_ADMIN, ORG_B);
    expect(res.statusCode).toBe(200);
    expect(listActiveAttestedIdentities).toHaveBeenCalledWith(ORG_B);
    // The ORG_A row the port answers with is dropped by the route's own tenant
    // re-assertion, so ORG_B's administrator is told about nobody else's claims.
    expect(res.body?.entries).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · AN INACTIVE MEMBERSHIP GRANTS NOTHING
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4D · an inactive COMPANY_ADMIN row grants nothing', () => {
  for (const [name, call] of SURFACES) {
    it(`${name} · the lapsed administrator is refused with no port call`, async () => {
      const res = await call(LAPSED_ADMIN, ORG_A);

      expect(res.statusCode).toBe(403);
      expect(res.body?.code).toBe('STALE_MEMBERSHIP');
      noPortCall();
      noWriteRecorded();
    });
  }

  it('the inactive row contributes no capability either, so both layers refuse independently', async () => {
    const resolved = await resolvePrincipal(makeReq(LAPSED_ADMIN));
    expect(resolved.ok).toBe(true);
    if (resolved.ok !== true) return;
    expect(resolved.principal.capabilities).not.toContain(PROSPECT_INGEST);
    expect(resolved.principal.capabilityScope?.byOrganization[ORG_A] ?? []).not.toContain(PROSPECT_INGEST);
    expect(resolved.principal.organizations.some(
      (m) => m.organizationId === ORG_A && m.status === 'active',
    )).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · THE REGISTRY IS WHERE THE GRANT COMES FROM
//
// Cited, not re-derived: `crossOrganizationCapabilityScope.test.ts` proves the
// per-organisation semantics of this capability at the `decideCapability` layer
// (its `TENANT_ADMIN_ONLY` set includes it). The two assertions here only pin
// WHICH roles hold it, because that is the fact the four surfaces above depend
// on and the one a future role edit would silently change.
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4D · the ingest capability is held by tenant and platform administrators only', () => {
  it('no ordinary role holds it; COMPANY_ADMIN and SUPER_ADMIN do', () => {
    for (const [, role] of ORDINARY_MEMBERS) {
      expect(capabilitiesForRole(role)).not.toContain(PROSPECT_INGEST);
    }
    expect(capabilitiesForRole('COMPANY_ADMIN')).toContain(PROSPECT_INGEST);
    expect(capabilitiesForRole('SUPER_ADMIN')).toContain(PROSPECT_INGEST);
  });
});
