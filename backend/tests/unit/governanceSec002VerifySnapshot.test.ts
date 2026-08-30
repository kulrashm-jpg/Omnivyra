/**
 * GOVERNANCE-SEC-002 — GET /api/governance/verify-snapshot.
 *
 * The snapshot was selected by `id` alone, with no tenant predicate:
 *
 *     req.query.snapshotId
 *       -> verifySnapshotIntegrity(snapshotId)
 *       -> ownedDbTable('governance_snapshots').eq('id', snapshotId)
 *
 * Roles are [COMPANY_ADMIN, SUPER_ADMIN], so a COMPANY_ADMIN of one company
 * could verify another company's snapshot and could tell an existing-but-invalid
 * snapshot from an absent one.
 *
 * The fix passes the company withRBAC authorized into the service, where it
 * becomes part of the QUERY. A foreign snapshot is therefore never read — its
 * contents are never touched — and it answers exactly as a nonexistent id does,
 * which closes the oracle without inventing a new error shape. SUPER_ADMIN
 * passes null and keeps platform-wide verification.
 *
 * The REAL chain runs here: withRBAC -> enforceRole -> getUserRole -> handler ->
 * the service's own query. Only the data layer and auth seam are mocked, and the
 * assertions inspect the predicate the snapshot query actually carried.
 */

import { Role } from '../../services/rbacService';

const ADMIN_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
const SNAP_A = 'sa000000-0000-0000-0000-00000000000a';
const SNAP_VICTIM = 'sb000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
];

/** Snapshot rows, each owned by a company. The victim's is deliberately INVALID
 *  (its summary counts disagree) so that "valid:false + mismatchFields" would be
 *  visibly different from "not found" if the boundary ever leaked. */
const SNAPSHOTS: Record<string, any> = {
  [SNAP_A]: {
    id: SNAP_A, company_id: COMPANY_A, policy_hash: 'HASH',
    snapshot_data: { summary: { eventCount: 0, auditCount: 0, policyHash: 'HASH' },
                     campaign_governance_events: [], governance_audit_runs: [] },
  },
  [SNAP_VICTIM]: {
    id: SNAP_VICTIM, company_id: VICTIM, policy_hash: 'OTHER',
    snapshot_data: { summary: { eventCount: 9, auditCount: 9, policyHash: 'DIFFERENT' },
                     campaign_governance_events: [], governance_audit_runs: [] },
  },
};

let authUser: string | null = ADMIN_A;

/** Every query, with the predicates it carried. */
const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: unknown }> = [];

const snapshotQueries = () => queries.filter(q => q.table === 'governance_snapshots');

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser, email: 'u@e.com', emailVerified: true }, error: null }
             : { user: null, error: 'MISSING_AUTH' }),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b; b.limit = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'governance_snapshots') {
        const row = SNAPSHOTS[String(filters.id)];
        if (!row) return [];
        // Honour the tenant predicate exactly: this is what makes a foreign
        // snapshot fall through to "not found" instead of being read.
        if (filters.company_id !== undefined && filters.company_id !== row.company_id) return [];
        return [row];
      }
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: r.data.length ? null : { message: 'no rows' } }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

// The service imports the hash from governance/GovernancePolicy — an earlier
// draft mocked GovernancePolicyRegistry, so the real hash ran and a valid
// fixture reported a mismatch. Mock the module actually imported.
jest.mock('../../governance/GovernancePolicy', () => ({
  GOVERNANCE_POLICY_VERSION: 'v1',
  getGovernancePolicyHash: jest.fn(() => 'HASH'),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/governance/verify-snapshot';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
/**
 * withRBAC resolves `req.query.companyId || req.body.companyId` and enforceRole
 * answers 400 without one, so a companyId must be present to reach the handler
 * at all. Tests therefore name the caller's OWN company by default — which is
 * also the only shape that can reach the handler in production, and precisely
 * the shape the exploit used: authorize for your own company, then name another
 * company's snapshotId.
 */
async function call(as: string | null, query: Record<string, unknown>, method = 'GET') {
  authUser = as;
  const res = mockRes();
  const q = { companyId: COMPANY_A, ...query };
  await handler({ method, url: '/api/governance/verify-snapshot', query: q, body: {}, headers: {} } as never, res);
  return res;
}

/** Nothing about the victim's snapshot leaked. */
function noVictimLeak(body: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain('summaryPolicyHash');
  expect(blob).not.toContain('eventCount');
  expect(blob).not.toContain('auditCount');
  expect(blob).not.toContain(VICTIM);
}

beforeEach(() => {
  authUser = ADMIN_A;
  queries.length = 0; writes.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

/* ── authentication ───────────────────────────────────────────────────── */

describe('authentication', () => {
  it('unauthenticated → 401 and the snapshot table is never queried', async () => {
    const res = await call(null, { snapshotId: SNAP_VICTIM });
    expect(res.statusCode).toBe(401);
    expect(snapshotQueries()).toEqual([]);
  });

  it('invalid authentication is refused the same way', async () => {
    const res = await call(null, { snapshotId: SNAP_A });
    expect(res.statusCode).toBe(401);
    expect(snapshotQueries()).toEqual([]);
  });
});

/* ── ownership ────────────────────────────────────────────────────────── */

describe('ownership', () => {
  it('a COMPANY_ADMIN can still verify their OWN company snapshot', async () => {
    const res = await call(ADMIN_A, { snapshotId: SNAP_A });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ valid: true, mismatchFields: undefined });
  });

  it('CRITICAL: a foreign snapshot cannot be verified', async () => {
    const res = await call(ADMIN_A, { snapshotId: SNAP_VICTIM });
    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.mismatchFields).toEqual(['snapshot_not_found']);
    noVictimLeak(res.body);
  });

  it('CRITICAL: the foreign snapshot is never READ — the query carries the tenant predicate', async () => {
    // This is the ordering guarantee. The company constraint is part of the
    // query, so the row never matches and its contents are never loaded. A
    // version that read by id and compared afterwards would fail here.
    await call(ADMIN_A, { snapshotId: SNAP_VICTIM });
    const q = snapshotQueries();
    expect(q).toHaveLength(1);
    expect(q[0].filters.company_id).toBe(COMPANY_A);
    expect(q[0].filters.id).toBe(SNAP_VICTIM);
  });

  it('CRITICAL: every snapshot query by a non-super-admin is tenant-scoped', async () => {
    await call(ADMIN_A, { snapshotId: SNAP_A });
    await call(ADMIN_A, { snapshotId: SNAP_VICTIM });
    for (const q of snapshotQueries()) {
      expect(q.filters.company_id).toBe(COMPANY_A);
    }
  });
});

/* ── the existence oracle ─────────────────────────────────────────────── */

describe('the existence oracle is closed', () => {
  it('CRITICAL: a foreign snapshot is indistinguishable from a nonexistent one', async () => {
    // Before the fix these differed: the victim's snapshot is deliberately
    // INVALID, so it would have answered valid:false with real mismatchFields,
    // while an absent id answers 'snapshot_not_found'.
    const foreign = await call(ADMIN_A, { snapshotId: SNAP_VICTIM });
    const missing = await call(ADMIN_A, { snapshotId: 'ff000000-0000-0000-0000-0000000000ff' });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toEqual(missing.body);
  });

  it('the victim’s real mismatch fields are never disclosed', async () => {
    const res = await call(ADMIN_A, { snapshotId: SNAP_VICTIM });
    // The victim snapshot's genuine verdict would include these; it must not.
    expect(res.body.mismatchFields).not.toContain('policyHash');
    expect(res.body.mismatchFields).not.toContain('summaryPolicyHash');
    noVictimLeak(res.body);
  });
});

/* ── super-admin ──────────────────────────────────────────────────────── */

describe('SUPER_ADMIN behaviour is preserved', () => {
  it('a super admin still verifies any company snapshot', async () => {
    const res = await call(SUPERADMIN, { snapshotId: SNAP_VICTIM });
    expect(res.statusCode).toBe(200);
    // The victim snapshot is genuinely inconsistent, so a real verdict comes back.
    expect(res.body.valid).toBe(false);
    expect(res.body.mismatchFields).not.toEqual(['snapshot_not_found']);
  });

  it('the super-admin query carries NO tenant predicate', async () => {
    await call(SUPERADMIN, { snapshotId: SNAP_VICTIM });
    expect(snapshotQueries()[0].filters.company_id).toBeUndefined();
  });
});

/* ── selectors and input handling ─────────────────────────────────────── */

describe('selector handling', () => {
  it('a caller-supplied company field cannot override server-owned ownership', async () => {
    const res = await call(ADMIN_A, { snapshotId: SNAP_VICTIM, companyId: VICTIM, company_id: VICTIM });
    // companyId is what withRBAC authorizes against; the caller holds no role in
    // VICTIM, so the role check refuses before the handler ever runs.
    // companyId in the query is what withRBAC authorizes against — the caller
    // holds no role in VICTIM, so the role check refuses before the handler.
    expect(res.statusCode).toBe(403);
    expect(snapshotQueries()).toEqual([]);
  });

  it('a malformed snapshotId reaches no snapshot content', async () => {
    const res = await call(ADMIN_A, { snapshotId: "x' OR 1=1--" });
    expect(res.statusCode).toBe(200);
    expect(res.body.mismatchFields).toEqual(['snapshot_not_found']);
  });

  it('a missing snapshotId is rejected before any query', async () => {
    const res = await call(ADMIN_A, {});
    expect(res.statusCode).toBe(400);
    expect(snapshotQueries()).toEqual([]);
  });

  it('a non-GET verb reaches nothing', async () => {
    const res = await call(ADMIN_A, { snapshotId: SNAP_A }, 'POST');
    expect(res.statusCode).toBe(405);
    expect(snapshotQueries()).toEqual([]);
  });
});

/* ── read-only ────────────────────────────────────────────────────────── */

describe('the route is read-only', () => {
  it('no path writes anything', async () => {
    await call(ADMIN_A, { snapshotId: SNAP_A });
    await call(ADMIN_A, { snapshotId: SNAP_VICTIM });
    await call(SUPERADMIN, { snapshotId: SNAP_VICTIM });
    await call(null, { snapshotId: SNAP_A });
    expect(writes).toEqual([]);
  });
});
