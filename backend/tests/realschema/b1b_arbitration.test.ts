/**
 * B1b — source arbitration against real PostgreSQL.
 *
 * The properties here cannot be mocked, and the ones that matter most are the ones
 * a unit test would have asserted falsely:
 *
 *   - that the decision log is genuinely append-only, which is a trigger;
 *   - that a decision cannot name another tenant's evidence, which is a composite
 *     foreign key;
 *   - that re-asserting a previously superseded value does not collide with the
 *     dedupe unique index — the 23505 B1a told this gate to find here rather than
 *     in production;
 *   - that `superseded_at`, which had no writer at all before B1b, is actually
 *     written on the real schema.
 *
 * `ownedDbTable` is mocked onto the live pg client so the REAL boundary code runs
 * against the REAL schema. Nothing about arbitration is stubbed.
 */
import {
  db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson,
} from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      cols: '*', payload: null as Record<string, unknown> | null,
      filters: [] as Filter[], order: null as { col: string; asc: boolean } | null,
      limit: null as number | null, mode: 'many' as 'many' | 'one',
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
      if (st.op === 'insert') {
        const row = st.payload ?? {};
        const keys = Object.keys(row);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => {
          params.push(row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]);
          return `$${params.length}`;
        }).join(', ');
        sql = `INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING ${st.cols}`;
      } else if (st.op === 'update') {
        const row = st.payload ?? {};
        const sets = Object.keys(row).map((k) => {
          params.push(row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]);
          return `"${k}" = $${params.length}`;
        }).join(', ');
        sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${st.cols}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${st.cols}`;
      } else {
        sql = `SELECT ${st.cols} FROM public."${table}"${where(params)}`;
        if (st.order) sql += ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}`;
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
      insert: (row: Record<string, unknown>) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Record<string, unknown>) => { st.op = 'update'; st.payload = row; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (col: string, val: unknown) => { st.filters.push({ col, op: 'eq', val }); return b; },
      is: (col: string, val: unknown) => { st.filters.push({ col, op: 'is', val }); return b; },
      in: (col: string, val: unknown[]) => { st.filters.push({ col, op: 'in', val }); return b; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        st.order = { col, asc: opts?.ascending !== false }; return b;
      },
      limit: (n: number) => { st.limit = n; return b; },
      single: () => { st.mode = 'one'; return b; },
      maybeSingle: () => { st.mode = 'one'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
  /**
   * The RPC leg of the write seam, onto the SAME live connection.
   *
   * `pi_apply_canonical_decisions` is where the canonical update, the decision
   * log and the provenance stamp now happen, so without this the boundary's
   * final write would not reach the database at all and every canonical
   * assertion below would be vacuous.
   *
   * Named-argument form, so PostgreSQL resolves each parameter's type from the
   * function signature — which is what lets a JSON string arrive as `jsonb` and
   * an ISO string as `timestamptz` without a hand-written cast.
   */
  ownedDbRpc: async (fn: string, args: Record<string, unknown>) => {
    const { db: client } = require('./setup') as { db: { query: Function } };
    const keys = Object.keys(args);
    const params = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    await client.query('SAVEPOINT pg_rpc');
    try {
      const res = await client.query(
        `SELECT public."${fn}"(${named}) AS result`, params,
      ) as { rows: Array<{ result: unknown }> };
      await client.query('RELEASE SAVEPOINT pg_rpc');
      return { data: res.rows[0]?.result ?? null, error: null };
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT pg_rpc');
      return { data: null, error: err };
    }
  },
}));

// Imported AFTER the mock so the boundary picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ingestSourceRecord, reconcileAssertionLiveness } =
  require('../../services/prospectIdentity/ingestionBoundary');

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
const T3 = '2026-03-01T00:00:00.000Z';

/** One person-shaped ingestion through the real boundary. */
const ingest = (org: string, personId: string, over: Record<string, unknown> = {}) =>
  ingestSourceRecord({
    organizationId: org,
    provider: 'alpha',
    entityType: 'person',
    sourceRecordId: 'REC-1',
    rawPayload: { seq: 1 },
    personId,
    observedAt: T1,
    personAttributes: { jobTitle: 'VP Sales' },
    ...over,
  }, over.now as string | undefined);

const titleOf = async (personId: string): Promise<string | null> => {
  const { rows } = await db.query('SELECT job_title FROM public.unified_persons WHERE id=$1', [personId]);
  return rows[0]?.job_title ?? null;
};

/** pg returns timestamptz as a Date, so compare the instant and not the object. */
const iso = (v: unknown): string | null =>
  (v === null || v === undefined ? null : new Date(v as string).toISOString());

const assertionsFor = async (personId: string) => {
  const { rows } = await db.query(
    `SELECT normalized_value, value_hash, superseded_at, applied_to_canonical_at, applied_reason
       FROM public.source_assertions
      WHERE person_id=$1 AND attribute='job_title'
      ORDER BY created_at, normalized_value`, [personId]);
  return rows as Array<{
    normalized_value: string; value_hash: string; superseded_at: string | null;
    applied_to_canonical_at: string | null; applied_reason: string | null;
  }>;
};

const decisionsFor = async (personId: string) => {
  const { rows } = await db.query(
    `SELECT attribute, value, reason, decided_at FROM public.canonical_attribute_decisions
      WHERE person_id=$1 ORDER BY decided_at, value`, [personId]);
  return rows as Array<{ attribute: string; value: string; reason: string; decided_at: string }>;
};

beforeAll(async () => { await seedTenants(); });

// ════════════════════════════════════════════════════════════════════════════
describe('B1b — schema shape', () => {
  it('the decision log exists, is tenant-scoped and has RLS', async () => {
    const { rows } = await db.query(
      `SELECT c.relrowsecurity rls,
              (SELECT count(*)::int FROM pg_attribute a
                WHERE a.attrelid=c.oid AND a.attname='organization_id'
                  AND NOT a.attisdropped AND a.attnotnull) tenant
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='canonical_attribute_decisions'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].rls).toBe(true);
    expect(rows[0].tenant).toBe(1);
  });

  it('has 4 composite tenant-safe foreign keys, tenant always the second leg', async () => {
    const { rows } = await db.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) d
        FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname='canonical_attribute_decisions'
         AND array_length(con.conkey,1)=2 ORDER BY con.conname`);
    // Four since migration 20261124000000 added
    // `canonical_decisions_relationship_tenant_fk`, the relationship subject.
    // The invariant below is what this test is really for and it is unchanged:
    // the loop still runs over every composite FK, so widening the count
    // strengthens the coverage rather than relaxing it.
    expect(rows).toHaveLength(4);
    for (const r of rows as any[]) expect(r.d).toMatch(/, organization_id\)/);
  });

  it('the assertion parent key exists and is NOT partial', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_source_assertions_id_org'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).not.toMatch(/\sWHERE\s/);
  });

  it('the append-only trigger is installed on UPDATE and DELETE', async () => {
    const { rows } = await db.query(
      `SELECT tgtype FROM pg_trigger WHERE tgname='canonical_decisions_append_only' AND NOT tgisinternal`);
    expect(rows).toHaveLength(1);
  });

  it('refuses a reason outside the ratified vocabulary', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const sr = await db.query(
        `INSERT INTO public.source_records
           (organization_id, provider, source_entity_type, source_record_id, payload_hash)
         VALUES ($1,'alpha','person','R',repeat('b',64)) RETURNING id`, [ORG_A]);
      const a = await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute,
            normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'person',$3,'job_title','X',repeat('a',64),'alpha',now()) RETURNING id`,
        [ORG_A, sr.rows[0].id, p]);
      const assertionId = a.rows[0].id as string;
      expect(await attempt(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,'job_title',$3,'X','invented_rule',now())`,
        [ORG_A, p, assertionId])).toBe('23514');
      expect(await attempt(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,'job_title',$3,'X','newest_observation',now())`,
        [ORG_A, p, assertionId])).toBe('ok');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B1b — the decision log is append-only, enforced by the database', () => {
  const seedDecision = async (org: string, personId: string) => {
    const sr = await db.query(
      `INSERT INTO public.source_records
         (organization_id, provider, source_entity_type, source_record_id, payload_hash)
       VALUES ($1,'alpha','person','R1',repeat('b',64)) RETURNING id`, [org]);
    const a = await db.query(
      `INSERT INTO public.source_assertions
         (organization_id, source_record_id, entity_type, person_id, attribute,
          normalized_value, value_hash, provider, recorded_at)
       VALUES ($1,$2,'person',$3,'job_title','VP',repeat('a',64),'alpha',now()) RETURNING id`,
      [org, sr.rows[0].id, personId]);
    const d = await db.query(
      `INSERT INTO public.canonical_attribute_decisions
         (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
       VALUES ($1,'person',$2,'job_title',$3,'VP','newest_observation',now()) RETURNING id`,
      [org, personId, a.rows[0].id]);
    return { assertionId: a.rows[0].id as string, decisionId: d.rows[0].id as string };
  };

  it('a recorded decision can never be modified', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const { decisionId } = await seedDecision(ORG_A, p);

      // An UPDATE matching zero rows fires no trigger and would pass vacuously,
      // so prove the target exists before probing it.
      const target = await db.query(
        `SELECT id FROM public.canonical_attribute_decisions WHERE id=$1`, [decisionId]);
      expect(target.rows).toHaveLength(1);

      const columns = ['value', 'reason', 'decided_at', 'attribute', 'organization_id', 'created_at'];
      const probes: Record<string, string> = {};
      probes.value = await attempt(
        `UPDATE public.canonical_attribute_decisions SET value='TAMPERED' WHERE id=$1`, [decisionId]);
      probes.reason = await attempt(
        `UPDATE public.canonical_attribute_decisions SET reason='authoritative_source' WHERE id=$1`, [decisionId]);
      // NOT now(): inside this transaction now() is the value seedDecision already
      // stored, so the UPDATE would change nothing and the trigger would rightly
      // allow it. A probe that mutates to the same value proves nothing.
      probes.decided_at = await attempt(
        `UPDATE public.canonical_attribute_decisions SET decided_at='2020-01-01T00:00:00Z' WHERE id=$1`, [decisionId]);
      probes.attribute = await attempt(
        `UPDATE public.canonical_attribute_decisions SET attribute='city' WHERE id=$1`, [decisionId]);
      probes.organization_id = await attempt(
        `UPDATE public.canonical_attribute_decisions SET organization_id=$2 WHERE id=$1`, [decisionId, ORG_B]);
      probes.created_at = await attempt(
        `UPDATE public.canonical_attribute_decisions SET created_at='2020-01-01T00:00:00Z' WHERE id=$1`, [decisionId]);

      // Every protected column, reported together, so a regression names itself.
      for (const col of columns) expect(`${col}=${probes[col]}`).toBe(`${col}=P0001`);
    });
  });

  it('a recorded decision can never be deleted', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const { decisionId } = await seedDecision(ORG_A, p);
      expect(await attempt(
        `DELETE FROM public.canonical_attribute_decisions WHERE id=$1`, [decisionId])).toBe('P0001');
    });
  });

  it('but a deleted person detaches its decisions instead of failing — evidence outlives the subject', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const { decisionId } = await seedDecision(ORG_A, p);

      // NOT `attempt()`: it takes a SAVEPOINT and rolls back even on success, so
      // it can ask whether something would be refused but never perform it.
      const deleted = await db.query(`DELETE FROM public.unified_persons WHERE id=$1`, [p]);
      expect(deleted.rowCount).toBe(1);

      const { rows } = await db.query(
        `SELECT person_id, value, reason FROM public.canonical_attribute_decisions WHERE id=$1`,
        [decisionId]);
      expect(rows).toHaveLength(1);              // the decision SURVIVED the delete
      expect(rows[0].person_id).toBeNull();      // detached, not destroyed
      expect(rows[0].value).toBe('VP');
      expect(rows[0].reason).toBe('newest_observation');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B1b — a decision can never reach another tenant', () => {
  it('refuses an assertion belonging to another tenant', async () => {
    await inRollback(async () => {
      const pA = await newPerson(ORG_A);
      const pB = await newPerson(ORG_B);
      const srB = await db.query(
        `INSERT INTO public.source_records
           (organization_id, provider, source_entity_type, source_record_id, payload_hash)
         VALUES ($1,'alpha','person','RB',repeat('b',64)) RETURNING id`, [ORG_B]);
      const aB = await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, person_id, attribute,
            normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'person',$3,'job_title','VP',repeat('a',64),'alpha',now()) RETURNING id`,
        [ORG_B, srB.rows[0].id, pB]);
      // ORG_A tries to justify a decision with ORG_B's evidence.
      expect(await attempt(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,'job_title',$3,'VP','newest_observation',now())`,
        [ORG_A, pA, aB.rows[0].id])).toBe('23503');
    });
  });

  it('refuses a person belonging to another tenant', async () => {
    await inRollback(async () => {
      const pB = await newPerson(ORG_B);
      const srA = await db.query(
        `INSERT INTO public.source_records
           (organization_id, provider, source_entity_type, source_record_id, payload_hash)
         VALUES ($1,'alpha','person','RA',repeat('b',64)) RETURNING id`, [ORG_A]);
      const aA = await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, attribute,
            normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'person','job_title','VP',repeat('a',64),'alpha',now()) RETURNING id`,
        [ORG_A, srA.rows[0].id]);
      expect(await attempt(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'person',$2,'job_title',$3,'VP','newest_observation',now())`,
        [ORG_A, pB, aA.rows[0].id])).toBe('23503');
    });
  });

  it('an account-shaped decision may never name a person', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const sr = await db.query(
        `INSERT INTO public.source_records
           (organization_id, provider, source_entity_type, source_record_id, payload_hash)
         VALUES ($1,'alpha','account','RA2',repeat('b',64)) RETURNING id`, [ORG_A]);
      const a = await db.query(
        `INSERT INTO public.source_assertions
           (organization_id, source_record_id, entity_type, attribute,
            normalized_value, value_hash, provider, recorded_at)
         VALUES ($1,$2,'account','industry','Fintech',repeat('a',64),'alpha',now()) RETURNING id`,
        [ORG_A, sr.rows[0].id]);
      expect(await attempt(
        `INSERT INTO public.canonical_attribute_decisions
           (organization_id, entity_type, person_id, attribute, assertion_id, value, reason, decided_at)
         VALUES ($1,'account',$2,'industry',$3,'Fintech','newest_observation',now())`,
        [ORG_A, p, a.rows[0].id])).toBe('23514');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B1b — the real boundary, end to end', () => {
  it('fills an empty canonical value, logs the decision and stamps the assertion', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const r = await ingest(ORG_A, p);
      expect(r.canonicalApplied).toEqual(['job_title']);
      expect(await titleOf(p)).toBe('VP Sales');

      const decisions = await decisionsFor(p);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        attribute: 'job_title', value: 'VP Sales', reason: 'single_uncontested_assertion',
      });

      const assertions = await assertionsFor(p);
      expect(assertions).toHaveLength(1);
      expect(assertions[0].applied_reason).toBe('single_uncontested_assertion');
      expect(assertions[0].applied_to_canonical_at).not.toBeNull();
      expect(assertions[0].superseded_at).toBeNull();
    });
  });

  it('is idempotent: re-ingesting an identical payload decides nothing new', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await ingest(ORG_A, p);
      const again = await ingest(ORG_A, p);
      expect(again.outcome).toBe('unchanged');
      expect(again.assertionsRecorded).toBe(0);
      expect(again.assertionsAlreadyPresent).toBe(1);
      expect(again.canonicalApplied).toEqual([]);
      expect(await decisionsFor(p)).toHaveLength(1);     // still ONE decision
      expect(await assertionsFor(p)).toHaveLength(1);
    });
  });

  it('supersedes its own withdrawn claim and re-arbitrates canonical', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await ingest(ORG_A, p);
      const changed = await ingest(ORG_A, p, {
        rawPayload: { seq: 2 }, observedAt: T2, personAttributes: { jobTitle: 'CRO' },
      });

      expect(changed.outcome).toBe('changed');
      expect(changed.assertionsSuperseded).toBe(1);
      expect(changed.canonicalApplied).toEqual(['job_title']);
      expect(await titleOf(p)).toBe('CRO');

      const assertions = await assertionsFor(p);
      expect(assertions).toHaveLength(2);
      const vp = assertions.find((a) => a.normalized_value === 'VP Sales')!;
      const cro = assertions.find((a) => a.normalized_value === 'CRO')!;
      expect(vp.superseded_at).not.toBeNull();          // withdrawn, never deleted
      expect(vp.applied_reason).toBe('single_uncontested_assertion');  // its stamp SURVIVES
      expect(cro.superseded_at).toBeNull();

      // Two decisions, in order, both preserved.
      const decisions = await decisionsFor(p);
      expect(decisions.map((d) => d.value)).toEqual(['VP Sales', 'CRO']);
    });
  });

  it('REVIVES a previously superseded value instead of colliding with the dedupe index', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      // Explicit, distinct decision times: without them all three calls could land
      // in the same millisecond and the stamp assertion below would be vacuous.
      await ingest(ORG_A, p, { now: '2026-05-01T00:00:00.000Z' });               // VP Sales
      const firstStamp = iso((await assertionsFor(p))
        .find((a) => a.normalized_value === 'VP Sales')!.applied_to_canonical_at);
      expect(firstStamp).toBe('2026-05-01T00:00:00.000Z');

      await ingest(ORG_A, p, {
        rawPayload: { seq: 2 }, observedAt: T2, now: '2026-05-02T00:00:00.000Z',
        personAttributes: { jobTitle: 'CRO' },
      });
      const back = await ingest(ORG_A, p, {
        rawPayload: { seq: 3 }, observedAt: T3, now: '2026-05-03T00:00:00.000Z',
        personAttributes: { jobTitle: 'VP Sales' },
      });

      // The dedupe key was already occupied by the superseded row, so nothing new
      // was inserted — and no 23505 escaped.
      expect(back.assertionsRecorded).toBe(0);
      expect(back.assertionsAlreadyPresent).toBe(1);
      expect(back.assertionsRevived).toBe(1);
      expect(back.assertionsSuperseded).toBe(1);

      const assertions = await assertionsFor(p);
      expect(assertions).toHaveLength(2);               // still two rows, never three
      expect(assertions.find((a) => a.normalized_value === 'VP Sales')!.superseded_at).toBeNull();
      expect(assertions.find((a) => a.normalized_value === 'CRO')!.superseded_at).not.toBeNull();

      // Canonical followed the source back, rather than freezing on the value the
      // source had just abandoned.
      expect(await titleOf(p)).toBe('VP Sales');

      // S-6: the re-win is recorded in the APPEND-ONLY LOG, three decisions deep,
      // and the assertion's original stamp is NOT overwritten. Overwriting it would
      // lose the fact that this value first became canonical two decisions ago.
      expect((await decisionsFor(p)).map((d) => d.value)).toEqual(['VP Sales', 'CRO', 'VP Sales']);
      const reWon = (await assertionsFor(p)).find((a) => a.normalized_value === 'VP Sales')!;
      expect(iso(reWon.applied_to_canonical_at)).toBe(firstStamp);
    });
  });

  it('never overwrites a canonical value no assertion has ever carried', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await db.query(`UPDATE public.unified_persons SET job_title='Legacy Title' WHERE id=$1`, [p]);
      const r = await ingest(ORG_A, p);
      expect(r.canonicalApplied).toEqual([]);
      expect(r.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
      expect(await titleOf(p)).toBe('Legacy Title');
      expect(await decisionsFor(p)).toHaveLength(0);
      // The evidence was still retained — a refusal to write is not a refusal to record.
      expect(await assertionsFor(p)).toHaveLength(1);
    });
  });

  it('withholds when two sources disagree at the same instant, and keeps both', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await ingest(ORG_A, p, { provider: 'alpha', sourceRecordId: 'A', personAttributes: { jobTitle: 'VP Sales' } });
      await db.query(`UPDATE public.unified_persons SET job_title=NULL WHERE id=$1`, [p]);
      const second = await ingest(ORG_A, p, {
        provider: 'beta', sourceRecordId: 'B', observedAt: T1, personAttributes: { jobTitle: 'Sales Director' },
      });

      expect(second.canonicalApplied).toEqual([]);
      expect(second.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
      expect(second.canonicalContested).toEqual(['job_title']);
      expect(await titleOf(p)).toBeNull();
      expect(await assertionsFor(p)).toHaveLength(2);    // both survive
    });
  });

  it('lets the newer source win when the observation times differ', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await ingest(ORG_A, p, { provider: 'alpha', sourceRecordId: 'A', observedAt: T1, personAttributes: { jobTitle: 'VP Sales' } });
      const second = await ingest(ORG_A, p, {
        provider: 'beta', sourceRecordId: 'B', observedAt: T3, personAttributes: { jobTitle: 'Sales Director' },
      });
      expect(second.canonicalApplied).toEqual(['job_title']);
      expect(second.canonicalContested).toEqual(['job_title']);   // resolved, still a disagreement
      expect(await titleOf(p)).toBe('Sales Director');
      const decisions = await decisionsFor(p);
      expect(decisions[decisions.length - 1]).toMatchObject({
        value: 'Sales Director', reason: 'newest_observation',
      });
    });
  });

  it('cannot ingest against another tenants person at all — the schema refuses first', async () => {
    await inRollback(async () => {
      const pB = await newPerson(ORG_B);
      // ORG_A names ORG_B's person. This is STRICTER than "the canonical read
      // finds nothing": the composite tenant FK on source_records refuses the
      // EVIDENCE insert, so cross-tenant ingestion fails before arbitration is
      // reached and no row of any kind is created.
      await expect(ingest(ORG_A, pB)).rejects.toThrow(/23503/);
      expect(await titleOf(pB)).toBeNull();
      expect(await decisionsFor(pB)).toHaveLength(0);
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_records WHERE organization_id=$1`, [ORG_A]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('reconcileAssertionLiveness refuses to run without a tenant', async () => {
    // D2 added a required subject argument. The subject here is deliberately
    // VALID, so the only thing left to fail is the TENANT guard — the test keeps
    // proving that specific refusal rather than passing on whichever guard
    // happens to run first.
    await expect(reconcileAssertionLiveness(
      '', 'rec', { kind: 'person', personId: 'p' },
      [{ attribute: 'job_title', rawValue: 'x', normalizedValue: 'x' }],
    )).rejects.toThrow(/organizationId is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUNTIME CLOSURE — the four-step D-4 cycle, exercised end to end.
//
// Ratified D-4: candidacy uses LIVE assertions only; incumbent attestation uses
// ALL historical assertions, live or superseded. The closure gate asks for the
// full cycle, including the step the earlier suite stopped short of: that a value
// which was superseded is still HISTORICALLY ATTESTED, and can therefore become
// canonical again when it next wins.
// ════════════════════════════════════════════════════════════════════════════
describe('B1b runtime closure — the full D-4 cycle', () => {
  it('A -> B -> A -> B, with evidence intact and every transition recorded', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);

      // 1. alpha asserts A. Canonical is empty, so A is written.
      await ingest(ORG_A, p, {
        provider: 'alpha', sourceRecordId: 'ALPHA', rawPayload: { seq: 1 },
        observedAt: '2026-01-01T00:00:00.000Z', now: '2026-06-01T00:00:00.000Z',
        personAttributes: { jobTitle: 'A-title' },
      });
      expect(await titleOf(p)).toBe('A-title');
      const stampA = iso((await assertionsFor(p))
        .find((a) => a.normalized_value === 'A-title')!.applied_to_canonical_at);
      expect(stampA).toBe('2026-06-01T00:00:00.000Z');

      // 2. alpha changes its mind to B. A is withdrawn; canonical follows.
      await ingest(ORG_A, p, {
        provider: 'alpha', sourceRecordId: 'ALPHA', rawPayload: { seq: 2 },
        observedAt: '2026-02-01T00:00:00.000Z', now: '2026-06-02T00:00:00.000Z',
        personAttributes: { jobTitle: 'B-title' },
      });
      expect(await titleOf(p)).toBe('B-title');
      let rows = await assertionsFor(p);
      expect(rows.find((a) => a.normalized_value === 'A-title')!.superseded_at).not.toBeNull();
      expect(rows.find((a) => a.normalized_value === 'B-title')!.superseded_at).toBeNull();

      // 3. alpha returns to A. B is withdrawn, A revived, canonical back to A.
      // This is the step that would FREEZE on B if attestation counted only live
      // evidence: B is canonical and is no longer live.
      const back = await ingest(ORG_A, p, {
        provider: 'alpha', sourceRecordId: 'ALPHA', rawPayload: { seq: 3 },
        observedAt: '2026-03-01T00:00:00.000Z', now: '2026-06-03T00:00:00.000Z',
        personAttributes: { jobTitle: 'A-title' },
      });
      expect(back.assertionsRevived).toBe(1);
      expect(back.assertionsRecorded).toBe(0);            // revived, never duplicated
      expect(await titleOf(p)).toBe('A-title');
      rows = await assertionsFor(p);
      expect(rows).toHaveLength(2);                       // two rows, not three
      const bRow = rows.find((a) => a.normalized_value === 'B-title')!;
      expect(bRow.superseded_at).not.toBeNull();          // B is withdrawn...
      expect(bRow.applied_reason).not.toBeNull();         // ...but was once canonical

      // A's ORIGINAL stamp survived the whole cycle: re-winning never re-stamps.
      expect(iso(rows.find((a) => a.normalized_value === 'A-title')!.applied_to_canonical_at))
        .toBe(stampA);

      // 4. B is HISTORICALLY ATTESTED, so it may become canonical again.
      // A second source asserts B more recently than alpha asserted A. B wins on
      // recency; the incumbent A is attested, so re-arbitration is permitted.
      const reWin = await ingest(ORG_A, p, {
        provider: 'beta', sourceRecordId: 'BETA', rawPayload: { seq: 1 },
        observedAt: '2026-04-01T00:00:00.000Z', now: '2026-06-04T00:00:00.000Z',
        personAttributes: { jobTitle: 'B-title' },
      });
      expect(reWin.canonicalApplied).toEqual(['job_title']);
      expect(reWin.canonicalContested).toEqual(['job_title']);   // two live values
      expect(await titleOf(p)).toBe('B-title');

      // beta's claim is its OWN row: liveness is scoped per source record, so
      // alpha's withdrawn B stays withdrawn and is not silently revived.
      rows = await assertionsFor(p);
      expect(rows).toHaveLength(3);
      const bRows = rows.filter((a) => a.normalized_value === 'B-title');
      expect(bRows).toHaveLength(2);
      expect(bRows.filter((a) => a.superseded_at === null)).toHaveLength(1);   // beta's
      expect(bRows.filter((a) => a.superseded_at !== null)).toHaveLength(1);   // alpha's

      // Every transition is in the append-only log, in order.
      const decisions = await decisionsFor(p);
      expect(decisions.map((d) => d.value)).toEqual(['A-title', 'B-title', 'A-title', 'B-title']);
      expect(decisions.map((d) => d.reason)).toEqual([
        'single_uncontested_assertion', 'single_uncontested_assertion',
        'single_uncontested_assertion', 'newest_observation',
      ]);
    });
  });

  it('RAW evidence survives every supersession and revival', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const steps: Array<[number, string, string, string]> = [
        [1, 'VP Sales', '2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'],
        [2, 'CRO', '2026-02-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z'],
        [3, 'VP Sales', '2026-03-01T00:00:00.000Z', '2026-07-03T00:00:00.000Z'],
      ];
      for (const [seq, title, observed, at] of steps) {
        await ingest(ORG_A, p, {
          rawPayload: { seq }, observedAt: observed, now: at,
          personAttributes: { jobTitle: title },
        });
      }
      const { rows } = await db.query(
        `SELECT raw_value, normalized_value, value_hash, provider, observed_at
           FROM public.source_assertions WHERE person_id=$1 AND attribute='job_title'
          ORDER BY normalized_value`, [p]);
      expect(rows).toHaveLength(2);
      for (const r of rows as Array<Record<string, unknown>>) {
        expect(r.raw_value).toBeTruthy();          // the provider's literal words
        expect(r.normalized_value).toBeTruthy();
        expect(String(r.value_hash)).toMatch(/^[a-f0-9]{64}$/);
        expect(r.provider).toBe('alpha');
        expect(r.observed_at).not.toBeNull();
      }
    });
  });

  it('an incumbent NO assertion has ever carried is never overwritten, however strong the evidence', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await db.query(`UPDATE public.unified_persons SET job_title='Never-Asserted-X' WHERE id=$1`, [p]);

      // Two sources, agreeing, recent, both confident. None of that matters.
      const first = await ingest(ORG_A, p, {
        provider: 'alpha', sourceRecordId: 'A', observedAt: '2026-05-01T00:00:00.000Z',
        confidence: 0.99, personAttributes: { jobTitle: 'Agreed-Y' },
      });
      const second = await ingest(ORG_A, p, {
        provider: 'beta', sourceRecordId: 'B', observedAt: '2026-05-02T00:00:00.000Z',
        confidence: 0.99, personAttributes: { jobTitle: 'Agreed-Y' },
      });

      for (const r of [first, second]) {
        expect(r.canonicalApplied).toEqual([]);
        expect(r.canonicalWithheld).toEqual([{ attribute: 'job_title', reason: 'unattested_incumbent' }]);
      }
      expect(await titleOf(p)).toBe('Never-Asserted-X');
      expect(await decisionsFor(p)).toHaveLength(0);
      // Refusing to write is not refusing to record: both claims are retained.
      expect(await assertionsFor(p)).toHaveLength(2);
    });
  });
});
