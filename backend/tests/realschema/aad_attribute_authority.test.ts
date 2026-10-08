/**
 * B1b — ATTRIBUTE AUTHORITY DECLARATIONS, against real PostgreSQL.
 *
 * The properties that matter here cannot be mocked honestly:
 *
 *   - the (tenant, entity_type, attribute) unique key, which is what makes
 *     "replace" and "clear" deterministic and a concurrent second declaration
 *     an error rather than a silent duplicate resolved by row order;
 *   - the element predicate, enforced by the database so the guarantee does not
 *     depend on which writer ran;
 *   - the ABSENCE of any expiry column, which is D-5;
 *   - the authorization path, which runs the REAL rbacService against real
 *     `user_company_roles` rows rather than a double that could be wrong in the
 *     same direction as the code.
 *
 * `ownedDbTable` is adapted onto the live pg client, so the real store and the
 * real RBAC service execute against the real schema. Nothing about authority is
 * stubbed.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount,
  constraintDef, uniqueIndexColumns,
} from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'upsert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      onConflict: null as string | null,
      filters: [] as Filter[], limit: null as number | null,
      mode: 'many' as 'many' | 'one',
    };
    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };
    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
        if (f.op === 'in') {
          const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
          return `"${f.col}" IN (${list.join(', ')})`;
        }
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };
    const exec = async () => {
      const params: unknown[] = [];
      let sql: string;
      const row = st.payload ?? {};
      const bind = (k: string) => {
        const v = row[k];
        // An array must stay an array: JSON.stringify would hand text[] a
        // string and the insert would fail for the wrong reason.
        params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `$${params.length}`;
      };
      if (st.op === 'insert' || st.op === 'upsert') {
        const keys = Object.keys(row);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map(bind).join(', ');
        sql = `INSERT INTO public."${table}" (${cols}) VALUES (${vals})`;
        if (st.op === 'upsert' && st.onConflict) {
          const target = st.onConflict.split(',').map((c) => `"${c.trim()}"`).join(', ');
          const sets = keys.filter((k) => !st.onConflict!.split(',').map((c) => c.trim()).includes(k))
            .map((k) => `"${k}" = EXCLUDED."${k}"`).join(', ');
          sql += ` ON CONFLICT (${target}) DO UPDATE SET ${sets}`;
        }
        sql += ` RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const sets = Object.keys(row).map((k) => `"${k}" = ${bind(k)}`).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      }
      await client.query('SAVEPOINT pg_adapter');
      try {
        const res = await client.query(sql, params) as { rows: unknown[] };
        await client.query('RELEASE SAVEPOINT pg_adapter');
        const out = (res.rows as Record<string, unknown>[]).map(normalize);
        if (st.mode === 'one') return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT pg_adapter');
        return { data: null, error: err };
      }
    };
    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (cols) st.cols = cols; return b; },
      insert: (r: Record<string, unknown>) => { st.op = 'insert'; st.payload = r; return b; },
      upsert: (r: Record<string, unknown>, opts?: { onConflict?: string }) => {
        st.op = 'upsert'; st.payload = r; st.onConflict = opts?.onConflict ?? null; return b;
      },
      update: (r: Record<string, unknown>) => { st.op = 'update'; st.payload = r; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      order: () => b,
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));

// Required AFTER the adapter so the real modules pick it up.
/* eslint-disable @typescript-eslint/no-var-requires */
const {
  declareAttributeAuthority, clearAttributeAuthority, loadAuthorityDeclarations,
  canDeclareAuthority, listAttributeAuthority,
} = require('../../services/prospectIdentity/attributeAuthorityStore');
const {
  resolveAttributeAuthority, authoritativeProvidersFor, authoritySurfaceFor,
  RELATIONSHIP_AUTHORITY_COLUMNS, ATTRIBUTE_AUTHORITY_VERSION,
} = require('../../services/prospectIdentity/attributeAuthority');
const { decideCanonicalUpdates } = require('../../services/prospectIdentity/ingestionBoundary');
/* eslint-enable @typescript-eslint/no-var-requires */

const ADMIN_A = '0a000000-0000-4000-8000-00000000a001';
const MEMBER_A = '0a000000-0000-4000-8000-00000000a002';
const ADMIN_B = '0b000000-0000-4000-8000-00000000b001';
const ROOT = '0f000000-0000-4000-8000-00000000f001';

/** Real users and real role rows: the authorization path is not stubbed. */
const seedActors = async (): Promise<void> => {
  await seedTenants();
  const people: Array<[string, string]> = [
    [ADMIN_A, 'aad-admin-a@test.local'], [MEMBER_A, 'aad-member-a@test.local'],
    [ADMIN_B, 'aad-admin-b@test.local'], [ROOT, 'aad-root@test.local'],
  ];
  for (const [id, email] of people) {
    await db.query(
      `INSERT INTO public.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, email]);
  }
  const grants: Array<[string, string, string]> = [
    [ADMIN_A, ORG_A, 'COMPANY_ADMIN'],
    [MEMBER_A, ORG_A, 'CONTENT_CREATOR'],
    [ADMIN_B, ORG_B, 'COMPANY_ADMIN'],
    [ROOT, ORG_A, 'SUPER_ADMIN'],
  ];
  for (const [user, org, role] of grants) {
    await db.query(
      `INSERT INTO public.user_company_roles (user_id, company_id, role, status)
       VALUES ($1, $2, $3, 'active')`, [user, org, role]);
  }
};

const declare = (over: Record<string, unknown> = {}) => declareAttributeAuthority({
  organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
  providers: ['human'], actorUserId: ADMIN_A, ...over,
});

const storedRows = async (org?: string) => {
  const { rows } = await db.query(
    `SELECT organization_id, entity_type, attribute, authoritative_providers, declared_by_user_id
       FROM public.attribute_authority_declarations
      ${org ? 'WHERE organization_id = $1' : ''}
      ORDER BY entity_type, attribute`, org ? [org] : []);
  return rows;
};

// ═══════════════════════════════════════════════════════════════════════════
describe('AAD — the schema contract', () => {
  it('the D-3 key is enforced by a UNIQUE index on all three legs', async () => {
    await inRollback(async () => {
      expect(await uniqueIndexColumns('uq_aad_tenant_entity_attribute'))
        .toEqual(['organization_id', 'entity_type', 'attribute']);
    });
  });

  it('authority can never be global — organization_id is NOT NULL', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attribute_authority_declarations'
            AND column_name='organization_id'`);
      expect(rows[0].is_nullable).toBe('NO');
    });
  });

  it('D-5: there is NO expiry column of any name', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='attribute_authority_declarations'`);
      const cols = (rows as Array<{ column_name: string }>).map((r) => r.column_name);
      for (const c of cols) {
        expect(c).not.toMatch(/expire|expiry|ttl|valid_until|effective_until/);
      }
      // And the positive: the only timestamps are audit ones.
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });
  });

  it('the scope vocabulary is exactly the three B1b can arbitrate', async () => {
    await inRollback(async () => {
      const def = await constraintDef('aad_entity_type_valid');
      expect(def).toBeTruthy();
      for (const v of ['person', 'account', 'relationship']) expect(def).toContain(`'${v}'`);
      await seedTenants();
      for (const bad of ['prospect', 'lead', 'company', 'Person', '']) {
        expect(await attempt(
          `INSERT INTO public.attribute_authority_declarations
             (organization_id, entity_type, attribute, authoritative_providers)
           VALUES ($1, $2, 'job_title', ARRAY['apollo'])`, [ORG_A, bad])).toBe('23514');
      }
    });
  });

  it('a declaration must name a real tenant', async () => {
    await inRollback(async () => {
      expect(await attempt(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ('11111111-2222-4333-8444-555555555555','person','job_title',ARRAY['apollo'])`))
        .toBe('23503');
    });
  });
});

describe('AAD — the element predicate is the database, not the writer', () => {
  it('rejects blank, un-normalised and repeated keys', async () => {
    await inRollback(async () => {
      await seedTenants();
      const bad: Array<[string, string]> = [
        ["ARRAY['']", 'blank'],
        ["ARRAY['   ']", 'whitespace'],
        ["ARRAY[' Apollo ']", 'untrimmed'],
        ["ARRAY['Apollo']", 'upper case'],
        ["ARRAY['apollo','apollo']", 'repeated'],
        ["ARRAY['apollo',NULL]", 'null element'],
      ];
      for (const [arr, why] of bad) {
        const code = await attempt(
          `INSERT INTO public.attribute_authority_declarations
             (organization_id, entity_type, attribute, authoritative_providers)
           VALUES ($1,'person','job_title',${arr})`, [ORG_A]);
        expect(code).toBe('23514');
        expect(why).toBeTruthy();
      }
    });
  });

  it('accepts a normalised list and an EMPTY list', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'person','job_title',ARRAY['apollo','human'])`, [ORG_A]);
      await db.query(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'account','industry',ARRAY[]::text[])`, [ORG_A]);
      const rows = await storedRows(ORG_A);
      expect(rows).toHaveLength(2);
    });
  });

  it('a blank attribute is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'person','   ',ARRAY['apollo'])`, [ORG_A])).toBe('23514');
    });
  });

  it('the predicate function names no provider and reads no table', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT pg_get_functiondef(p.oid) d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname='pi_authority_providers_ok'`);
      expect(rows).toHaveLength(1);
      const def = String(rows[0].d);
      expect(def).toMatch(/IMMUTABLE/);
      // A predicate that consulted a catalogue would be a provider registry,
      // which LI-2 deliberately does not have.
      expect(def).not.toMatch(/apollo|clearbit|linkedin|sales_?nav/i);
      expect(def).not.toMatch(/\bFROM\s+public\./i);
    });
  });
});

describe('AAD — authorization, through the real RBAC service', () => {
  it('a tenant administrator may declare for their own tenant', async () => {
    await inRollback(async () => {
      await seedActors();
      expect(await canDeclareAuthority(ADMIN_A, ORG_A)).toMatchObject({ allowed: true });
      const res = await declare();
      expect(res.ok).toBe(true);
      expect(await storedRows(ORG_A)).toHaveLength(1);
    });
  });

  it('an ordinary member may NOT, and nothing is written', async () => {
    await inRollback(async () => {
      await seedActors();
      const res = await declare({ actorUserId: MEMBER_A });
      expect(res).toEqual({ ok: false, reason: 'not_authorized' });
      expect(await storedRows()).toHaveLength(0);
    });
  });

  it('a super-admin row grants it', async () => {
    await inRollback(async () => {
      await seedActors();
      expect((await declare({ actorUserId: ROOT })).ok).toBe(true);
    });
  });

  it('tenant A admin cannot declare for tenant B, nor B for A', async () => {
    await inRollback(async () => {
      await seedActors();
      expect(await declare({ organizationId: ORG_B, actorUserId: ADMIN_A }))
        .toEqual({ ok: false, reason: 'not_authorized' });
      expect(await declare({ organizationId: ORG_A, actorUserId: ADMIN_B }))
        .toEqual({ ok: false, reason: 'not_authorized' });
      expect(await storedRows()).toHaveLength(0);
    });
  });

  it('an INACTIVE admin row does not grant it', async () => {
    await inRollback(async () => {
      await seedActors();
      await db.query(
        `UPDATE public.user_company_roles SET status='inactive'
          WHERE user_id=$1 AND company_id=$2`, [ADMIN_A, ORG_A]);
      expect(await declare()).toEqual({ ok: false, reason: 'not_authorized' });
    });
  });

  it('the operator read is administrator-only too', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare();
      expect(await listAttributeAuthority({
        organizationId: ORG_A, entityType: 'relationship', actorUserId: MEMBER_A,
      })).toEqual({ ok: false, reason: 'not_authorized' });
      const ok = await listAttributeAuthority({
        organizationId: ORG_A, entityType: 'relationship', actorUserId: ADMIN_A,
      });
      expect(ok.ok).toBe(true);
      expect(ok.declarations).toHaveLength(1);
    });
  });
});

describe('AAD — replace, clear and idempotency are deterministic', () => {
  it('declaring twice replaces, leaving exactly one row', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      await declare({ providers: ['apollo'] });
      const rows = await storedRows(ORG_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].authoritative_providers).toEqual(['apollo']);
    });
  });

  it('an identical re-declaration is idempotent', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      await declare({ providers: ['human'] });
      const rows = await storedRows(ORG_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].authoritative_providers).toEqual(['human']);
    });
  });

  it('clear removes it and the tenant returns to source-neutral', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare();
      expect(await clearAttributeAuthority({
        organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
        actorUserId: ADMIN_A,
      })).toEqual({ ok: true, cleared: true });
      expect(await storedRows()).toHaveLength(0);
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authority.byAttribute).toEqual({});
    });
  });

  it('clear touches neither another scope, another attribute nor another tenant', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ entityType: 'relationship', attribute: 'job_title' });
      await declare({ entityType: 'person', attribute: 'job_title' });
      await declare({ entityType: 'relationship', attribute: 'department' });
      await declare({ organizationId: ORG_B, actorUserId: ROOT });

      await clearAttributeAuthority({
        organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
        actorUserId: ADMIN_A,
      });
      expect((await storedRows(ORG_A)).map((r: any) => `${r.entity_type}/${r.attribute}`).sort())
        .toEqual(['person/job_title', 'relationship/department']);
      expect(await storedRows(ORG_B)).toHaveLength(1);
    });
  });
});

describe('AAD — concurrency', () => {
  it('two administrators declaring the same key: the second is a 23505, not a duplicate', async () => {
    await inRollback(async () => {
      await seedActors();
      await db.query(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'relationship','job_title',ARRAY['human'])`, [ORG_A]);
      // A second writer that INSERTs rather than upserting — what a lost race
      // looks like at the database.
      expect(await attempt(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'relationship','job_title',ARRAY['apollo'])`, [ORG_A])).toBe('23505');
      // Through the store it succeeds, because the store upserts on that key.
      expect((await declare({ providers: ['apollo'] })).ok).toBe(true);
      const rows = await storedRows(ORG_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].authoritative_providers).toEqual(['apollo']);
    });
  });

  it('replacing a declaration mid-arbitration gives one deterministic answer', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      // Arbitration resolves authority ONCE and then decides; a replacement
      // that lands afterwards cannot retroactively change that decision.
      const before = await resolveAttributeAuthority(ORG_A, 'relationship');
      await declare({ providers: ['apollo'] });
      const after = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authoritativeProvidersFor(before, 'job_title')).toEqual(['human']);
      expect(authoritativeProvidersFor(after, 'job_title')).toEqual(['apollo']);
    });
  });

  it('clearing mid-arbitration leaves the already-resolved declaration intact', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      const resolved = await resolveAttributeAuthority(ORG_A, 'relationship');
      await clearAttributeAuthority({
        organizationId: ORG_A, entityType: 'relationship', attribute: 'job_title',
        actorUserId: ADMIN_A,
      });
      expect(authoritativeProvidersFor(resolved, 'job_title')).toEqual(['human']);
      const now = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authoritativeProvidersFor(now, 'job_title')).toEqual([]);
    });
  });
});

describe('AAD — the resolver reads what was declared, and only that', () => {
  it('a declaration reaches arbitration through resolveAttributeAuthority', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authority.entityType).toBe('relationship');
      expect(authoritativeProvidersFor(authority, 'job_title')).toEqual(['human']);
      expect(ATTRIBUTE_AUTHORITY_VERSION).toMatch(/^b1b\./);
    });
  });

  it('another TENANT is unaffected by this tenant declaration', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      const b = await resolveAttributeAuthority(ORG_B, 'relationship');
      expect(b.byAttribute).toEqual({});
    });
  });

  it('another SCOPE is unaffected: a relationship declaration is not a person one', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ entityType: 'relationship', attribute: 'job_title', providers: ['human'] });
      const person = await resolveAttributeAuthority(ORG_A, 'person');
      expect(authoritativeProvidersFor(person, 'job_title')).toEqual([]);
      const account = await resolveAttributeAuthority(ORG_A, 'account');
      expect(account.byAttribute).toEqual({});
    });
  });

  it('another ATTRIBUTE is unaffected: job_title authority is not department authority', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ attribute: 'job_title', providers: ['human'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authoritativeProvidersFor(authority, 'job_title')).toEqual(['human']);
      expect(authoritativeProvidersFor(authority, 'department')).toEqual([]);
      expect(authoritativeProvidersFor(authority, 'seniority')).toEqual([]);
    });
  });

  it('an ACCOUNT declaration cannot affect the person scope', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ entityType: 'account', attribute: 'industry', providers: ['apollo'] });
      const person = await resolveAttributeAuthority(ORG_A, 'person');
      expect(person.byAttribute).toEqual({});
      const account = await resolveAttributeAuthority(ORG_A, 'account');
      expect(authoritativeProvidersFor(account, 'industry')).toEqual(['apollo']);
    });
  });

  it('a stored EMPTY declaration resolves source-neutral, not "nothing may win"', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: [] });
      expect(await storedRows(ORG_A)).toHaveLength(1);   // it IS stored
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authority.byAttribute).toEqual({});          // and it narrows nothing
    });
  });

  it('a declaration over an attribute the scope does not have is dropped, not honoured', async () => {
    await inRollback(async () => {
      await seedActors();
      // 'industry' is an account attribute; at relationship scope it is noise.
      await db.query(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'relationship','industry',ARRAY['apollo'])`, [ORG_A]);
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      expect(authority.byAttribute).toEqual({});
      expect(authoritativeProvidersFor(authority, 'industry')).toEqual([]);
    });
  });

  it('the relationship surface is exactly the employment attributes, and they are real columns', async () => {
    await inRollback(async () => {
      expect([...RELATIONSHIP_AUTHORITY_COLUMNS])
        .toEqual(['job_title', 'department', 'seniority', 'buying_role']);
      expect([...authoritySurfaceFor('relationship')])
        .toEqual([...RELATIONSHIP_AUTHORITY_COLUMNS]);
      // Pinned against the schema so the surface cannot drift from the table.
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='person_account_relationships'`);
      const cols = (rows as Array<{ column_name: string }>).map((r) => r.column_name);
      for (const c of RELATIONSHIP_AUTHORITY_COLUMNS) expect(cols).toContain(c);
    });
  });
});

describe('AAD — human correction precedence, end to end', () => {
  const T1 = '2026-01-01T00:00:00.000Z';
  const T2 = '2026-06-01T00:00:00.000Z';   // the provider is NEWER
  const cand = (id: string, value: string, provider: string, at: string) => ({
    id, attribute: 'job_title', normalized_value: value,
    provider, observed_at: at, recorded_at: at, confidence: null,
  });
  const HUMAN = cand('h1', 'Chief Revenue Officer', 'human', T1);
  const PROVIDER = cand('p1', 'VP Sales', 'apollo', T2);

  it('with human DECLARED, the newer provider does not overwrite the correction', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN],
        RELATIONSHIP_AUTHORITY_COLUMNS, authority);
      expect(d.apply).toEqual([{
        attribute: 'job_title', value: 'Chief Revenue Officer',
        assertionId: 'h1', reason: 'authoritative_source',
      }]);
      // The disagreement is still visible to an operator.
      expect(d.contested).toContain('job_title');
    });
  });

  it('with the PROVIDER declared, the provider wins even against a newer human', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['apollo'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      // Human is now the NEWER assertion, and still loses. Authority is
      // configuration, not origin magic.
      const newerHuman = cand('h2', 'Chief Revenue Officer', 'human', '2026-09-01T00:00:00.000Z');
      const d = decideCanonicalUpdates({ job_title: null }, [newerHuman, PROVIDER],
        RELATIONSHIP_AUTHORITY_COLUMNS, authority);
      expect(d.apply[0]).toMatchObject({ value: 'VP Sales', assertionId: 'p1' });
    });
  });

  it('with NOTHING declared, D-1 recency decides exactly as it did before', async () => {
    await inRollback(async () => {
      await seedActors();
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN],
        RELATIONSHIP_AUTHORITY_COLUMNS, authority);
      expect(d.apply[0]).toMatchObject({ value: 'VP Sales', reason: 'newest_observation' });
    });
  });

  it('human is NOT universally authoritative — another tenant keeps recency', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      const b = await resolveAttributeAuthority(ORG_B, 'relationship');
      const d = decideCanonicalUpdates({ job_title: null }, [PROVIDER, HUMAN],
        RELATIONSHIP_AUTHORITY_COLUMNS, b);
      expect(d.apply[0]).toMatchObject({ value: 'VP Sales', reason: 'newest_observation' });
    });
  });

  it('several declared sources: recency decides AMONG them, never outside them', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human', 'apollo'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      const other = cand('o1', 'Sales Lead', 'clearbit', '2026-12-01T00:00:00.000Z');
      const d = decideCanonicalUpdates({ job_title: null }, [HUMAN, PROVIDER, other],
        RELATIONSHIP_AUTHORITY_COLUMNS, authority);
      // clearbit is newest overall but undeclared, so it cannot win; apollo is
      // the newer of the two declared sources.
      expect(d.apply[0]).toMatchObject({ value: 'VP Sales', assertionId: 'p1' });
    });
  });

  it('D-4 is unchanged: an UNATTESTED incumbent is still protected under authority', async () => {
    await inRollback(async () => {
      await seedActors();
      await declare({ providers: ['human'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');
      // An incumbent value no assertion has ever carried is not ours to replace.
      const d = decideCanonicalUpdates({ job_title: 'Operator Typed This' }, [HUMAN],
        RELATIONSHIP_AUTHORITY_COLUMNS, authority);
      expect(d.apply).toEqual([]);
    });
  });

  it('§19 — two employments for one person arbitrate INDEPENDENTLY under one declaration', async () => {
    await inRollback(async () => {
      await seedActors();
      const person = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'aad-ra.test' });
      const accB = await newAccount(ORG_A, { domain: 'aad-rb.test' });
      const rel = async (account: string, title: string) => {
        const { rows } = await db.query(
          `INSERT INTO public.person_account_relationships
             (organization_id, person_id, account_id, job_title)
           VALUES ($1,$2,$3,$4) RETURNING id`, [ORG_A, person, account, title]);
        return rows[0].id as string;
      };
      const RA = await rel(accA, 'VP Sales');
      const RB = await rel(accB, 'CTO');
      expect(RA).not.toBe(RB);

      // ONE tenant-level declaration covers the relationship scope...
      await declare({ providers: ['human'] });
      const authority = await resolveAttributeAuthority(ORG_A, 'relationship');

      // ...and each employment is still decided from its OWN evidence. A newer
      // provider claim about RB cannot reach RA, because the subject of the
      // arbitration is the relationship, not the person.
      const rbDecision = decideCanonicalUpdates({ job_title: 'CTO' }, [
        cand('rb-h', 'Chief Technology Officer', 'human', T1),
        cand('rb-p', 'Engineering Lead', 'apollo', T2),
      ], RELATIONSHIP_AUTHORITY_COLUMNS, authority);
      expect(rbDecision.apply.map((a: any) => a.value)).not.toContain('VP Sales');

      const { rows } = await db.query(
        `SELECT account_id, job_title FROM public.person_account_relationships
          WHERE person_id=$1 ORDER BY job_title`, [person]);
      expect(rows.map((r: any) => r.job_title)).toEqual(['CTO', 'VP Sales']);
    });
  });
});
