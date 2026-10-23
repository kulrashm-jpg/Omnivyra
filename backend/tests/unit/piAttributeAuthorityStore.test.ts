/**
 * B1b — the authority declaration store.
 *
 * Authority is governance configuration, so the properties worth testing are
 * not "does it round-trip" but "who may change it, and whose it is":
 *
 *   - a declaration is written with the tenant it was asked for, never one
 *     derived from the actor;
 *   - the actor's role is resolved FOR THE TENANT BEING CHANGED, which is what
 *     makes cross-tenant mutation structurally impossible rather than a
 *     comparison someone has to remember;
 *   - keys are normalised on the way in, because a declaration holding
 *     ' Apollo ' matches nothing while reading as though it had taken effect;
 *   - an empty declaration is STORED, not rejected, and never means "suppress
 *     every candidate".
 *
 * The doubles are deliberately role-sensitive AND tenant-sensitive. A role
 * double that answers the same way for every tenant cannot detect cross-tenant
 * leakage, which is the whole point of the authorization tests; a database
 * double that ignores its filters cannot detect a missing tenant predicate.
 */

type Row = Record<string, unknown>;

const db = {
  rows: [] as Row[],
  upserts: [] as Array<{ payload: Row; onConflict: string | undefined }>,
  deletes: [] as Array<{ filters: Array<[string, unknown]> }>,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select' as 'select' | 'upsert' | 'delete',
      filters: [] as Array<[string, unknown]>,
      payload: null as Row | null,
      onConflict: undefined as string | undefined,
    };
    const exec = async (mode: 'many' | 'single') => {
      await Promise.resolve();
      if (st.op === 'upsert') {
        db.upserts.push({ payload: st.payload as Row, onConflict: st.onConflict });
        if (db.writeError) return { data: null, error: db.writeError };
        const key = (r: Row) =>
          `${r.organization_id}|${r.entity_type}|${r.attribute}`;
        const payload = st.payload as Row;
        const existing = db.rows.findIndex((r) => key(r) === key(payload));
        if (existing >= 0) db.rows[existing] = { ...db.rows[existing], ...payload };
        else db.rows.push({ ...payload });
        return { data: payload, error: null };
      }
      if (st.op === 'delete') {
        db.deletes.push({ filters: st.filters });
        if (db.writeError) return { data: null, error: db.writeError };
        db.rows = db.rows.filter((r) => !st.filters.every(([c, v]) => r[c] === v));
        return { data: null, error: null };
      }
      db.reads.push({ table, filters: st.filters });
      if (db.readError) return { data: null, error: db.readError };
      const found = db.rows.filter((r) => st.filters.every(([c, v]) => r[c] === v));
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      upsert: (p: Row, opts?: { onConflict?: string }) => {
        st.op = 'upsert'; st.payload = p; st.onConflict = opts?.onConflict; return b;
      },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      single: () => exec('single'),
      maybeSingle: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

/**
 * Role directory: (userId, companyId) -> role. Looking up a pair that is not
 * here returns no role, which is exactly how the real `getUserRole` answers an
 * administrator asking about a tenant they do not belong to.
 */
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

const warnings: Array<{ event: string; ctx: unknown }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    warn: (event: string, ctx: unknown) => { warnings.push({ event, ctx }); },
    info: () => {}, error: () => {}, debug: () => {},
  },
}));

import {
  AUTHORITY_ENTITY_TYPES, isAuthorityEntityType,
  loadAuthorityDeclarations, canDeclareAuthority,
  declareAttributeAuthority, clearAttributeAuthority, listAttributeAuthority,
} from '../../services/prospectIdentity/attributeAuthorityStore';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const ADMIN_A = 'user-admin-a';
const ADMIN_B = 'user-admin-b';
const MEMBER_A = 'user-member-a';
const ROOT = 'user-super';

beforeEach(() => {
  db.rows = []; db.upserts = []; db.deletes = []; db.reads = [];
  db.readError = null; db.writeError = null;
  for (const k of Object.keys(roles)) delete roles[k];
  superAdmins.clear();
  warnings.length = 0;

  roles[`${ADMIN_A}|${ORG_A}`] = 'COMPANY_ADMIN';
  roles[`${ADMIN_B}|${ORG_B}`] = 'COMPANY_ADMIN';
  roles[`${MEMBER_A}|${ORG_A}`] = 'CONTENT_CREATOR';
  superAdmins.add(ROOT);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the scope vocabulary', () => {
  it('is exactly person, account and relationship', () => {
    expect([...AUTHORITY_ENTITY_TYPES]).toEqual(['person', 'account', 'relationship']);
  });

  it('admits nothing else — a fourth scope would be a new ontology', () => {
    for (const v of ['prospect', 'lead', 'company', 'Person', '', null, 3]) {
      expect(isAuthorityEntityType(v)).toBe(false);
    }
  });
});

describe('authorization — who may declare', () => {
  it('a tenant administrator may, for their own tenant', async () => {
    expect(await canDeclareAuthority(ADMIN_A, ORG_A)).toMatchObject({ allowed: true });
  });

  it('an ordinary member may NOT', async () => {
    expect(await canDeclareAuthority(MEMBER_A, ORG_A)).toMatchObject({ allowed: false });
  });

  it('a platform super-admin may, as everywhere else in the product', async () => {
    expect(await canDeclareAuthority(ROOT, ORG_A)).toMatchObject({ allowed: true });
    expect(await canDeclareAuthority(ROOT, ORG_B)).toMatchObject({ allowed: true });
  });

  it('the legacy ADMIN alias normalises to COMPANY_ADMIN', async () => {
    roles[`user-legacy|${ORG_A}`] = 'ADMIN';
    expect(await canDeclareAuthority('user-legacy', ORG_A)).toMatchObject({ allowed: true });
  });

  it('tenant A administrator has NO authority over tenant B', async () => {
    expect(await canDeclareAuthority(ADMIN_A, ORG_B)).toEqual({ allowed: false, role: null });
  });

  it('tenant B administrator has NO authority over tenant A', async () => {
    expect(await canDeclareAuthority(ADMIN_B, ORG_A)).toEqual({ allowed: false, role: null });
  });

  it('an absent actor or tenant is refused rather than defaulted', async () => {
    expect(await canDeclareAuthority('', ORG_A)).toEqual({ allowed: false, role: null });
    expect(await canDeclareAuthority(ADMIN_A, '')).toEqual({ allowed: false, role: null });
  });
});

describe('declare — the write path', () => {
  const declare = (over: Record<string, unknown> = {}) => declareAttributeAuthority({
    organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
    providers: ['human'], actorUserId: ADMIN_A, ...over,
  } as never);

  it('stores the tenant it was ASKED for, never one derived from the actor', async () => {
    const res = await declare();
    expect(res.ok).toBe(true);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].payload.organization_id).toBe(ORG_A);
    expect(db.upserts[0].payload.entity_type).toBe('relationship');
    expect(db.upserts[0].payload.attribute).toBe('job_title');
  });

  it('names the (tenant, entity_type, attribute) conflict target', async () => {
    await declare();
    // The unique index is TOTAL, so it can be named directly — unlike the
    // relationship table's partial indexes, which cannot (42P10).
    expect(db.upserts[0].onConflict).toBe('organization_id,entity_type,attribute');
  });

  it('records WHO declared it', async () => {
    await declare();
    expect(db.upserts[0].payload.declared_by_user_id).toBe(ADMIN_A);
  });

  it('normalises, de-duplicates and drops unusable keys', async () => {
    await declare({ providers: [' Apollo ', 'apollo', 'APOLLO', '', '   ', 'human'] });
    expect(db.upserts[0].payload.authoritative_providers).toEqual(['apollo', 'human']);
  });

  it('stores an EMPTY declaration rather than rejecting it', async () => {
    const res = await declare({ providers: [] });
    expect(res.ok).toBe(true);
    expect(db.upserts[0].payload.authoritative_providers).toEqual([]);
  });

  it('replaces rather than accumulates — one answer at a time', async () => {
    await declare({ providers: ['human'] });
    await declare({ providers: ['apollo'] });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].authoritative_providers).toEqual(['apollo']);
  });

  it('is idempotent: declaring the same thing twice leaves one row', async () => {
    await declare({ providers: ['human'] });
    await declare({ providers: ['human'] });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].authoritative_providers).toEqual(['human']);
  });

  it('refuses an ordinary member, writes nothing, and logs the refusal', async () => {
    const res = await declare({ actorUserId: MEMBER_A });
    expect(res).toEqual({ ok: false, reason: 'not_authorized' });
    expect(db.upserts).toEqual([]);
    expect(warnings[0]).toMatchObject({ event: 'authority_declaration_refused' });
  });

  it('refuses a cross-tenant declaration from either direction, writing nothing', async () => {
    expect(await declare({ organizationId: ORG_B, actorUserId: ADMIN_A }))
      .toEqual({ ok: false, reason: 'not_authorized' });
    expect(await declare({ organizationId: ORG_A, actorUserId: ADMIN_B }))
      .toEqual({ ok: false, reason: 'not_authorized' });
    expect(db.upserts).toEqual([]);
    expect(db.rows).toEqual([]);
  });

  it('refuses a missing tenant, actor, scope or attribute before authorizing', async () => {
    expect(await declare({ organizationId: '' })).toEqual({ ok: false, reason: 'tenant_required' });
    expect(await declare({ actorUserId: '' })).toEqual({ ok: false, reason: 'actor_required' });
    expect(await declare({ entityType: 'prospect' })).toEqual({ ok: false, reason: 'invalid_entity_type' });
    expect(await declare({ attribute: '   ' })).toEqual({ ok: false, reason: 'invalid_attribute' });
    expect(db.upserts).toEqual([]);
  });

  it('trims the attribute so a stray space cannot create a second declaration', async () => {
    await declare({ attribute: '  job_title  ' });
    expect(db.upserts[0].payload.attribute).toBe('job_title');
  });

  it('reports a write failure instead of claiming success', async () => {
    db.writeError = { message: 'duplicate key value violates unique constraint' };
    const res = await declare();
    expect(res).toMatchObject({ ok: false, reason: 'write_failed' });
    expect(warnings.some((w) => w.event === 'authority_declaration_refused')).toBe(true);
  });
});

describe('clear — returning to source-neutral', () => {
  const declare = () => declareAttributeAuthority({
    organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
    providers: ['human'], actorUserId: ADMIN_A,
  });
  const clear = (over: Record<string, unknown> = {}) => clearAttributeAuthority({
    organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
    actorUserId: ADMIN_A, ...over,
  } as never);

  it('deletes exactly the declaration named, scoped by all three key legs', async () => {
    await declare();
    const res = await clear();
    expect(res).toEqual({ ok: true, cleared: true });
    expect(db.rows).toEqual([]);
    const cols = db.deletes[0].filters.map(([c]) => c);
    expect(cols).toEqual(['organization_id', 'entity_type', 'attribute']);
  });

  it('leaves another scope and another attribute alone', async () => {
    await declare();
    await declareAttributeAuthority({
      organizationId: ORG_A, entityType: 'person', attribute: 'job_title',
      providers: ['apollo'], actorUserId: ADMIN_A,
    });
    await declareAttributeAuthority({
      organizationId: ORG_A, entityType: 'relationship', attribute: 'department',
      providers: ['apollo'], actorUserId: ADMIN_A,
    });
    await clear();
    expect(db.rows.map((r) => `${r.entity_type}/${r.attribute}`).sort())
      .toEqual(['person/job_title', 'relationship/department']);
  });

  it('clearing something that was never declared is a success', async () => {
    // The requested end state — source-neutral — holds either way, and
    // reporting a failure would invite a caller to retry forever.
    expect(await clear()).toEqual({ ok: true, cleared: true });
  });

  it('refuses a member and a cross-tenant clear, deleting nothing', async () => {
    await declare();
    expect(await clear({ actorUserId: MEMBER_A })).toEqual({ ok: false, reason: 'not_authorized' });
    expect(await clear({ actorUserId: ADMIN_B })).toEqual({ ok: false, reason: 'not_authorized' });
    expect(db.deletes).toEqual([]);
    expect(db.rows).toHaveLength(1);
  });
});

describe('read — the arbitration path', () => {
  it('filters on tenant AND scope', async () => {
    await loadAuthorityDeclarations(ORG_A, 'relationship');
    expect(db.reads).toHaveLength(1);
    expect(db.reads[0].table).toBe('attribute_authority_declarations');
    expect(db.reads[0].filters).toEqual([
      ['organization_id', ORG_A], ['entity_type', 'relationship'],
    ]);
  });

  it('returns only this tenant and this scope', async () => {
    db.rows = [
      { organization_id: ORG_A, entity_type: 'relationship', attribute: 'job_title', authoritative_providers: ['human'], declared_by_user_id: ADMIN_A, updated_at: null },
      { organization_id: ORG_A, entity_type: 'person', attribute: 'job_title', authoritative_providers: ['apollo'], declared_by_user_id: ADMIN_A, updated_at: null },
      { organization_id: ORG_B, entity_type: 'relationship', attribute: 'job_title', authoritative_providers: ['apollo'], declared_by_user_id: ADMIN_B, updated_at: null },
    ];
    const got = await loadAuthorityDeclarations(ORG_A, 'relationship');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      organizationId: ORG_A, entityType: 'relationship',
      attribute: 'job_title', providers: ['human'],
    });
  });

  it('THROWS on a read failure rather than reporting "nothing declared"', async () => {
    db.readError = { message: 'connection reset' };
    // Returning [] would let a transient outage silently discard a tenant's
    // declaration and hand the decision back to recency — invisibly.
    await expect(loadAuthorityDeclarations(ORG_A, 'person'))
      .rejects.toThrow(/authority declaration read failed/);
  });

  it('refuses a blank tenant — authority is never global', async () => {
    await expect(loadAuthorityDeclarations('', 'person'))
      .rejects.toThrow(/organizationId is required/);
    expect(db.reads).toEqual([]);
  });

  it('an empty stored array reads back as an empty provider list', async () => {
    db.rows = [{ organization_id: ORG_A, entity_type: 'person', attribute: 'job_title', authoritative_providers: [], declared_by_user_id: null, updated_at: null }];
    const got = await loadAuthorityDeclarations(ORG_A, 'person');
    expect(got[0].providers).toEqual([]);
  });
});

describe('list — the operator read', () => {
  it('requires an administrator of that tenant', async () => {
    expect(await listAttributeAuthority({ organizationId: ORG_A, entityType: 'person', actorUserId: MEMBER_A }))
      .toEqual({ ok: false, reason: 'not_authorized' });
    expect(await listAttributeAuthority({ organizationId: ORG_A, entityType: 'person', actorUserId: ADMIN_B }))
      .toEqual({ ok: false, reason: 'not_authorized' });
  });

  it('returns the tenant declarations for an administrator', async () => {
    db.rows = [{ organization_id: ORG_A, entity_type: 'person', attribute: 'job_title', authoritative_providers: ['human'], declared_by_user_id: ADMIN_A, updated_at: null }];
    const res = await listAttributeAuthority({ organizationId: ORG_A, entityType: 'person', actorUserId: ADMIN_A });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.declarations).toHaveLength(1);
  });
});
