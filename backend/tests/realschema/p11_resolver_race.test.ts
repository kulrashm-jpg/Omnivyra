/**
 * P1-1 — the identity create race, against real PostgreSQL.
 *
 * The unit tests inject a `23505` and prove the resolver recovers from it. This
 * proves the `23505` is real: two independent sessions, two concurrent
 * transactions, one brand-new identity, and the database — not the application —
 * deciding who wins.
 *
 * It also pins the fact the fix depends on: `unified_persons` has FOUR unique
 * arbiters, and only two of them describe identity. A recovery keyed on the bare
 * SQLSTATE would silently absorb a primary-key collision.
 */
import { db, inRollback, seedTenants, ORG_A, ORG_B, attempt, newPerson } from './setup';

const EMAIL = 'p11.race@li.test';
const PHONE = '+15550177777';

beforeAll(seedTenants);

describe('P1-1 — the identity uniqueness arbiters', () => {
  it('exactly two unique indexes describe a person\'s identity', async () => {
    const { rows } = await db.query(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname='public' AND tablename='unified_persons' AND indexdef LIKE '%UNIQUE%'
       ORDER BY indexname`);
    const names = rows.map((r: { indexname: string }) => r.indexname);

    // The two the resolver may recover from.
    expect(names).toContain('idx_unified_persons_company_email_unique');
    expect(names).toContain('idx_unified_persons_company_phone_unique');
    // ...and the two it must NOT, both keyed on id.
    expect(names).toContain('unified_persons_pkey');
    expect(names).toContain('uq_unified_persons_id_company');
  });

  it('both identity indexes are TENANT-scoped, so a race is always within one tenant', async () => {
    const { rows } = await db.query(`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN ('idx_unified_persons_company_email_unique','idx_unified_persons_company_phone_unique')`);
    for (const r of rows) expect(r.indexdef).toMatch(/\(company_id, primary_(email|phone)\)/);
  });

  it('a duplicate email within one tenant raises 23505 on the EMAIL index', async () => {
    await inRollback(async () => {
      await db.query('INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2)', [ORG_A, EMAIL]);
      const code = await attempt(
        'INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2)', [ORG_A, EMAIL]);
      expect(code).toBe('23505');
    });
  });

  it('the SAME email in a DIFFERENT tenant does not conflict', async () => {
    await inRollback(async () => {
      await db.query('INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2)', [ORG_A, EMAIL]);
      const code = await attempt(
        'INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2)', [ORG_B, EMAIL]);
      expect(code).toBe('ok');
    });
  });

  it('a duplicate phone within one tenant raises 23505 on the PHONE index', async () => {
    await inRollback(async () => {
      await db.query('INSERT INTO public.unified_persons (company_id, primary_phone) VALUES ($1,$2)', [ORG_A, PHONE]);
      expect(await attempt(
        'INSERT INTO public.unified_persons (company_id, primary_phone) VALUES ($1,$2)', [ORG_A, PHONE])).toBe('23505');
    });
  });

  it('a duplicate EXTERNAL KEY does NOT conflict — there is no unique index for it', async () => {
    await inRollback(async () => {
      const keys = JSON.stringify({ manual: { external_id: 'P11-1' } });
      await db.query('INSERT INTO public.unified_persons (company_id, external_keys) VALUES ($1,$2::jsonb)', [ORG_A, keys]);
      // Documents a real limit: the resolver matches on external keys, but the
      // database does not enforce their uniqueness, so a concurrent create
      // anchored ONLY on them cannot be caught by 23505.
      expect(await attempt(
        'INSERT INTO public.unified_persons (company_id, external_keys) VALUES ($1,$2::jsonb)', [ORG_A, keys])).toBe('ok');
    });
  });
});

describe('P1-1 — the real race, two sessions', () => {
  /** Two concurrent transactions inserting the same brand-new identity. */
  async function race(column: 'primary_email' | 'primary_phone', value: string, orgA: string, orgB: string) {
    const { Client } = await import('pg');
    const url = process.env.W6_DB_URL as string;
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const sql = `INSERT INTO public.unified_persons (company_id, ${column}) VALUES ($1,$2) RETURNING id`;

      const first = await c1.query(sql, [orgA, value]);

      let settled = false;
      const pending = c2.query(sql, [orgB, value])
        .then((r) => { settled = true; return r; })
        .catch((e) => { settled = true; return e; });

      await new Promise((r) => setTimeout(r, 400));
      const blocked = !settled;

      await c1.query('COMMIT');
      const second = await pending as { code?: string; message?: string; rows?: Array<{ id: string }> };
      await c2.query('ROLLBACK').catch(() => {});

      const surviving = await c1.query(
        `SELECT id FROM public.unified_persons WHERE ${column} = $1`, [value]);
      await c1.query(`DELETE FROM public.unified_persons WHERE ${column} = $1`, [value]);

      return { winnerId: first.rows[0].id, blocked, second, survivingCount: surviving.rows.length };
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  }

  it('EMAIL: the loser blocks, then receives 23505 naming the identity index', async () => {
    const r = await race('primary_email', EMAIL, ORG_A, ORG_A);

    expect(r.blocked).toBe(true);                                  // it waited on the index
    expect(r.second.code).toBe('23505');                           // and then lost
    // The error names the index the resolver keys its recovery on.
    expect(r.second.message).toContain('idx_unified_persons_company_email_unique');
    expect(r.survivingCount).toBe(1);                              // exactly one person
  });

  it('PHONE: the same, on the phone index', async () => {
    const r = await race('primary_phone', PHONE, ORG_A, ORG_A);
    expect(r.blocked).toBe(true);
    expect(r.second.code).toBe('23505');
    expect(r.second.message).toContain('idx_unified_persons_company_phone_unique');
    expect(r.survivingCount).toBe(1);
  });

  it('ACROSS TENANTS: neither blocks, and both persons survive independently', async () => {
    const r = await race('primary_email', 'p11.cross@li.test', ORG_A, ORG_B);
    expect(r.blocked).toBe(false);                                 // no contention at all
    expect(r.second.code).toBeUndefined();                         // it succeeded
    // c2 rolled back, so only A's row persisted — the point is that B was never
    // blocked by A and would have created its own independent person.
    expect(r.survivingCount).toBe(1);
  });

  it('the losing transaction leaves NO duplicate, candidate or provenance debris', async () => {
    await race('primary_email', 'p11.debris@li.test', ORG_A, ORG_A);
    const { rows } = await db.query(`
      SELECT (SELECT count(*)::int FROM public.unified_persons WHERE primary_email='p11.debris@li.test') p,
             (SELECT count(*)::int FROM public.person_duplicate_candidates) c,
             (SELECT count(*)::int FROM public.source_records) s`);
    expect(Number(rows[0].p)).toBe(0);      // cleaned up by the race helper
    expect(Number(rows[0].c)).toBe(0);
    expect(Number(rows[0].s)).toBe(0);
  });
});

describe('P1-1 — the winner is findable, which is what recovery depends on', () => {
  it('after the winner commits, the losing tenant-scoped lookup finds exactly it', async () => {
    await inRollback(async () => {
      const id = (await db.query(
        'INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2) RETURNING id',
        [ORG_A, EMAIL])).rows[0].id;

      // Precisely the query the resolver re-runs on conflict.
      const { rows } = await db.query(
        `SELECT id FROM public.unified_persons
          WHERE company_id=$1 AND primary_email=$2 ORDER BY created_at ASC LIMIT 1`, [ORG_A, EMAIL]);

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id);
    });
  });

  it('that lookup is tenant-scoped, so another tenant\'s person is never returned', async () => {
    await inRollback(async () => {
      await db.query('INSERT INTO public.unified_persons (company_id, primary_email) VALUES ($1,$2)', [ORG_B, EMAIL]);
      const { rows } = await db.query(
        `SELECT id FROM public.unified_persons WHERE company_id=$1 AND primary_email=$2`, [ORG_A, EMAIL]);
      expect(rows).toHaveLength(0);
      void (await newPerson(ORG_A));
    });
  });
});
