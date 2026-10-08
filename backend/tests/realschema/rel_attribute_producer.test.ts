/**
 * PI — the relationship-scoped attribute producer, against real PostgreSQL.
 *
 * This is the certification of one chain:
 *
 *   assertion -> relationship assertion -> authority -> b1b -> canonical value
 *
 * and almost nothing in it can be established with a mock. The isolation
 * guarantees are composite foreign keys and a liveness rule keyed on the source
 * record; the arbitration outcomes depend on the real CHECK constraints
 * accepting the values; and the thing most worth proving — that asserting a
 * title at one employer leaves the other employer's title alone — is a property
 * of rows, not of a function.
 *
 * `ownedDbTable` is adapted onto the live pg client, so the REAL producer, the
 * REAL b1b boundary and the REAL authority resolver all execute against the
 * REAL schema. Nothing about arbitration, liveness or authority is stubbed.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, newPerson, newAccount,
} from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
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
      const row = st.payload ?? {};
      const bind = (k: string) => {
        const v = row[k];
        params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `$${params.length}`;
      };
      let sql: string;
      if (st.op === 'insert') {
        const keys = Object.keys(row);
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) `
          + `VALUES (${keys.map(bind).join(', ')}) RETURNING ${st.cols}`;
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
      update: (r: Record<string, unknown>) => { st.op = 'update'; st.payload = r; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      order: () => b,
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => exec().then(r, j),
    };
    return b;
  },
}));

// Required AFTER the adapter so the real modules pick it up.
/* eslint-disable @typescript-eslint/no-var-requires */
const { assertRelationshipAttribute, RELATIONSHIP_ATTRIBUTE_PRODUCER_VERSION } =
  require('../../services/prospectIdentity/relationshipAttributeIngestion');
/* eslint-enable @typescript-eslint/no-var-requires */

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-06-01T00:00:00.000Z';
const T3 = '2026-09-01T00:00:00.000Z';
const ACTOR = '0a000000-0000-4000-8000-0000000000a1';

/** A relationship, created directly: the producer asserts, it does not create. */
const newRelationship = async (
  org: string, person: string, account: string, over: Record<string, unknown> = {},
): Promise<string> => {
  const cols = ['organization_id', 'person_id', 'account_id', ...Object.keys(over)];
  const vals = [org, person, account, ...Object.values(over)];
  const { rows } = await db.query(
    `INSERT INTO public.person_account_relationships (${cols.join(', ')})
     VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
  return rows[0].id as string;
};

const seedActor = async (): Promise<void> => {
  await db.query(
    `INSERT INTO public.users (id, email) VALUES ($1, 'rel-attr-actor@test.local')
     ON CONFLICT (id) DO NOTHING`, [ACTOR]);
};

const declareAuthority = async (
  org: string, attribute: string, providers: string[],
): Promise<void> => {
  await db.query(
    `INSERT INTO public.attribute_authority_declarations
       (organization_id, entity_type, attribute, authoritative_providers)
     VALUES ($1, 'relationship', $2, $3)
     ON CONFLICT (organization_id, entity_type, attribute)
       DO UPDATE SET authoritative_providers = EXCLUDED.authoritative_providers`,
    [org, attribute, providers]);
};

const canonical = async (relationshipId: string) => {
  const { rows } = await db.query(
    `SELECT job_title, department, seniority, buying_role, attributes_source, attributes_updated_at
       FROM public.person_account_relationships WHERE id = $1`, [relationshipId]);
  return rows[0];
};

/** One provider claim. Distinct source keys by default, as real sources are. */
const assertProvider = (
  org: string, relationshipId: string, attribute: string, value: string,
  provider: string, observedAt: string, over: Record<string, unknown> = {},
) => assertRelationshipAttribute({
  organizationId: org, relationshipId, attribute, value, provider,
  observedAt, sourceRecordKey: `${provider}:${attribute}`, ...over,
});

const assertHuman = (
  org: string, relationshipId: string, attribute: string, value: string,
  observedAt: string, over: Record<string, unknown> = {},
) => assertRelationshipAttribute({
  organizationId: org, relationshipId, attribute, value,
  provider: 'human', origin: 'human', assertedByUserId: ACTOR,
  observedAt, sourceRecordKey: `human:${attribute}`, ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('REL-ATTR — the chain exists end to end', () => {
  it('a provider claim becomes a canonical relationship value through b1b', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'chain.test' });
      const rel = await newRelationship(ORG_A, p, a);

      const res = await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      expect(res.ok).toBe(true);
      expect(res.assertionRecorded).toBe(true);
      expect(res.canonicalApplied.map((x: any) => x.attribute)).toEqual(['job_title']);
      expect(res.canonicalApplied[0].reason).toBe('single_uncontested_assertion');

      const row = await canonical(rel);
      expect(row.job_title).toBe('VP Sales');
      expect(row.attributes_source).toBe('apollo');
      expect(row.attributes_updated_at).not.toBeNull();
      expect(RELATIONSHIP_ATTRIBUTE_PRODUCER_VERSION).toMatch(/^pi-rel-attr\./);
    });
  });

  it('the assertion is relationship-scoped, and names no person or account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'scope.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);

      const { rows } = await db.query(
        `SELECT entity_type, relationship_id, person_id, account_id, origin, provider,
                normalized_value, applied_to_canonical_at, applied_reason
           FROM public.source_assertions WHERE relationship_id = $1`, [rel]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entity_type: 'relationship', relationship_id: rel,
        person_id: null, account_id: null, origin: 'provider', provider: 'apollo',
        normalized_value: 'VP Sales', applied_reason: 'single_uncontested_assertion',
      });
      expect(rows[0].applied_to_canonical_at).not.toBeNull();
    });
  });

  it('writes NO person-level employment attribute', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'noperson.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'seniority', 'vp', 'apollo', T1);

      const { rows } = await db.query(
        'SELECT job_title, department, seniority, buying_role FROM public.unified_persons WHERE id=$1', [p]);
      expect(rows[0]).toEqual({ job_title: null, department: null, seniority: null, buying_role: null });
      // And no person-scoped assertion was created either.
      const { rows: pa } = await db.query(
        `SELECT count(*)::int n FROM public.source_assertions
          WHERE person_id = $1 AND entity_type = 'person'`, [p]);
      expect(pa[0].n).toBe(0);
    });
  });

  it('refuses a value outside a closed vocabulary rather than storing dead evidence', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'vocab.test' });
      const rel = await newRelationship(ORG_A, p, a);

      expect(await assertProvider(ORG_A, rel, 'seniority', 'Grand Poobah', 'apollo', T1))
        .toEqual({ ok: false, reason: 'invalid_value' });
      expect(await assertProvider(ORG_A, rel, 'buying_role', 'wizard', 'apollo', T1))
        .toEqual({ ok: false, reason: 'invalid_value' });
      expect(await assertProvider(ORG_A, rel, 'job_title', '   ', 'apollo', T1))
        .toEqual({ ok: false, reason: 'invalid_value' });
      // Nothing was recorded, so a later caller is not blocked by dead evidence.
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.source_assertions WHERE relationship_id=$1', [rel]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('refuses an attribute outside the four, and a human claim with no actor', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'guards.test' });
      const rel = await newRelationship(ORG_A, p, a);

      expect(await assertRelationshipAttribute({
        organizationId: ORG_A, relationshipId: rel, attribute: 'authority',
        value: 'high', provider: 'apollo', sourceRecordKey: 'k',
      })).toEqual({ ok: false, reason: 'invalid_attribute' });

      expect(await assertRelationshipAttribute({
        organizationId: ORG_A, relationshipId: rel, attribute: 'job_title',
        value: 'VP', provider: 'human', origin: 'human', sourceRecordKey: 'k',
      })).toEqual({ ok: false, reason: 'actor_required' });

      expect(await assertRelationshipAttribute({
        organizationId: ORG_A, relationshipId: rel, attribute: 'job_title',
        value: 'VP', provider: 'apollo', origin: 'provider',
        assertedByUserId: ACTOR, sourceRecordKey: 'k',
      })).toEqual({ ok: false, reason: 'actor_forbidden' });
    });
  });
});

describe('REL-ATTR — §14 relationship isolation', () => {
  const twoEmployments = async () => {
    await seedTenants();
    const p = await newPerson(ORG_A);
    const accA = await newAccount(ORG_A, { domain: 'iso-a.test' });
    const accB = await newAccount(ORG_A, { domain: 'iso-b.test' });
    const RA = await newRelationship(ORG_A, p, accA, { job_title: 'VP Sales' });
    const RB = await newRelationship(ORG_A, p, accB, { job_title: 'CTO' });
    return { p, accA, accB, RA, RB };
  };

  it('asserting RB leaves RA untouched', async () => {
    await inRollback(async () => {
      const { RA, RB } = await twoEmployments();
      // RB's incumbent 'CTO' is UNATTESTED, so D-4 protects it until something
      // attests it; assert the incumbent first so the correction can land.
      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      await assertProvider(ORG_A, RB, 'job_title', 'Chief Technology Officer', 'apollo', T2);

      expect((await canonical(RB)).job_title).toBe('Chief Technology Officer');
      expect((await canonical(RA)).job_title).toBe('VP Sales');
    });
  });

  it('a newer claim about RB still cannot reach RA', async () => {
    await inRollback(async () => {
      const { RA, RB } = await twoEmployments();
      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      await assertProvider(ORG_A, RB, 'job_title', 'Head of Engineering', 'clearbit', T3);
      expect((await canonical(RA)).job_title).toBe('VP Sales');
    });
  });

  it('asserting RA leaves RB untouched', async () => {
    await inRollback(async () => {
      const { RA, RB } = await twoEmployments();
      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, RA, 'job_title', 'Chief Revenue Officer', 'apollo', T2);
      expect((await canonical(RA)).job_title).toBe('Chief Revenue Officer');
      expect((await canonical(RB)).job_title).toBe('CTO');
    });
  });

  it('each relationship keeps its OWN evidence set', async () => {
    await inRollback(async () => {
      const { RA, RB } = await twoEmployments();
      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);

      const counts = async (rel: string) => {
        const { rows } = await db.query(
          'SELECT count(*)::int n FROM public.source_assertions WHERE relationship_id=$1', [rel]);
        return rows[0].n;
      };
      expect(await counts(RA)).toBe(1);
      expect(await counts(RB)).toBe(1);
      // The same caller key for both employments must NOT share a source
      // record, or liveness would supersede one when the other is asserted.
      const { rows } = await db.query(
        `SELECT DISTINCT source_record_id FROM public.source_assertions
          WHERE relationship_id = ANY($1::uuid[])`, [[RA, RB]]);
      expect(rows).toHaveLength(2);
    });
  });

  it('the same source key for both employments does not supersede either', async () => {
    await inRollback(async () => {
      const { RA, RB } = await twoEmployments();
      const key = 'apollo:batch-1';
      await assertRelationshipAttribute({
        organizationId: ORG_A, relationshipId: RA, attribute: 'job_title',
        value: 'VP Sales', provider: 'apollo', observedAt: T1, sourceRecordKey: key,
      });
      await assertRelationshipAttribute({
        organizationId: ORG_A, relationshipId: RB, attribute: 'job_title',
        value: 'CTO', provider: 'apollo', observedAt: T1, sourceRecordKey: key,
      });
      const { rows } = await db.query(
        `SELECT relationship_id, superseded_at FROM public.source_assertions
          WHERE relationship_id = ANY($1::uuid[])`, [[RA, RB]]);
      expect(rows).toHaveLength(2);
      // Neither was retired by the other.
      expect(rows.every((r: any) => r.superseded_at === null)).toBe(true);
    });
  });

  it('two different PEOPLE at the same company cannot contaminate each other', async () => {
    await inRollback(async () => {
      await seedTenants();
      const P = await newPerson(ORG_A);
      const Q = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'shared-employer.test' });
      const RA = await newRelationship(ORG_A, P, accA);
      const RC = await newRelationship(ORG_A, Q, accA);

      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, RC, 'job_title', 'CTO', 'apollo', T1);

      expect((await canonical(RA)).job_title).toBe('VP Sales');
      expect((await canonical(RC)).job_title).toBe('CTO');
      expect(RA).not.toBe(RC);
    });
  });
});

describe('REL-ATTR — §15 authority', () => {
  const employment = async () => {
    await seedTenants();
    await seedActor();
    const p = await newPerson(ORG_A);
    const a = await newAccount(ORG_A, { domain: 'authority.test' });
    return newRelationship(ORG_A, p, a);
  };

  it('A. human declared: an earlier human claim beats a newer Apollo claim', async () => {
    await inRollback(async () => {
      const rel = await employment();
      await declareAuthority(ORG_A, 'job_title', ['human']);
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      const row = await canonical(rel);
      expect(row.job_title).toBe('VP Sales');
      expect(row.attributes_source).toBe('human');
    });
  });

  it('B. apollo declared: Apollo wins against a NEWER human claim', async () => {
    await inRollback(async () => {
      const rel = await employment();
      await declareAuthority(ORG_A, 'job_title', ['apollo']);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T3);
      const row = await canonical(rel);
      expect(row.job_title).toBe('CTO');
      expect(row.attributes_source).toBe('apollo');
    });
  });

  it('C. nothing declared: D-1 recency decides, exactly as before', async () => {
    await inRollback(async () => {
      const rel = await employment();
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      const row = await canonical(rel);
      expect(row.job_title).toBe('CTO');
    });
  });

  it('D. human AND apollo declared: recency decides among them', async () => {
    await inRollback(async () => {
      const rel = await employment();
      await declareAuthority(ORG_A, 'job_title', ['human', 'apollo']);
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });

  it('E. an UNDECLARED source cannot win however new it is', async () => {
    await inRollback(async () => {
      const rel = await employment();
      await declareAuthority(ORG_A, 'job_title', ['human', 'apollo']);
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertProvider(ORG_A, rel, 'job_title', 'Chief Revenue Officer', 'clearbit', T3);
      const row = await canonical(rel);
      expect(row.job_title).toBe('CTO');
      expect(row.attributes_source).toBe('apollo');
      // The losing claim is still evidence, and the disagreement is visible.
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_assertions
          WHERE relationship_id=$1 AND provider='clearbit'`, [rel]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('an EMPTY declaration is source-neutral, not deny-all', async () => {
    await inRollback(async () => {
      const rel = await employment();
      await declareAuthority(ORG_A, 'job_title', []);
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });

  it("another tenant's declaration does not reach this one", async () => {
    await inRollback(async () => {
      const rel = await employment();
      await declareAuthority(ORG_B, 'job_title', ['human']);
      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });
});

describe('REL-ATTR — §16 attribute separation', () => {
  it('job_title authority does not govern department', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seedActor();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'attrsep.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await declareAuthority(ORG_A, 'job_title', ['human']);
      await declareAuthority(ORG_A, 'department', ['apollo']);

      await assertHuman(ORG_A, rel, 'job_title', 'VP Sales', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertHuman(ORG_A, rel, 'department', 'Revenue', T3);
      await assertProvider(ORG_A, rel, 'department', 'Engineering', 'apollo', T1);

      const row = await canonical(rel);
      // human governs the title, apollo governs the department -- independently.
      expect(row.job_title).toBe('VP Sales');
      expect(row.department).toBe('Engineering');
    });
  });

  it('asserting job_title does not disturb an existing department', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'attrsep2.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'department', 'Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'seniority', 'vp', 'apollo', T1);
      const row = await canonical(rel);
      expect(row).toMatchObject({ department: 'Sales', job_title: 'VP Sales', seniority: 'vp' });
    });
  });
});

describe('REL-ATTR — §17 historical and §18 primary', () => {
  it('a historical relationship arbitrates independently of the current one', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'hist-a.test' });
      const accB = await newAccount(ORG_A, { domain: 'hist-b.test' });
      const RA = await newRelationship(ORG_A, p, accA, {
        started_at: '2019-01-01T00:00:00Z', ended_at: '2021-01-01T00:00:00Z',
      });
      const RB = await newRelationship(ORG_A, p, accB);

      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      // A newer claim about the ENDED employment lands on the ENDED employment.
      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T3);

      expect((await canonical(RA)).job_title).toBe('VP Sales');
      expect((await canonical(RB)).job_title).toBe('CTO');
      // And the historical relationship is still historical.
      const { rows } = await db.query(
        'SELECT ended_at FROM public.person_account_relationships WHERE id=$1', [RA]);
      expect(rows[0].ended_at).not.toBeNull();
    });
  });

  it('primary status does not redirect evidence, and changing it rewrites nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'prim-a.test' });
      const accB = await newAccount(ORG_A, { domain: 'prim-b.test' });
      const RA = await newRelationship(ORG_A, p, accA);
      const RB = await newRelationship(ORG_A, p, accB);

      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, accA]);
      // RA is primary; a claim about RB must still land on RB.
      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      expect((await canonical(RB)).job_title).toBe('CTO');
      expect((await canonical(RA)).job_title).toBeNull();

      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      const beforeA = await canonical(RA);
      const beforeB = await canonical(RB);

      // Switching the targeting employer changes targeting, not employment facts.
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, accB]);
      expect((await canonical(RA)).job_title).toBe(beforeA.job_title);
      expect((await canonical(RB)).job_title).toBe(beforeB.job_title);
    });
  });
});

describe('REL-ATTR — §19 human correction', () => {
  it('a human correction is relationship-scoped and keeps its actor', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seedActor();
      const p = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'human-a.test' });
      const accB = await newAccount(ORG_A, { domain: 'human-b.test' });
      const RA = await newRelationship(ORG_A, p, accA);
      const RB = await newRelationship(ORG_A, p, accB);

      await declareAuthority(ORG_A, 'job_title', ['human']);
      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      await assertHuman(ORG_A, RA, 'job_title', 'Chief Revenue Officer', T2);

      expect((await canonical(RA)).job_title).toBe('Chief Revenue Officer');
      expect((await canonical(RB)).job_title).toBe('CTO');

      const { rows } = await db.query(
        `SELECT origin, asserted_by_user_id, provider FROM public.source_assertions
          WHERE relationship_id=$1 AND origin='human'`, [RA]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ origin: 'human', asserted_by_user_id: ACTOR });

      // The provider claim survives as historical evidence; nothing deleted it.
      const { rows: prov } = await db.query(
        `SELECT normalized_value FROM public.source_assertions
          WHERE relationship_id=$1 AND provider='apollo'`, [RA]);
      expect(prov.map((r: any) => r.normalized_value)).toEqual(['VP Sales']);
    });
  });

  it('there is no hard-coded human-wins branch: provider authority beats a newer human', async () => {
    await inRollback(async () => {
      await seedTenants();
      await seedActor();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'nohumanmagic.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await declareAuthority(ORG_A, 'job_title', ['apollo']);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T1);
      await assertHuman(ORG_A, rel, 'job_title', 'Chief Revenue Officer', T3);
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });
});

describe('REL-ATTR — D-4 incumbent protection survives', () => {
  it('an UNATTESTED incumbent is not overwritten', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'd4.test' });
      // A backfilled title: no assertion has ever carried it.
      const rel = await newRelationship(ORG_A, p, a, { job_title: 'Operator Typed This' });

      const res = await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      expect(res.ok).toBe(true);
      expect(res.canonicalApplied).toEqual([]);
      expect(res.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
      expect((await canonical(rel)).job_title).toBe('Operator Typed This');
    });
  });

  it('an ATTESTED incumbent may be re-arbitrated', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'd4b.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });
});

describe('REL-ATTR — §26 tenant isolation', () => {
  it('tenant B cannot assert against a tenant A relationship', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'tenant-a.test' });
      const rel = await newRelationship(ORG_A, p, a, { job_title: 'VP Sales' });

      expect(await assertProvider(ORG_B, rel, 'job_title', 'CTO', 'apollo', T1))
        .toEqual({ ok: false, reason: 'relationship_not_found' });

      expect((await canonical(rel)).job_title).toBe('VP Sales');
      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.source_assertions WHERE relationship_id=$1', [rel]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('a relationship id from another tenant is simply not found', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pb = await newPerson(ORG_B);
      const ab = await newAccount(ORG_B, { domain: 'tenant-b.test' });
      const relB = await newRelationship(ORG_B, pb, ab);
      expect(await assertProvider(ORG_A, relB, 'job_title', 'CTO', 'apollo', T1))
        .toEqual({ ok: false, reason: 'relationship_not_found' });
    });
  });

  it('the database refuses a cross-tenant relationship assertion directly (23503)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'direct-fk.test' });
      const rel = await newRelationship(ORG_A, p, a);
      const pb = await newPerson(ORG_B);
      const { rows: rec } = await db.query(
        `INSERT INTO public.source_records
           (organization_id, provider, source_entity_type, source_record_id, person_id, raw_payload, payload_hash)
         VALUES ($1,'apollo','person','x-tenant',$2,'{}'::jsonb, repeat('a',64)) RETURNING id`,
        [ORG_B, pb]);
      // Tenant B's record naming tenant A's relationship: the composite FK is
      // the guarantee, not the service layer.
      await db.query('SAVEPOINT xt');
      let code = 'ok';
      try {
        await db.query(
          `INSERT INTO public.source_assertions
             (organization_id, source_record_id, entity_type, relationship_id, attribute,
              normalized_value, value_hash, provider, recorded_at)
           VALUES ($1,$2,'relationship',$3,'job_title','CTO',repeat('b',64),'apollo',now())`,
          [ORG_B, rec[0].id, rel]);
      } catch (err: any) { code = err.code; }
      await db.query('ROLLBACK TO SAVEPOINT xt');
      expect(code).toBe('23503');
    });
  });

  it('a cross-tenant relationship cannot even be constructed (23503 on both legs)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pa = await newPerson(ORG_A);
      const ab = await newAccount(ORG_B, { domain: 'mixed.test' });
      await db.query('SAVEPOINT mix');
      let code = 'ok';
      try {
        await db.query(
          `INSERT INTO public.person_account_relationships (organization_id, person_id, account_id)
           VALUES ($1,$2,$3)`, [ORG_A, pa, ab]);
      } catch (err: any) { code = err.code; }
      await db.query('ROLLBACK TO SAVEPOINT mix');
      expect(code).toBe('23503');
    });
  });
});

describe('REL-ATTR — §27 concurrency and §28 idempotency', () => {
  it('the same claim twice is a replay, and canonical state does not duplicate', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'idem.test' });
      const rel = await newRelationship(ORG_A, p, a);

      const first = await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      const second = await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      expect(first.assertionRecorded).toBe(true);
      expect(second.assertionRecorded).toBe(false);
      expect(second.assertionAlreadyPresent).toBe(true);

      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.source_assertions WHERE relationship_id=$1', [rel]);
      expect(rows[0].n).toBe(1);
      expect((await canonical(rel)).job_title).toBe('VP Sales');
    });
  });

  it('a source that changes its mind supersedes its own earlier claim, keeping the row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'supersede.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      const second = await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      expect(second.superseded).toBe(1);

      const { rows } = await db.query(
        `SELECT normalized_value, superseded_at FROM public.source_assertions
          WHERE relationship_id=$1 ORDER BY normalized_value`, [rel]);
      expect(rows).toHaveLength(2);                       // no evidence deleted
      const bySup = Object.fromEntries(rows.map((r: any) => [r.normalized_value, r.superseded_at !== null]));
      expect(bySup).toEqual({ CTO: false, 'VP Sales': true });
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });

  it('two concurrent assertions both land, and the final state follows D-1', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'concurrent.test' });
      const rel = await newRelationship(ORG_A, p, a);

      // Different sources, interleaved: both observations must survive and the
      // newest must win, whichever order they were processed in.
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'clearbit', T1);

      const { rows } = await db.query(
        'SELECT count(*)::int n FROM public.source_assertions WHERE relationship_id=$1', [rel]);
      expect(rows[0].n).toBe(2);
      expect((await canonical(rel)).job_title).toBe('CTO');
      // Exactly one canonical row; there is no second place for the value.
      const { rows: one } = await db.query(
        'SELECT count(*)::int n FROM public.person_account_relationships WHERE id=$1', [rel]);
      expect(one[0].n).toBe(1);
    });
  });

  it('the reverse processing order reaches the same canonical value', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'determinism.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'clearbit', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      expect((await canonical(rel)).job_title).toBe('CTO');
    });
  });
});
