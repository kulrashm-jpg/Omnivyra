/**
 * LI-2 — source records and field-level provenance, against real PostgreSQL.
 *
 * The properties that matter here cannot be mocked: that a unique index makes
 * re-ingestion idempotent, that a composite foreign key stops a source record
 * naming another tenant's person, and that a losing assertion survives the
 * canonical value being written. All three are database behaviour.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson, newAccount } from './setup';
import { createHash } from 'node:crypto';

const h = (s: string) => createHash('sha256').update(s).digest('hex');

const srcRow = (org: string, over: Record<string, unknown> = {}) => ({
  organization_id: org,
  provider: 'testprov',
  source_entity_type: 'person',
  source_record_id: 'REC-1',
  raw_payload: JSON.stringify({ a: 1 }),
  payload_hash: h('p1'),
  ...over,
});

async function insertSource(org: string, over: Record<string, unknown> = {}): Promise<string> {
  const r = { ...srcRow(org, over) };
  const cols = Object.keys(r);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await db.query(
    `INSERT INTO public.source_records (${cols.join(',')}) VALUES (${vals.join(',')}) RETURNING id`,
    Object.values(r));
  return rows[0].id;
}

describe('LI-2 — schema shape', () => {
  it('both tables exist, tenant-scoped, with RLS', async () => {
    for (const t of ['source_records', 'source_assertions']) {
      const { rows } = await db.query(
        `SELECT c.relrowsecurity rls,
                (SELECT count(*)::int FROM pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='organization_id' AND NOT a.attisdropped AND a.attnotnull) tenant
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname=$1`, [t]);
      expect(rows[0].rls).toBe(true);
      expect(rows[0].tenant).toBe(1);   // organization_id NOT NULL
    }
  });

  it('has 5 composite tenant-safe foreign keys', async () => {
    const { rows } = await db.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) d
        FROM pg_constraint con JOIN pg_class s ON s.oid=con.conrelid
       WHERE con.contype='f' AND s.relname IN ('source_records','source_assertions')
         AND array_length(con.conkey,1)=2 ORDER BY con.conname`);
    expect(rows).toHaveLength(5);
    for (const r of rows as any[]) {
      expect(r.d).toMatch(/, organization_id\)/);   // tenant is always the second leg
    }
  });

  it('the source identity index is NOT partial — ON CONFLICT must be able to infer it', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_source_records_tenant_identity'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);
    expect(rows[0].indexdef).not.toMatch(/\sWHERE\s/);
    expect(rows[0].indexdef).toMatch(/organization_id, provider, source_entity_type, source_record_id/);
  });
});

describe('LI-2 — source identity', () => {
  it('same tenant + same provider + same source id = ONE record', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertSource(ORG_A);
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
         VALUES ($1,'testprov','person','REC-1','{}'::jsonb,$2)`, [ORG_A, h('p2')])).toBe('23505');
    });
  });

  it('different tenant + same provider + same source id = SEPARATE records', async () => {
    await inRollback(async () => {
      await seedTenants();
      const a = await insertSource(ORG_A);
      const b = await insertSource(ORG_B);
      expect(a).not.toBe(b);
      // The same external identity legitimately exists in both tenants.
      const { rows } = await db.query(
        `SELECT count(DISTINCT organization_id)::int n FROM public.source_records WHERE source_record_id='REC-1'`);
      expect(rows[0].n).toBe(2);
    });
  });

  it('different provider + same source id = separate records', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertSource(ORG_A, { provider: 'prov-x' });
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
         VALUES ($1,'prov-y','person','REC-1','{}'::jsonb,$2)`, [ORG_A, h('p1')])).toBe('ok');
    });
  });

  it('different entity type + same source id = separate records', async () => {
    await inRollback(async () => {
      await seedTenants();
      await insertSource(ORG_A);
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
         VALUES ($1,'testprov','account','REC-1','{}'::jsonb,$2)`, [ORG_A, h('p1')])).toBe('ok');
    });
  });

  it('rejects a blank provider or source id — identity must be real', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
         VALUES ($1,'  ','person','X','{}'::jsonb,$2)`, [ORG_A, h('p')])).toBe('23514');
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
         VALUES ($1,'p','person','   ','{}'::jsonb,$2)`, [ORG_A, h('p')])).toBe('23514');
    });
  });
});

describe('LI-2 — tenant isolation', () => {
  it('a source record cannot name another tenant\'s person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pB = await newPerson(ORG_B);
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash,person_id)
         VALUES ($1,'testprov','person','XT-1','{}'::jsonb,$2,$3)`, [ORG_A, h('p'), pB])).toBe('23503');
    });
  });

  it('a source record cannot name another tenant\'s account', async () => {
    await inRollback(async () => {
      await seedTenants();
      const accB = await newAccount(ORG_B, { domain: 'li2-xt.example' });
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash,account_id)
         VALUES ($1,'testprov','account','XT-2','{}'::jsonb,$2,$3)`, [ORG_A, h('p'), accB])).toBe('23503');
    });
  });

  it('an assertion cannot reference another tenant\'s source record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const recB = await insertSource(ORG_B);
      expect(await attempt(
        `INSERT INTO public.source_assertions (organization_id,source_record_id,entity_type,attribute,normalized_value,value_hash,provider)
         VALUES ($1,$2,'person','job_title','CTO',$3,'testprov')`, [ORG_A, recB, h('CTO')])).toBe('23503');
    });
  });

  it('a tenant-scoped read cannot see another tenant\'s source record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const b = await insertSource(ORG_B);
      const { rows } = await db.query(
        `SELECT id FROM public.source_records WHERE organization_id=$1 AND id=$2`, [ORG_A, b]);
      expect(rows).toHaveLength(0);
    });
  });

  it('a tenant-scoped update cannot mutate another tenant\'s source record', async () => {
    await inRollback(async () => {
      await seedTenants();
      const b = await insertSource(ORG_B);
      const res = await db.query(
        `UPDATE public.source_records SET status='rejected' WHERE organization_id=$1 AND id=$2`, [ORG_A, b]);
      expect(res.rowCount).toBe(0);
      const { rows } = await db.query(`SELECT status FROM public.source_records WHERE id=$1`, [b]);
      expect(rows[0].status).toBe('active');
    });
  });

  it('source evidence cannot re-home a canonical person', async () => {
    await inRollback(async () => {
      await seedTenants();
      const pA = await newPerson(ORG_A);
      const rec = await insertSource(ORG_A, { source_record_id: 'REHOME', person_id: pA });
      // Moving the source record to another tenant while it holds a tenant-A
      // person must be impossible.
      expect(await attempt(
        `UPDATE public.source_records SET organization_id=$1 WHERE id=$2`, [ORG_B, rec])).toBe('23503');
      const { rows } = await db.query(`SELECT company_id FROM public.unified_persons WHERE id=$1`, [pA]);
      expect(rows[0].company_id).toBe(ORG_A);
    });
  });
});

describe('LI-2 — idempotency and change detection', () => {
  it('an identical assertion twice is rejected by the dedupe key', async () => {
    await inRollback(async () => {
      await seedTenants();
      const rec = await insertSource(ORG_A);
      const ins = `INSERT INTO public.source_assertions
        (organization_id,source_record_id,entity_type,attribute,raw_value,normalized_value,value_hash,provider)
        VALUES ($1,$2,'person','job_title','VP Sales','VP Sales',$3,'testprov')`;
      await db.query(ins, [ORG_A, rec, h('VP Sales')]);
      expect(await attempt(ins, [ORG_A, rec, h('VP Sales')])).toBe('23505');
    });
  });

  it('a CHANGED value from the same source is a NEW row — history survives', async () => {
    await inRollback(async () => {
      await seedTenants();
      const rec = await insertSource(ORG_A);
      const ins = (v: string) => db.query(
        `INSERT INTO public.source_assertions
          (organization_id,source_record_id,entity_type,attribute,normalized_value,value_hash,provider)
          VALUES ($1,$2,'person','job_title',$3,$4,'testprov')`, [ORG_A, rec, v, h(v)]);
      await ins('VP Sales');
      await ins('SVP Sales');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.source_assertions WHERE source_record_id=$1 AND attribute='job_title'`, [rec]);
      expect(rows[0].n).toBe(2);
    });
  });

  it('two providers may assert different values for one attribute', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const r1 = await insertSource(ORG_A, { provider: 'apollo-test', source_record_id: 'A1', person_id: p });
      const r2 = await insertSource(ORG_A, { provider: 'crm-test', source_record_id: 'C1', person_id: p });
      for (const [rec, prov, val] of [[r1, 'apollo-test', 'VP Sales'], [r2, 'crm-test', 'Sales Director']] as const) {
        await db.query(
          `INSERT INTO public.source_assertions
            (organization_id,source_record_id,entity_type,person_id,attribute,normalized_value,value_hash,provider)
            VALUES ($1,$2,'person',$3,'job_title',$4,$5,$6)`, [ORG_A, rec, p, val, h(val), prov]);
      }
      const { rows } = await db.query(
        `SELECT count(DISTINCT value_hash)::int n FROM public.source_assertions
          WHERE organization_id=$1 AND person_id=$2 AND attribute='job_title' AND superseded_at IS NULL`, [ORG_A, p]);
      expect(rows[0].n).toBe(2);   // the disagreement is retained, not resolved
    });
  });

  it('a payload hash must be a real sha256', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
         VALUES ($1,'p','person','H1','{}'::jsonb,'not-a-hash')`, [ORG_A])).toBe('23514');
    });
  });

  it('the raw payload must be an object, never a scalar or array', async () => {
    await inRollback(async () => {
      await seedTenants();
      for (const bad of ['"str"', '[1,2]', '42']) {
        expect(await attempt(
          `INSERT INTO public.source_records (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash)
           VALUES ($1,'p','person','OBJ','${bad}'::jsonb,$2)`, [ORG_A, h('x')])).toBe('23514');
      }
    });
  });
});

describe('LI-2 — evidence survives canonical change', () => {
  it('assertions remain after the canonical value is written and then changed', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const rec = await insertSource(ORG_A, { source_record_id: 'SURV', person_id: p });
      await db.query(
        `INSERT INTO public.source_assertions
          (organization_id,source_record_id,entity_type,person_id,attribute,normalized_value,value_hash,provider)
          VALUES ($1,$2,'person',$3,'job_title','VP Sales',$4,'testprov')`, [ORG_A, rec, p, h('VP Sales')]);

      await db.query(`UPDATE public.unified_persons SET job_title='VP Sales' WHERE id=$1`, [p]);
      await db.query(`UPDATE public.unified_persons SET job_title='Chief Revenue Officer' WHERE id=$1`, [p]);

      const { rows } = await db.query(
        `SELECT normalized_value FROM public.source_assertions WHERE person_id=$1 AND attribute='job_title'`, [p]);
      expect(rows).toHaveLength(1);
      expect(rows[0].normalized_value).toBe('VP Sales');   // the evidence did not follow the canonical value
    });
  });

  it('deleting a person preserves the source record and its tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      const p = await newPerson(ORG_A);
      const rec = await insertSource(ORG_A, { source_record_id: 'DEL', person_id: p });
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [p]);
      const { rows } = await db.query(
        `SELECT organization_id, person_id FROM public.source_records WHERE id=$1`, [rec]);
      expect(rows).toHaveLength(1);              // evidence outlives the entity
      expect(rows[0].person_id).toBeNull();
      expect(rows[0].organization_id).toBe(ORG_A);  // tenant preserved, not wiped
    });
  });

  it('applied provenance requires a reason', async () => {
    await inRollback(async () => {
      await seedTenants();
      const rec = await insertSource(ORG_A, { source_record_id: 'PROV' });
      const { rows } = await db.query(
        `INSERT INTO public.source_assertions
          (organization_id,source_record_id,entity_type,attribute,normalized_value,value_hash,provider)
          VALUES ($1,$2,'person','city','London',$3,'testprov') RETURNING id`, [ORG_A, rec, h('London')]);
      const id = rows[0].id;
      expect(await attempt(
        `UPDATE public.source_assertions SET applied_to_canonical_at=now() WHERE id=$1`, [id])).toBe('23514');
      expect(await attempt(
        `UPDATE public.source_assertions SET applied_to_canonical_at=now(), applied_reason='single_uncontested_assertion' WHERE id=$1`, [id])).toBe('ok');
    });
  });
});

describe('LI-2 — the canonical spine is unchanged', () => {
  it('LI-1 attribute columns still exist and identity keys still bind', async () => {
    const { rows: cols } = await db.query(
      `SELECT count(*)::int n FROM pg_attribute
        WHERE attrelid='public.unified_persons'::regclass AND NOT attisdropped
          AND attname = ANY(ARRAY['full_name','job_title','seniority','country_code','attributes_source'])`);
    expect(cols[0].n).toBe(5);

    const { rows: idx } = await db.query(
      `SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public'
        AND indexname = ANY(ARRAY['uq_unified_persons_id_company','idx_unified_persons_company_email_unique',
          'uq_prospect_accounts_org_domain_active','uq_prospect_accounts_org_source_ref'])`);
    expect(idx[0].n).toBe(4);
  });

  it('email identity still binds per tenant', async () => {
    await inRollback(async () => {
      await seedTenants();
      await db.query(`INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,'li2@x.test')`, [ORG_A]);
      expect(await attempt(
        `INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,'li2@x.test')`, [ORG_A])).toBe('23505');
      expect(await attempt(
        `INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,'li2@x.test')`, [ORG_B])).toBe('ok');
    });
  });
});

/**
 * A7P-C9 — the correlation id accepts what the application actually sends.
 *
 * These exist because the first real pilot ingestion failed with
 * `22P02: invalid input syntax for type uuid: "pi-pilot-001"` AFTER it had
 * already created a person, an identity claim, an account and a canonical
 * lead. Nothing above the column validated or generated a UUID; the column
 * alone imposed a format the API never advertised.
 *
 * Every value below is one a production writer really produces. None has been
 * rewritten into a UUID to make a test pass — doing that would re-encode the
 * defect as the expectation.
 */
describe('A7P-C9 — ingestion_run_id is a soft correlation id, not an identifier', () => {
  it('is text, nullable, and constrains nothing', async () => {
    const { rows } = await db.query(
      `SELECT format_type(a.atttypid, a.atttypmod) t, a.attnotnull
         FROM pg_attribute a
        WHERE a.attrelid='public.source_records'::regclass
          AND a.attname='ingestion_run_id' AND NOT a.attisdropped`);
    expect(rows[0].t).toBe('text');
    expect(rows[0].attnotnull).toBe(false);

    // It must stay out of every index and constraint: source identity is
    // (organization_id, provider, source_entity_type, source_record_id), and a
    // correlation id joining that key would make re-ingestion under a new batch
    // label create a duplicate row instead of updating one.
    const attnum = `(SELECT attnum FROM pg_attribute
                      WHERE attrelid='public.source_records'::regclass
                        AND attname='ingestion_run_id')`;
    const { rows: idx } = await db.query(
      `SELECT count(*)::int n FROM pg_index x
        WHERE x.indrelid='public.source_records'::regclass
          AND ${attnum} = ANY(x.indkey::int2[])`);
    expect(idx[0].n).toBe(0);

    const { rows: con } = await db.query(
      `SELECT count(*)::int n FROM pg_constraint
        WHERE conrelid='public.source_records'::regclass
          AND ${attnum} = ANY(conkey)`);
    expect(con[0].n).toBe(0);
  });

  // THE REGRESSION. This is the exact value and the exact column that produced
  // 22P02 in production on 2026-09-08. It is deliberately NOT a UUID.
  it('accepts the pilot batch label that produced 22P02', async () => {
    await inRollback(async () => {
      await seedTenants();
      expect(await attempt(
        `INSERT INTO public.source_records
           (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash,ingestion_run_id)
         VALUES ($1,'manual','person','pi-pilot-001','{}'::jsonb,$2,'pi-pilot-001')`,
        [ORG_A, h('pilot')])).toBe('ok');
    });
  });

  it('accepts every correlation shape production writers emit', async () => {
    await inRollback(async () => {
      await seedTenants();
      const shapes: Array<[string, string | null]> = [
        // manual / csv / crm routes and crmIngestionService — an operator or pipeline label
        ['operator batch label', 'pi-pilot-001'],
        // execution.ts defaults correlationId to randomUUID()
        ['uuid', '550e8400-e29b-41d4-a716-446655440000'],
        // extensionBridge.ts — observation.sourceReference is a platform URN
        ['platform urn', 'urn:li:comment:7234'],
        // consumeEnrichmentWork.ts — `a7e-${entityId}-${now}`
        ['a7e worker id', 'a7e-00000000-0000-4000-8000-00000000000a-1757330000000'],
        // omitted: metadata, never identity, so absence stays legal
        ['omitted', null],
      ];
      for (const [label, value] of shapes) {
        const code = await attempt(
          `INSERT INTO public.source_records
             (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash,ingestion_run_id)
           VALUES ($1,'manual','person',$2,'{}'::jsonb,$3,$4)`,
          [ORG_A, `SHAPE-${label}`, h(label), value]);
        expect([label, code]).toEqual([label, 'ok']);
      }
    });
  });

  it('stores the correlation id verbatim — no coercion, no normalisation', async () => {
    await inRollback(async () => {
      await seedTenants();
      const rec = await insertSource(ORG_A, {
        source_record_id: 'VERBATIM', ingestion_run_id: 'urn:li:comment:7234',
      });
      const { rows } = await db.query(
        `SELECT ingestion_run_id FROM public.source_records WHERE id=$1`, [rec]);
      expect(rows[0].ingestion_run_id).toBe('urn:li:comment:7234');
    });
  });

  it('a new correlation id does not create a second row for the same source record', async () => {
    // The identity guarantee the widening must not disturb: two batches naming
    // the same provider record still collide on the source identity index.
    await inRollback(async () => {
      await seedTenants();
      await insertSource(ORG_A, { source_record_id: 'IDENT-1', ingestion_run_id: 'batch-a' });
      expect(await attempt(
        `INSERT INTO public.source_records
           (organization_id,provider,source_entity_type,source_record_id,raw_payload,payload_hash,ingestion_run_id)
         VALUES ($1,'testprov','person','IDENT-1','{}'::jsonb,$2,'batch-b')`,
        [ORG_A, h('second')])).toBe('23505');
    });
  });

  it('the real identifiers on this table are still uuid', async () => {
    // The widening was one column. Anything that names a row stays typed.
    const { rows } = await db.query(
      `SELECT attname, format_type(atttypid, atttypmod) t
         FROM pg_attribute
        WHERE attrelid='public.source_records'::regclass AND NOT attisdropped
          AND attname = ANY(ARRAY['id','organization_id','person_id','account_id'])
        ORDER BY attname`);
    expect(rows.map((r: any) => [r.attname, r.t])).toEqual([
      ['account_id', 'uuid'], ['id', 'uuid'], ['organization_id', 'uuid'], ['person_id', 'uuid'],
    ]);

    const { rows: assertions } = await db.query(
      `SELECT format_type(atttypid, atttypmod) t FROM pg_attribute
        WHERE attrelid='public.source_assertions'::regclass AND attname='source_record_id'`);
    expect(assertions[0].t).toBe('uuid');   // it references source_records.id
  });
});
