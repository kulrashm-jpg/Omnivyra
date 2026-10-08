/**
 * B1b — the canonical decision log at RELATIONSHIP scope, against real
 * PostgreSQL.
 *
 * The decision log answers "which value did we choose, from which evidence, and
 * why", and almost every guarantee worth having about it is enforced by the
 * database rather than by code: append-only is a trigger, tenant safety is a
 * composite foreign key, and "a relationship decision must name its
 * relationship" is an INSERT-time trigger rather than a CHECK precisely so that
 * erasure can still detach it. None of that can be established with a mock.
 *
 * `ownedDbTable` is adapted onto the live pg client, so the REAL producer, the
 * REAL b1b boundary and the REAL authority resolver execute against the REAL
 * schema, and the decision rows under test are the ones the producer actually
 * wrote.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, newPerson, newAccount, constraintDef,
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

/* eslint-disable @typescript-eslint/no-var-requires */
const { assertRelationshipAttribute } =
  require('../../services/prospectIdentity/relationshipAttributeIngestion');
/* eslint-enable @typescript-eslint/no-var-requires */

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-06-01T00:00:00.000Z';
const T3 = '2026-09-01T00:00:00.000Z';

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

const assertProvider = (
  org: string, relationshipId: string, attribute: string, value: string,
  provider: string, observedAt: string,
) => assertRelationshipAttribute({
  organizationId: org, relationshipId, attribute, value, provider,
  observedAt, sourceRecordKey: `${provider}:${attribute}`,
});

const decisions = async (relationshipId: string, attribute?: string) => {
  const { rows } = await db.query(
    `SELECT entity_type, relationship_id, person_id, account_id, attribute, value, reason,
            assertion_id, decided_at
       FROM public.canonical_attribute_decisions
      WHERE relationship_id = $1 ${attribute ? 'AND attribute = $2' : ''}
      ORDER BY decided_at, value`, attribute ? [relationshipId, attribute] : [relationshipId]);
  return rows;
};

/**
 * A real assertion to hang a decision on.
 *
 * `canonical_decisions_assertion_tenant_fk` is composite and NOT NULL, so every
 * decision — person, account or relationship — must name evidence that actually
 * exists in the same tenant. Inventing a uuid fails 23503, which is a correct
 * refusal but not the one a test about entity types is asking about.
 */
const realAssertion = async (
  org: string, person: string, seed: string,
  over: Record<string, unknown> = {},
): Promise<string> => {
  const { rows: rec } = await db.query(
    `INSERT INTO public.source_records
       (organization_id, provider, source_entity_type, source_record_id, person_id, raw_payload, payload_hash)
     VALUES ($1,'apollo','person',$2,$3,'{}'::jsonb,$4)
     ON CONFLICT (organization_id, provider, source_entity_type, source_record_id) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [org, `dl:${seed}`, person, seed.padEnd(64, '0').replace(/[^a-f0-9]/g, '0')]);
  const cols = ['organization_id', 'source_record_id', 'entity_type', 'attribute',
    'normalized_value', 'value_hash', 'provider', 'recorded_at'];
  const vals: unknown[] = [org, rec[0].id, 'person', 'job_title', `v-${seed}`,
    `${seed}`.padEnd(64, '0').replace(/[^a-f0-9]/g, '1'), 'apollo', new Date().toISOString()];
  for (const [k, v] of Object.entries(over)) { cols.push(k); vals.push(v); }
  const { rows } = await db.query(
    `INSERT INTO public.source_assertions (${cols.join(', ')})
     VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals);
  return rows[0].id as string;
};

/** Run a statement and return its SQLSTATE, or 'ok'. */
const attemptCode = async (sql: string, params: unknown[] = []): Promise<string> => {
  await db.query('SAVEPOINT dl');
  try {
    await db.query(sql, params);
    await db.query('ROLLBACK TO SAVEPOINT dl');
    return 'ok';
  } catch (err: any) {
    await db.query('ROLLBACK TO SAVEPOINT dl');
    return err.code ?? 'unknown';
  }
};

// ═══════════════════════════════════════════════════════════════════════════
describe('DL — schema invariants', () => {
  it('there is exactly ONE canonical decision table', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE '%canonical%decision%'`);
      expect(rows.map((r: any) => r.table_name)).toEqual(['canonical_attribute_decisions']);
    });
  });

  it('entity_type accepts all three scopes and nothing else', async () => {
    await inRollback(async () => {
      const def = await constraintDef('canonical_decisions_entity_type_valid');
      for (const v of ['person', 'account', 'relationship']) expect(def).toContain(`'${v}'`);
      await seedTenants();
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'employment','job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A])).toBe('23514');
    });
  });

  it('relationship_id exists and is NULLABLE, so a detached decision is storable', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='canonical_attribute_decisions'
            AND column_name='relationship_id'`);
      expect(rows[0].is_nullable).toBe('YES');
    });
  });

  it('the relationship tenant FK is COMPOSITE', async () => {
    await inRollback(async () => {
      const def = await constraintDef('canonical_decisions_relationship_tenant_fk');
      expect(def).toBeTruthy();
      expect(def).toMatch(/, organization_id\)/);
      expect(def).toMatch(/person_account_relationships/);
    });
  });

  it('there is NO TTL or retention column', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='canonical_attribute_decisions'`);
      for (const r of rows as Array<{ column_name: string }>) {
        expect(r.column_name).not.toMatch(/expire|expiry|ttl|valid_until|effective_until|purge|retain/);
      }
    });
  });
});

describe('DL — entity-type invariants are structural', () => {
  const subject = async () => {
    await seedTenants();
    const p = await newPerson(ORG_A);
    const a = await newAccount(ORG_A, { domain: 'dl-invariant.test' });
    const rel = await newRelationship(ORG_A, p, a);
    return { p, a, rel };
  };

  it('a relationship decision with NO relationship_id is refused at insert', async () => {
    await inRollback(async () => {
      await subject();
      // The INSERT-time trigger, not a CHECK: that is what lets erasure detach
      // a recorded decision later.
      const code = await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'relationship','job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A]);
      expect(code).toBe('P0001');
    });
  });

  it('a relationship decision may not also name a person or an account', async () => {
    await inRollback(async () => {
      const { p, a, rel } = await subject();
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, relationship_id, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'relationship',$2,$3,'job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A, rel, p])).toBe('23514');
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, relationship_id, account_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'relationship',$2,$3,'job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A, rel, a])).toBe('23514');
    });
  });

  it('a person or account decision may NOT carry a relationship_id', async () => {
    await inRollback(async () => {
      const { p, a, rel } = await subject();
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, relationship_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,$3,'job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A, p, rel])).toBe('23514');
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, account_id, relationship_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'account',$2,$3,'industry',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A, a, rel])).toBe('23514');
    });
  });

  it('a relationship decision may only name an employment attribute', async () => {
    await inRollback(async () => {
      const { p, rel } = await subject();
      const ev = await realAssertion(ORG_A, p, 'abc1');
      for (const bad of ['authority', 'influence', 'full_name', 'industry']) {
        expect(await attemptCode(
          `INSERT INTO public.canonical_attribute_decisions
             (organization_id, entity_type, relationship_id, attribute, assertion_id, value, reason, decided_at)
           VALUES ($1,'relationship',$2,$3,$4,'x','newest_observation',now())`,
          [ORG_A, rel, bad, ev])).toBe('23514');
      }
      // ...and the four employment attributes are accepted.
      for (const good of ['job_title', 'department', 'seniority', 'buying_role']) {
        expect(await attemptCode(
          `INSERT INTO public.canonical_attribute_decisions
             (organization_id, entity_type, relationship_id, attribute, assertion_id, value, reason, decided_at)
           VALUES ($1,'relationship',$2,$3,$4,'x','newest_observation',now())`,
          [ORG_A, rel, good, ev])).toBe('ok');
      }
    });
  });

  it('a decision must name REAL evidence in its own tenant', async () => {
    await inRollback(async () => {
      const { rel } = await subject();
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, relationship_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'relationship',$2,'job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A, rel])).toBe('23503');
    });
  });
});

describe('DL — append-only survives the new subject', () => {
  const recorded = async () => {
    await seedTenants();
    const p = await newPerson(ORG_A);
    const a = await newAccount(ORG_A, { domain: 'dl-append.test' });
    const rel = await newRelationship(ORG_A, p, a);
    await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
    const { rows } = await db.query(
      'SELECT id FROM public.canonical_attribute_decisions WHERE relationship_id=$1', [rel]);
    return { rel, decisionId: rows[0].id as string };
  };

  it('a recorded relationship decision can never be DELETED', async () => {
    await inRollback(async () => {
      const { decisionId } = await recorded();
      expect(await attemptCode(
        'DELETE FROM public.canonical_attribute_decisions WHERE id=$1', [decisionId])).toBe('P0001');
    });
  });

  it('a recorded relationship decision can never be RE-POINTED at another relationship', async () => {
    await inRollback(async () => {
      const { rel, decisionId } = await recorded();
      const p2 = await newPerson(ORG_A);
      const a2 = await newAccount(ORG_A, { domain: 'dl-other.test' });
      const other = await newRelationship(ORG_A, p2, a2);
      expect(other).not.toBe(rel);
      // Without the extended guard this would succeed and a decision about one
      // employer could be silently re-attributed to another.
      expect(await attemptCode(
        'UPDATE public.canonical_attribute_decisions SET relationship_id=$1 WHERE id=$2',
        [other, decisionId])).toBe('P0001');
    });
  });

  it('its value, reason and attribute can never be modified', async () => {
    await inRollback(async () => {
      const { decisionId } = await recorded();
      for (const sql of [
        'UPDATE public.canonical_attribute_decisions SET value=$1 WHERE id=$2',
        'UPDATE public.canonical_attribute_decisions SET reason=$1 WHERE id=$2',
        'UPDATE public.canonical_attribute_decisions SET attribute=$1 WHERE id=$2',
      ]) {
        expect(await attemptCode(sql, ['tampered', decisionId])).toBe('P0001');
      }
    });
  });

  it('deleting a relationship with a recorded decision is REFUSED by append-only', async () => {
    await inRollback(async () => {
      const { rel } = await recorded();
      // The chain, and it is worth stating because it is this gate's blocking
      // finding: deleting the relationship cascade-deletes its assertions
      // (`source_assertions_relationship_tenant_fk ON DELETE CASCADE`, frozen
      // in migration 20261122000000), which cascade-deletes the decisions
      // (`canonical_decisions_assertion_tenant_fk ON DELETE CASCADE`, frozen in
      // 20261119000000) -- and append-only refuses every DELETE.
      //
      // The decision log cannot be both absolutely append-only and deletable
      // with its evidence. Which of the two gives way is an owner decision, so
      // this test pins what the schema ACTUALLY does today rather than what
      // would be convenient.
      const code = await attemptCode(
        'DELETE FROM public.person_account_relationships WHERE id=$1', [rel]);
      expect(code).toBe('P0001');
    });
  });

  it('and therefore erasing a person with a recorded relationship decision is refused', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-erase.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      expect(rel).toBeTruthy();

      // `deletePersonRow` (WS-F erasure) deletes the person, which cascades to
      // the relationship and then down the chain above. This is a REGRESSION
      // introduced by recording relationship decisions, and it is reported
      // rather than worked around.
      expect(await attemptCode(
        'DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('P0001');
    });
  });

  it('a person with NO relationship decision can still be erased', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-erase-ok.test' });
      await newRelationship(ORG_A, p, a);
      // Scope of the regression: it is the DECISION that blocks erasure, not
      // the relationship and not the evidence.
      expect(await attemptCode(
        'DELETE FROM public.unified_persons WHERE id=$1', [p])).toBe('ok');
    });
  });
});

describe('DL — the producer records decisions, and only decisions', () => {
  it('a canonical decision produces exactly one decision row with full content', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-content.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      const rows = await decisions(rel);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entity_type: 'relationship', relationship_id: rel,
        person_id: null, account_id: null,
        attribute: 'job_title', value: 'VP Sales',
        reason: 'single_uncontested_assertion',
      });
      expect(rows[0].assertion_id).not.toBeNull();
      expect(rows[0].decided_at).not.toBeNull();

      // The logged assertion is the one that actually won.
      const { rows: a1 } = await db.query(
        `SELECT normalized_value, provider FROM public.source_assertions WHERE id=$1`,
        [rows[0].assertion_id]);
      expect(a1[0]).toMatchObject({ normalized_value: 'VP Sales', provider: 'apollo' });
    });
  });

  it('a LOSING assertion produces evidence but NO decision', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-loser.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await db.query(
        `INSERT INTO public.attribute_authority_declarations
           (organization_id, entity_type, attribute, authoritative_providers)
         VALUES ($1,'relationship','job_title',ARRAY['apollo'])`, [ORG_A]);

      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T1);
      const after = (await decisions(rel)).length;
      // clearbit is not declared authoritative, so it cannot win.
      await assertProvider(ORG_A, rel, 'job_title', 'Head of Sales', 'clearbit', T3);

      expect((await decisions(rel)).length).toBe(after);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_assertions
          WHERE relationship_id=$1 AND provider='clearbit'`, [rel]);
      expect(rows[0].n).toBe(1);            // evidence kept
    });
  });

  it('logs each APPLIED attribute under its own name, not the asserted one', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-multi.test' });
      const rel = await newRelationship(ORG_A, p, a);

      // A department claim recorded WITHOUT going through the producer, so no
      // canonical write happened for it yet. The next producer call therefore
      // arbitrates BOTH attributes and applies both at once -- which is the
      // only situation in which "the attribute this call asserted" and "the
      // attribute this decision is about" can differ.
      const { rows: rec } = await db.query(
        `INSERT INTO public.source_records
           (organization_id, provider, source_entity_type, source_record_id, person_id, raw_payload, payload_hash)
         VALUES ($1,'apollo','person','dl-multi-rec',$2,'{}'::jsonb,$3) RETURNING id`,
        [ORG_A, p, 'c'.repeat(64)]);
      await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, relationship_id, attribute,
            normalized_value, value_hash, provider, observed_at, recorded_at)
         VALUES ($1,$2,'relationship',$3,'department','Sales',$4,'apollo',$5,$5)`,
        [ORG_A, rec[0].id, rel, 'd'.repeat(64), T1]);

      const res = await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      expect(res.canonicalApplied.map((x: any) => x.attribute).sort())
        .toEqual(['department', 'job_title']);

      const { rows } = await db.query(
        `SELECT attribute, value FROM public.canonical_attribute_decisions
          WHERE relationship_id=$1 ORDER BY attribute`, [rel]);
      // Two decisions, each naming ITS OWN attribute and value.
      expect(rows.map((r: any) => [r.attribute, r.value]))
        .toEqual([['department', 'Sales'], ['job_title', 'VP Sales']]);
    });
  });

  it('a WITHHELD decision (unattested incumbent) produces no decision row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-withheld.test' });
      const rel = await newRelationship(ORG_A, p, a, { job_title: 'Operator Typed This' });
      const res = await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      expect(res.canonicalApplied).toEqual([]);
      expect(await decisions(rel)).toEqual([]);
    });
  });
});

describe('DL — history survives value changes', () => {
  it('VP Sales -> CTO -> Chief Revenue Officer leaves three decisions, in order', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-history.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertProvider(ORG_A, rel, 'job_title', 'Chief Revenue Officer', 'apollo', T3);

      const { rows } = await db.query(
        `SELECT value FROM public.canonical_attribute_decisions
          WHERE relationship_id=$1 AND attribute='job_title' ORDER BY decided_at`, [rel]);
      expect(rows.map((r: any) => r.value)).toEqual(['VP Sales', 'CTO', 'Chief Revenue Officer']);
      // The newest decision is what we believe now; the rest are why.
      const { rows: now } = await db.query(
        'SELECT job_title FROM public.person_account_relationships WHERE id=$1', [rel]);
      expect(now[0].job_title).toBe('Chief Revenue Officer');
    });
  });

  it('a value that returns is appended again rather than rewritten', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-rewin.test' });
      const rel = await newRelationship(ORG_A, p, a);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T3);

      const { rows } = await db.query(
        `SELECT value FROM public.canonical_attribute_decisions
          WHERE relationship_id=$1 ORDER BY decided_at`, [rel]);
      // Three rows, not two: `applied_to_canonical_at` has room for one event,
      // which is exactly why the log exists.
      expect(rows.map((r: any) => r.value)).toEqual(['VP Sales', 'CTO', 'VP Sales']);
    });
  });
});

describe('DL — relationship isolation', () => {
  it('a decision is recorded for the asserted relationship ONLY', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'dl-iso-a.test' });
      const accB = await newAccount(ORG_A, { domain: 'dl-iso-b.test' });
      const RA = await newRelationship(ORG_A, p, accA);
      const RB = await newRelationship(ORG_A, p, accB);

      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      expect((await decisions(RB)).map((r: any) => r.value)).toEqual(['CTO']);
      expect(await decisions(RA)).toEqual([]);

      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      expect((await decisions(RA)).map((r: any) => r.value)).toEqual(['VP Sales']);
      // RB's history is intact and unmixed.
      expect((await decisions(RB)).map((r: any) => r.value)).toEqual(['CTO']);
    });
  });

  it('two people at the same company get separate decision histories', async () => {
    await inRollback(async () => {
      await seedTenants();
      const P = await newPerson(ORG_A);
      const Q = await newPerson(ORG_A);
      const acc = await newAccount(ORG_A, { domain: 'dl-shared.test' });
      const RA = await newRelationship(ORG_A, P, acc);
      const RC = await newRelationship(ORG_A, Q, acc);

      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, RC, 'job_title', 'CTO', 'apollo', T1);
      expect((await decisions(RA)).map((r: any) => r.value)).toEqual(['VP Sales']);
      expect((await decisions(RC)).map((r: any) => r.value)).toEqual(['CTO']);
    });
  });
});

describe('DL — attribute separation', () => {
  it('a job_title decision never becomes a department decision', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-attr.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'department', 'Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'seniority', 'vp', 'apollo', T1);

      const { rows } = await db.query(
        `SELECT attribute, value FROM public.canonical_attribute_decisions
          WHERE relationship_id=$1 ORDER BY attribute`, [rel]);
      expect(rows.map((r: any) => [r.attribute, r.value])).toEqual([
        ['department', 'Sales'], ['job_title', 'VP Sales'], ['seniority', 'vp'],
      ]);
      expect((await decisions(rel, 'job_title')).map((r: any) => r.value)).toEqual(['VP Sales']);
    });
  });
});

describe('DL — tenant isolation is structural', () => {
  it('a tenant B decision naming a tenant A relationship is refused (23503)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-xt-a.test' });
      const relA = await newRelationship(ORG_A, p, a);
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, relationship_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'relationship',$2,'job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_B, relA])).toBe('23503');
    });
  });

  it('and the inverse: tenant A naming a tenant B relationship', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pb = await newPerson(ORG_B);
      const ab = await newAccount(ORG_B, { domain: 'dl-xt-b.test' });
      const relB = await newRelationship(ORG_B, pb, ab);
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, relationship_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'relationship',$2,'job_title',gen_random_uuid(),'x','newest_observation',now())`,
        [ORG_A, relB])).toBe('23503');
    });
  });

  it('the application also fails closed: no decision is written cross-tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-xt-app.test' });
      const rel = await newRelationship(ORG_A, p, a);
      expect(await assertProvider(ORG_B, rel, 'job_title', 'CTO', 'apollo', T1))
        .toEqual({ ok: false, reason: 'relationship_not_found' });
      expect(await decisions(rel)).toEqual([]);
    });
  });
});

describe('DL — historical and primary independence', () => {
  it('a correction to an ENDED relationship is recorded against that relationship', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'dl-hist-a.test' });
      const accB = await newAccount(ORG_A, { domain: 'dl-hist-b.test' });
      const RA = await newRelationship(ORG_A, p, accA, {
        started_at: '2019-01-01T00:00:00Z', ended_at: '2021-01-01T00:00:00Z',
      });
      const RB = await newRelationship(ORG_A, p, accB);

      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      await assertProvider(ORG_A, RA, 'job_title', 'VP Sales', 'apollo', T3);

      expect((await decisions(RA)).map((r: any) => r.relationship_id)).toEqual([RA]);
      expect((await decisions(RB)).map((r: any) => r.relationship_id)).toEqual([RB]);
    });
  });

  it('primary status does not choose the decision subject, and switching rewrites nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const accA = await newAccount(ORG_A, { domain: 'dl-prim-a.test' });
      const accB = await newAccount(ORG_A, { domain: 'dl-prim-b.test' });
      const RA = await newRelationship(ORG_A, p, accA);
      const RB = await newRelationship(ORG_A, p, accB);

      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, accA]);
      await assertProvider(ORG_A, RB, 'job_title', 'CTO', 'apollo', T1);
      // RA is primary, yet the decision belongs to RB.
      expect((await decisions(RB)).map((r: any) => r.relationship_id)).toEqual([RB]);
      expect(await decisions(RA)).toEqual([]);

      const before = await decisions(RB);
      await db.query('SELECT public.pi_relationship_set_primary($1,$2,$3)', [ORG_A, p, accB]);
      expect(await decisions(RB)).toEqual(before);
      expect(await decisions(RA)).toEqual([]);
    });
  });
});

describe('DL — concurrency and idempotency', () => {
  it('a replayed assertion adds no second decision row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-replay.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);
      // Idempotency comes from arbitration applying nothing when the value is
      // already in force -- the existing contract, not a new digest.
      expect((await decisions(rel)).map((r: any) => r.value)).toEqual(['VP Sales']);
    });
  });

  it('two competing claims leave one decision and the D-1 winner', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-conc.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'clearbit', T1);

      // The older claim cannot displace the newer, so it decides nothing.
      expect((await decisions(rel)).map((r: any) => r.value)).toEqual(['CTO']);
      const { rows } = await db.query(
        'SELECT job_title FROM public.person_account_relationships WHERE id=$1', [rel]);
      expect(rows[0].job_title).toBe('CTO');
      // Both assertions survive as evidence.
      const { rows: ev } = await db.query(
        'SELECT count(*)::int n FROM public.source_assertions WHERE relationship_id=$1', [rel]);
      expect(ev[0].n).toBe(2);
    });
  });

  it('the reverse order reaches the same canonical value and the same final decision', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const a = await newAccount(ORG_A, { domain: 'dl-conc2.test' });
      const rel = await newRelationship(ORG_A, p, a);

      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'clearbit', T1);
      await assertProvider(ORG_A, rel, 'job_title', 'CTO', 'apollo', T2);

      const values = (await decisions(rel)).map((r: any) => r.value);
      expect(values[values.length - 1]).toBe('CTO');
      const { rows } = await db.query(
        'SELECT job_title FROM public.person_account_relationships WHERE id=$1', [rel]);
      expect(rows[0].job_title).toBe('CTO');
    });
  });
});

describe('DL — person and account regression', () => {
  it('a person decision is still storable with no relationship', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const ev = await realAssertion(ORG_A, p, 'bcd2');
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,'job_title',$3,'VP Sales','newest_observation',now())`,
        [ORG_A, p, ev])).toBe('ok');
    });
  });

  it('an account decision is still storable, with the wider account surface', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await newAccount(ORG_A, { domain: 'dl-acct.test' });
      const p = await newPerson(ORG_A);
      const ev = await realAssertion(ORG_A, p, 'cde3');
      // `industry` is NOT in the relationship surface; the relationship
      // attribute CHECK must not have narrowed account decisions.
      expect(await attemptCode(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, account_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'account',$2,'industry',$3,'Software','newest_observation',now())`,
        [ORG_A, a, ev])).toBe('ok');
    });
  });

  it('all three scopes coexist in the one table', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const acc = await newAccount(ORG_A, { domain: 'dl-coexist.test' });
      const rel = await newRelationship(ORG_A, p, acc);

      const ev1 = await realAssertion(ORG_A, p, 'def4');
      const ev2 = await realAssertion(ORG_A, p, 'ef05');
      await db.query(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,'full_name',$3,'A Person','newest_observation',now())`,
        [ORG_A, p, ev1]);
      await db.query(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, account_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'account',$2,'industry',$3,'Software','newest_observation',now())`,
        [ORG_A, acc, ev2]);
      await assertProvider(ORG_A, rel, 'job_title', 'VP Sales', 'apollo', T1);

      const { rows } = await db.query(
        `SELECT entity_type, count(*)::int n FROM public.canonical_attribute_decisions
          WHERE organization_id=$1 GROUP BY entity_type ORDER BY entity_type`, [ORG_A]);
      expect(rows.map((r: any) => [r.entity_type, r.n]))
        .toEqual([['account', 1], ['person', 1], ['relationship', 1]]);
    });
  });

  it('the person and account partial history indexes are still present', async () => {
    await inRollback(async () => {
      const { rows } = await db.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname='public'
            AND tablename='canonical_attribute_decisions' ORDER BY indexname`);
      const names = rows.map((r: any) => r.indexname);
      expect(names).toContain('idx_canonical_decisions_person_attr');
      expect(names).toContain('idx_canonical_decisions_account_attr');
      expect(names).toContain('idx_canonical_decisions_relationship_attr');
      expect(names).toContain('idx_canonical_decisions_assertion');
    });
  });
});
