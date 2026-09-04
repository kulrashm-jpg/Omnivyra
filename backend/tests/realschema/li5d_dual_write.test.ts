/**
 * LI-5D — dual-write invariants, against real PostgreSQL.
 *
 * The unit suite proves the writer's logic against a double. This proves the
 * database behaviour it depends on: that a duplicate claim really does raise
 * `23505` and not something else, that the partial index really does defeat
 * `ON CONFLICT`, and that the tenant-safe FK really does refuse a cross-tenant
 * person — because the writer's whole error classification rests on those
 * SQLSTATEs being what it assumes.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const INS = `INSERT INTO public.identity_claims
  (organization_id, person_id, claim_type, platform, normalized_value, raw_value,
   source, source_reference, evidence, confidence, verification_state, observed_at, recorded_at)
  VALUES ($1,$2,'external_id',$3,$4,$5,'identity_dual_write','unified_persons:x','{}'::jsonb,1,'unverified',now(),now())`;

const insert = (org: string, person: string | null, platform: string, value: string, raw = 'RAW') =>
  db.query(`${INS} RETURNING id`, [org, person, platform, value, raw]);

const tryInsert = (org: string, person: string | null, platform: string, value: string, raw = 'RAW') =>
  attempt(INS, [org, person, platform, value, raw]);

const liveClaims = async (org: string): Promise<number> => Number((await db.query(
  `SELECT count(*)::int n FROM public.identity_claims
    WHERE organization_id=$1 AND source='identity_dual_write' AND revoked_at IS NULL`, [org])).rows[0].n);

beforeAll(seedTenants);

describe('LI-5D — the SQLSTATEs the writer classifies on', () => {
  it('a duplicate claim raises 23505, the only benign duplicate', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, 'apollo', 'a-123');
      expect(await tryInsert(ORG_A, p, 'apollo', 'a-123')).toBe('23505');
      expect(await liveClaims(ORG_A)).toBe(1);
    });
  });

  it('a cross-tenant person raises 23503 — classified as tenant_fk_failure', async () => {
    await inRollback(async () => {
      const b = await newPerson(ORG_B);
      expect(await tryInsert(ORG_A, b, 'apollo', 'a-123')).toBe('23503');
    });
  });

  it('an un-normalised value raises 23514 — classified as invalid_claim', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      expect(await tryInsert(ORG_A, p, 'apollo', 'A-123')).toBe('23514');
    });
  });

  it('a missing platform raises 23514 — the platform rule the writer must satisfy', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const code = await attempt(
        `INSERT INTO public.identity_claims
          (organization_id, person_id, claim_type, platform, normalized_value,
           source, evidence, verification_state, observed_at, recorded_at)
         VALUES ($1,$2,'external_id',NULL,'a-123','identity_dual_write','{}'::jsonb,'unverified',now(),now())`,
        [ORG_A, p]);
      expect(code).toBe('23514');
    });
  });

  it('ON CONFLICT still answers 42P10 — which is why the writer catches 23505', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, 'apollo', 'a-123');
      const code = await attempt(
        `${INS} ON CONFLICT (organization_id, claim_type, platform, normalized_value) DO NOTHING`,
        [ORG_A, p, 'apollo', 'a-123', 'RAW']);
      expect(code).toBe('42P10');
    });
  });
});

describe('LI-5D — identity semantics under dual-write', () => {
  it('the same platform + identifier in two tenants is two claims', async () => {
    await inRollback(async () => {
      const a = await newPerson(ORG_A);
      const b = await newPerson(ORG_B);
      await insert(ORG_A, a, 'apollo', 'a-123');
      expect(await tryInsert(ORG_B, b, 'apollo', 'a-123')).toBe('ok');
    });
  });

  it('the same identifier on two platforms is two claims', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, 'apollo', 'shared-1');
      expect(await tryInsert(ORG_A, p, 'linkedin', 'shared-1')).toBe('ok');
    });
  });

  it('one person may hold several provider identities at once', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      await insert(ORG_A, p, 'apollo', 'a-1');
      await insert(ORG_A, p, 'linkedin', 'l-1');
      await insert(ORG_A, p, 'crm', 'c-1');
      const { rows } = await db.query(
        `SELECT count(*)::int n FROM public.identity_claims WHERE person_id=$1 AND source='identity_dual_write'`, [p]);
      expect(Number(rows[0].n)).toBe(3);
    });
  });

  it('a revoked claim frees the key, so a later dual-write can re-record it', async () => {
    await inRollback(async () => {
      const p = await newPerson(ORG_A);
      const id = (await insert(ORG_A, p, 'apollo', 'a-123')).rows[0].id;
      await db.query(`UPDATE public.identity_claims SET revoked_at=now(), revoked_reason='test' WHERE id=$1`, [id]);
      expect(await tryInsert(ORG_A, p, 'apollo', 'a-123')).toBe('ok');
    });
  });
});

describe('LI-5D — concurrency', () => {
  it('two concurrent dual-writes of the same identity yield exactly one claim', async () => {
    const { Client } = await import('pg');
    const url = process.env.W6_DB_URL as string;
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    let person = '';
    try {
      person = (await c1.query(
        'INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [ORG_A])).rows[0].id;

      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const params = [ORG_A, person, 'apollo', 'race-1', 'RAW'];

      await c1.query(INS, params);

      let settled = false;
      const pending = c2.query(INS, params)
        .then((r) => { settled = true; return r; })
        .catch((e) => { settled = true; return e; });

      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);                    // the second BLOCKS on the index

      await c1.query('COMMIT');
      const second = await pending as { code?: string };
      expect(second?.code).toBe('23505');             // and loses, benignly
      await c2.query('ROLLBACK').catch(() => {});

      const { rows } = await c1.query(
        `SELECT count(*)::int n FROM public.identity_claims WHERE normalized_value='race-1'`);
      expect(Number(rows[0].n)).toBe(1);
    } finally {
      await db.query(`DELETE FROM public.identity_claims WHERE normalized_value='race-1'`).catch(() => {});
      await db.query('DELETE FROM public.unified_persons WHERE id=$1', [person]).catch(() => {});
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});

describe('LI-5D — the legacy store is untouched', () => {
  it('external_keys still has only its GIN index', async () => {
    const { rows } = await db.query(`
      SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='unified_persons' AND indexdef LIKE '%external_keys%'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/USING gin/);
    expect(rows[0].indexdef).not.toMatch(/UNIQUE/);
  });

  it('a legacy-shaped external_keys row is still legal — nothing was migrated', async () => {
    await inRollback(async () => {
      expect(await attempt(
        `INSERT INTO public.unified_persons (company_id, external_keys)
         VALUES ($1, '{"linkedin_urns":["urn:li:person:x"]}'::jsonb)`, [ORG_A])).toBe('ok');
    });
  });

  it('an unresolved claim remains expressible and is never linked by this phase', async () => {
    await inRollback(async () => {
      // A durable insert, not `attempt()` — that rolls back to a savepoint, so a
      // row created through it can never be queried afterwards.
      await insert(ORG_A, null, 'linkedin', 'unresolved-1');
      const { rows } = await db.query(
        `SELECT person_id FROM public.identity_claims WHERE normalized_value='unresolved-1'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].person_id).toBeNull();
    });
  });
});
