/**
 * B1b — the authority declaration route, INVOKED.
 *
 * A source-shape assertion cannot see what a handler does with a request, and
 * this route's whole job is to decide what a request is allowed to do. So this
 * suite calls the handler.
 *
 * What is REAL here: the route, the store (its validation, its normalisation,
 * its refusal vocabulary) and the composition of membership-then-administration.
 * What is doubled: the request principal, the role directory and the database.
 * That seam is chosen so the tests exercise the actual authorization decision
 * rather than a restatement of it.
 *
 * Both doubles model the dimension under test. The guard is MEMBERSHIP- and
 * TENANT-sensitive, so a guard that waved every tenant through could not pass;
 * the role directory is keyed on (user, tenant), so an administrator of one
 * tenant is genuinely a stranger in another. A double that ignored either
 * dimension would make the cross-tenant tests vacuous, which is the failure
 * mode this programme has already been bitten by.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// ── the request principal ─────────────────────────────────────────────────
type Session = { userId: string; memberOf: string[]; bridge?: boolean } | null;
const session: { current: Session } = { current: null };

/**
 * A stand-in for TenantGuard that answers the same three questions in the same
 * order, writes the same statuses, and returns the VERIFIED tenant id.
 */
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: async (
    _req: unknown, res: { status: (c: number) => { json: (b: unknown) => unknown } },
    organizationId: string | null | undefined,
  ) => {
    const s = session.current;
    if (!s) { res.status(401).json({ error: 'Not authenticated', code: 'NO_AUTH' }); return null; }
    if (s.bridge) {
      res.status(403).json({ error: 'Tenant operations require a real user session', code: 'BRIDGE_NOT_TENANT' });
      return null;
    }
    if (!organizationId) { res.status(400).json({ error: 'organizationId required', code: 'NO_ORG_ID' }); return null; }
    if (!s.memberOf.includes(organizationId)) {
      res.status(403).json({ error: 'Not a member', code: 'NOT_A_MEMBER' });
      return null;
    }
    return {
      userId: s.userId, supabaseUid: '', organizationId,
      role: 'MEMBER', bypass: false, isPlatformSuperAdmin: false,
    };
  },
}));

// ── the role directory, keyed on (user, tenant) ───────────────────────────
const roles: Record<string, string> = {};
const superAdmins = new Set<string>();
jest.mock('../../services/rbacService', () => ({
  Role: { SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', COMPANY_ADMIN: 'COMPANY_ADMIN' },
  isSuperAdmin: async (userId: string) => superAdmins.has(userId),
  getUserRole: async (userId: string, companyId: string) => ({
    role: roles[`${userId}|${companyId}`] ?? null, error: null,
  }),
}));
jest.mock('../../services/rbacPrimitives', () => ({
  normalizePermissionRole: (role: string) => (role === 'ADMIN' ? 'COMPANY_ADMIN' : role),
}));

// ── the database ──────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const db = {
  rows: [] as Row[],
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
  deletes: [] as Array<{ filters: Array<[string, unknown]> }>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const st = {
      op: 'select' as 'select' | 'upsert' | 'delete',
      filters: [] as Array<[string, unknown]>,
      payload: null as Row | null, onConflict: undefined as string | undefined,
    };
    const key = (r: Row) => `${r.organization_id}|${r.entity_type}|${r.attribute}`;
    const exec = async (mode: 'many' | 'single') => {
      await Promise.resolve();
      if (st.op === 'upsert') {
        if (db.writeError) return { data: null, error: db.writeError };
        const payload = st.payload as Row;
        const i = db.rows.findIndex((r) => key(r) === key(payload));
        if (i >= 0) db.rows[i] = { ...db.rows[i], ...payload }; else db.rows.push({ ...payload });
        return { data: payload, error: null };
      }
      if (st.op === 'delete') {
        db.deletes.push({ filters: st.filters });
        if (db.writeError) return { data: null, error: db.writeError };
        db.rows = db.rows.filter((r) => !st.filters.every(([c, v]) => r[c] === v));
        return { data: null, error: null };
      }
      if (db.readError) return { data: null, error: db.readError };
      const found = db.rows.filter((r) => st.filters.every(([c, v]) => r[c] === v));
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      upsert: (p: Row, o?: { onConflict?: string }) => { st.op = 'upsert'; st.payload = p; st.onConflict = o?.onConflict; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      single: () => exec('single'),
      maybeSingle: () => exec('single'),
      then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => exec('many').then(r, j),
    };
    return b;
  },
}));

jest.mock('../../services/logger', () => ({
  logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
}));

import handler from '../../../pages/api/prospect-identity/authority';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const ADMIN_A = 'user-admin-a';
const ADMIN_B = 'user-admin-b';
const MEMBER_A = 'user-member-a';
const ROOT = 'user-super';

function makeRes() {
  const res: Record<string, unknown> = { _status: 0, _json: null, _headers: {} };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (b: unknown) => { res._json = b; return res; };
  res.setHeader = (k: string, v: unknown) => { (res._headers as Row)[k] = v; return res; };
  res.end = () => res;
  return res as unknown as NextApiResponse & { _status: number; _json: any };
}

const call = async (
  method: string, query: Record<string, unknown> = {}, body: unknown = undefined,
) => {
  const res = makeRes();
  await handler({ method, query, body, headers: {} } as unknown as NextApiRequest, res);
  return res;
};

const asAdminA = () => { session.current = { userId: ADMIN_A, memberOf: [ORG_A] }; };
const asAdminB = () => { session.current = { userId: ADMIN_B, memberOf: [ORG_B] }; };
const asMemberA = () => { session.current = { userId: MEMBER_A, memberOf: [ORG_A] }; };

const seedDeclaration = (org: string, entity: string, attribute: string, providers: string[]) => {
  db.rows.push({
    organization_id: org, entity_type: entity, attribute,
    authoritative_providers: providers, declared_by_user_id: 'seed', updated_at: null,
  });
};

beforeEach(() => {
  db.rows = []; db.readError = null; db.writeError = null; db.deletes = [];
  for (const k of Object.keys(roles)) delete roles[k];
  superAdmins.clear();
  session.current = null;

  roles[`${ADMIN_A}|${ORG_A}`] = 'COMPANY_ADMIN';
  roles[`${ADMIN_B}|${ORG_B}`] = 'COMPANY_ADMIN';
  roles[`${MEMBER_A}|${ORG_A}`] = 'CONTENT_CREATOR';
  superAdmins.add(ROOT);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('method dispatch', () => {
  it('refuses anything other than GET, POST and DELETE, before authenticating', async () => {
    for (const m of ['PUT', 'PATCH', 'HEAD', 'OPTIONS']) {
      const res = await call(m, { companyId: ORG_A });
      expect(res._status).toBe(405);
      expect((res as any)._headers.Allow).toBe('GET, POST, DELETE');
    }
  });
});

describe('authentication', () => {
  it('401s an unauthenticated GET, POST and DELETE', async () => {
    session.current = null;
    for (const [m, q, b] of [
      ['GET', { companyId: ORG_A }, undefined],
      ['POST', { companyId: ORG_A }, { entity_type: 'person', attribute: 'job_title', authoritative_providers: ['human'] }],
      ['DELETE', { companyId: ORG_A, entity_type: 'person', attribute: 'job_title' }, undefined],
    ] as const) {
      const res = await call(m, q as Row, b);
      expect(res._status).toBe(401);
    }
    // Nothing reached the store.
    expect(db.rows).toEqual([]);
    expect(db.deletes).toEqual([]);
  });

  it('403s a legacy bridge principal — platform tier has no tenant identity', async () => {
    session.current = { userId: ROOT, memberOf: [ORG_A], bridge: true };
    const res = await call('GET', { companyId: ORG_A });
    expect(res._status).toBe(403);
    expect(res._json.code).toBe('BRIDGE_NOT_TENANT');
  });

  it('refuses a request that names no tenant', async () => {
    asAdminA();
    const res = await call('GET', {});
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('NO_ORG_ID');
  });
});

describe('authorization', () => {
  it('allows a COMPANY_ADMIN of the named tenant', async () => {
    asAdminA();
    const res = await call('GET', { companyId: ORG_A });
    expect(res._status).toBe(200);
  });

  it('allows a SUPER_ADMIN through the existing super-admin semantics', async () => {
    session.current = { userId: ROOT, memberOf: [ORG_A] };
    const res = await call('GET', { companyId: ORG_A });
    expect(res._status).toBe(200);
  });

  it('accepts the legacy ADMIN alias through the existing normalization', async () => {
    roles[`user-legacy|${ORG_A}`] = 'ADMIN';
    session.current = { userId: 'user-legacy', memberOf: [ORG_A] };
    expect((await call('GET', { companyId: ORG_A }))._status).toBe(200);
  });

  it('403s an ordinary MEMBER on read and on write', async () => {
    asMemberA();
    expect((await call('GET', { companyId: ORG_A }))._status).toBe(403);
    const post = await call('POST', { companyId: ORG_A },
      { entity_type: 'person', attribute: 'job_title', authoritative_providers: ['human'] });
    expect(post._status).toBe(403);
    expect(post._json.error).toBe('AUTHORITY_ADMIN_REQUIRED');
    expect((await call('DELETE', { companyId: ORG_A, entity_type: 'person', attribute: 'job_title' }))._status).toBe(403);
    expect(db.rows).toEqual([]);
    expect(db.deletes).toEqual([]);
  });

  it('403s an administrator whose role row is gone', async () => {
    // Membership without an administrator role: the guard passes, the store
    // refuses. Two different questions, which is why both are asked.
    delete roles[`${ADMIN_A}|${ORG_A}`];
    asAdminA();
    expect((await call('GET', { companyId: ORG_A }))._status).toBe(403);
  });
});

describe('tenant isolation', () => {
  it('tenant A admin cannot GET tenant B declarations', async () => {
    seedDeclaration(ORG_B, 'person', 'job_title', ['human']);
    asAdminA();
    const res = await call('GET', { companyId: ORG_B });
    expect(res._status).toBe(403);
    expect(res._json.code).toBe('NOT_A_MEMBER');
  });

  it('tenant A admin cannot POST a tenant B declaration', async () => {
    asAdminA();
    const res = await call('POST', { companyId: ORG_B },
      { entity_type: 'person', attribute: 'job_title', authoritative_providers: ['human'] });
    expect(res._status).toBe(403);
    expect(db.rows).toEqual([]);
  });

  it('tenant A admin cannot DELETE a tenant B declaration', async () => {
    seedDeclaration(ORG_B, 'person', 'job_title', ['human']);
    asAdminA();
    const res = await call('DELETE', { companyId: ORG_B, entity_type: 'person', attribute: 'job_title' });
    expect(res._status).toBe(403);
    expect(db.rows).toHaveLength(1);
    expect(db.deletes).toEqual([]);
  });

  it('and tenant B admin cannot do any of it against tenant A', async () => {
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    asAdminB();
    expect((await call('GET', { companyId: ORG_A }))._status).toBe(403);
    expect((await call('POST', { companyId: ORG_A },
      { entity_type: 'person', attribute: 'job_title', authoritative_providers: ['apollo'] }))._status).toBe(403);
    expect((await call('DELETE', { companyId: ORG_A, entity_type: 'person', attribute: 'job_title' }))._status).toBe(403);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].authoritative_providers).toEqual(['human']);
  });

  it('a GET returns ONLY the authenticated tenant declarations', async () => {
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    seedDeclaration(ORG_B, 'person', 'job_title', ['apollo']);
    asAdminA();
    const res = await call('GET', { companyId: ORG_A });
    expect(res._status).toBe(200);
    expect(res._json.declarations).toHaveLength(1);
    expect(res._json.declarations[0]).toMatchObject({ organizationId: ORG_A, providers: ['human'] });
  });

  it('a repeated companyId parameter cannot smuggle a second tenant', async () => {
    // The first value is what the guard verifies, and the VERIFIED id is the
    // only one used afterwards — so the two cannot diverge.
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    asAdminA();
    const res = await call('GET', { companyId: [ORG_A, ORG_B] });
    expect(res._status).toBe(200);
    expect(res._json.declarations.every((d: any) => d.organizationId === ORG_A)).toBe(true);
  });

  it('a body-supplied organization id is ignored entirely', async () => {
    asAdminA();
    const res = await call('POST', { companyId: ORG_A }, {
      organizationId: ORG_B, organization_id: ORG_B, companyId: ORG_B,
      entity_type: 'person', attribute: 'job_title', authoritative_providers: ['human'],
    });
    expect(res._status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].organization_id).toBe(ORG_A);
  });
});

describe('GET', () => {
  it('reports every scope when none is named', async () => {
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    seedDeclaration(ORG_A, 'account', 'industry', ['apollo']);
    seedDeclaration(ORG_A, 'relationship', 'department', ['human']);
    asAdminA();
    const res = await call('GET', { companyId: ORG_A });
    expect(res._json.declarations).toHaveLength(3);
  });

  it('filters by scope when one is named', async () => {
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    seedDeclaration(ORG_A, 'relationship', 'job_title', ['apollo']);
    asAdminA();
    const res = await call('GET', { companyId: ORG_A, entity_type: 'relationship' });
    expect(res._json.declarations).toHaveLength(1);
    expect(res._json.declarations[0]).toMatchObject({ entityType: 'relationship', providers: ['apollo'] });
  });

  it('400s an unknown scope rather than silently reporting everything', async () => {
    asAdminA();
    const res = await call('GET', { companyId: ORG_A, entity_type: 'prospect' });
    expect(res._status).toBe(400);
    expect(res._json.error).toBe('INVALID_ENTITY_TYPE');
  });

  it('a tenant that declared nothing gets an empty set, not an error', async () => {
    asAdminA();
    const res = await call('GET', { companyId: ORG_A });
    expect(res._status).toBe(200);
    expect(res._json.declarations).toEqual([]);
  });
});

describe('POST', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    entity_type: 'relationship', attribute: 'job_title',
    authoritative_providers: ['human'], ...over,
  });

  it('creates a declaration and records the actor', async () => {
    asAdminA();
    const res = await call('POST', { companyId: ORG_A }, body());
    expect(res._status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      organization_id: ORG_A, entity_type: 'relationship', attribute: 'job_title',
      authoritative_providers: ['human'], declared_by_user_id: ADMIN_A,
    });
  });

  it('replaces the same key idempotently — one row, last write wins', async () => {
    asAdminA();
    await call('POST', { companyId: ORG_A }, body({ authoritative_providers: ['human'] }));
    await call('POST', { companyId: ORG_A }, body({ authoritative_providers: ['apollo'] }));
    await call('POST', { companyId: ORG_A }, body({ authoritative_providers: ['apollo'] }));
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].authoritative_providers).toEqual(['apollo']);
  });

  it('accepts one provider, several providers, and an EMPTY list', async () => {
    asAdminA();
    expect((await call('POST', { companyId: ORG_A }, body({ authoritative_providers: ['human'] })))._status).toBe(200);
    expect((await call('POST', { companyId: ORG_A }, body({ authoritative_providers: ['human', 'apollo'] })))._status).toBe(200);
    expect(db.rows[0].authoritative_providers).toEqual(['human', 'apollo']);
    // Empty is a meaningful declaration — "nothing here is authoritative" —
    // and must not be mistaken for a malformed request.
    expect((await call('POST', { companyId: ORG_A }, body({ authoritative_providers: [] })))._status).toBe(200);
    expect(db.rows[0].authoritative_providers).toEqual([]);
  });

  it('normalises keys through the store contract rather than rejecting them', async () => {
    asAdminA();
    const res = await call('POST', { companyId: ORG_A },
      body({ authoritative_providers: [' Apollo ', 'APOLLO', 'human', '', '   '] }));
    expect(res._status).toBe(200);
    // Trimmed, lower-cased, de-duplicated, blanks dropped — the store's rule,
    // not a second one invented here.
    expect(db.rows[0].authoritative_providers).toEqual(['apollo', 'human']);
  });

  it('400s an invalid scope, a blank attribute and a non-array provider field', async () => {
    asAdminA();
    for (const [over, code] of [
      [{ entity_type: 'prospect' }, 'INVALID_ENTITY_TYPE'],
      [{ entity_type: undefined }, 'INVALID_ENTITY_TYPE'],
      [{ attribute: '   ' }, 'INVALID_ATTRIBUTE'],
      [{ attribute: undefined }, 'INVALID_ATTRIBUTE'],
      [{ authoritative_providers: 'human' }, 'INVALID_PROVIDERS'],
      [{ authoritative_providers: undefined }, 'INVALID_PROVIDERS'],
      [{ authoritative_providers: [1, 2] }, 'INVALID_PROVIDERS'],
    ] as const) {
      const res = await call('POST', { companyId: ORG_A }, body(over as Row));
      expect(res._status).toBe(400);
      expect(res._json.error).toBe(code);
    }
    expect(db.rows).toEqual([]);
  });

  it('a declaration touches no other attribute or scope', async () => {
    asAdminA();
    seedDeclaration(ORG_A, 'relationship', 'department', ['apollo']);
    seedDeclaration(ORG_A, 'person', 'job_title', ['apollo']);
    await call('POST', { companyId: ORG_A }, body({ authoritative_providers: ['human'] }));
    const byKey = Object.fromEntries(db.rows.map((r) => [`${r.entity_type}/${r.attribute}`, r.authoritative_providers]));
    expect(byKey['relationship/job_title']).toEqual(['human']);
    expect(byKey['relationship/department']).toEqual(['apollo']);
    expect(byKey['person/job_title']).toEqual(['apollo']);
  });

  it('reports a write failure as an error, never as success', async () => {
    asAdminA();
    db.writeError = { message: 'duplicate key value violates unique constraint' };
    const res = await call('POST', { companyId: ORG_A }, body());
    expect(res._status).toBe(500);
    expect(res._json.error).toBe('AUTHORITY_OPERATION_FAILED');
  });
});

describe('DELETE', () => {
  it('clears exactly the declaration named, scoped on all three key legs', async () => {
    seedDeclaration(ORG_A, 'relationship', 'job_title', ['human']);
    seedDeclaration(ORG_A, 'relationship', 'department', ['human']);
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    asAdminA();
    const res = await call('DELETE', { companyId: ORG_A, entity_type: 'relationship', attribute: 'job_title' });
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ cleared: true });
    expect(db.deletes[0].filters.map(([c]) => c)).toEqual(['organization_id', 'entity_type', 'attribute']);
    expect(db.rows.map((r) => `${r.entity_type}/${r.attribute}`).sort())
      .toEqual(['person/job_title', 'relationship/department']);
  });

  it('clear then GET reports no declaration for that key', async () => {
    asAdminA();
    await call('POST', { companyId: ORG_A },
      { entity_type: 'relationship', attribute: 'job_title', authoritative_providers: ['human'] });
    await call('DELETE', { companyId: ORG_A, entity_type: 'relationship', attribute: 'job_title' });
    const res = await call('GET', { companyId: ORG_A });
    expect(res._json.declarations).toEqual([]);
  });

  it('400s a missing or invalid scope and a blank attribute', async () => {
    asAdminA();
    expect((await call('DELETE', { companyId: ORG_A, attribute: 'job_title' }))._status).toBe(400);
    expect((await call('DELETE', { companyId: ORG_A, entity_type: 'prospect', attribute: 'job_title' }))._status).toBe(400);
    expect((await call('DELETE', { companyId: ORG_A, entity_type: 'person' }))._status).toBe(400);
    expect((await call('DELETE', { companyId: ORG_A, entity_type: 'person', attribute: '  ' }))._status).toBe(400);
    expect(db.deletes).toEqual([]);
  });

  it('clearing something never declared is a success, not an error', async () => {
    asAdminA();
    const res = await call('DELETE', { companyId: ORG_A, entity_type: 'person', attribute: 'job_title' });
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ cleared: true });
  });
});

describe('fail closed', () => {
  it('a declaration READ failure is a 500 — never an empty declaration set', async () => {
    // This is the property the whole authority design rests on. Reporting []
    // here would tell the operator the tenant has declared nothing, and would
    // hand arbitration back to recency without anyone noticing.
    asAdminA();
    seedDeclaration(ORG_A, 'person', 'job_title', ['human']);
    db.readError = { message: 'connection reset' };
    const res = await call('GET', { companyId: ORG_A });
    expect(res._status).toBe(500);
    expect(res._json.error).toBe('AUTHORITY_OPERATION_FAILED');
    expect(res._json).not.toHaveProperty('declarations');
  });

  it('the error body carries no declaration data and no request body', async () => {
    asAdminA();
    db.readError = { message: 'relation "attribute_authority_declarations" does not exist' };
    const res = await call('GET', { companyId: ORG_A });
    expect(JSON.stringify(res._json)).not.toMatch(/attribute_authority_declarations/);
    expect(Object.keys(res._json)).toEqual(['error']);
  });
});
