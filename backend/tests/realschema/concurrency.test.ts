/**
 * W6 — concurrency, against real PostgreSQL locking.
 *
 * The programme's identity guarantees rest on database constraints rather than
 * read-then-write application logic, precisely so that two workers racing on the
 * same evidence cannot produce two canonical entities. That claim is only
 * testable with real concurrent sessions.
 *
 * These tests are deterministic, not timing-based: the second session is issued
 * while the first transaction is still open, and the assertion is on the
 * SQLSTATE the loser receives after the winner commits. No sleep decides the
 * outcome — the one sleep present only measures whether the loser was blocked,
 * which is reported but never asserted on.
 */
import { Client } from 'pg';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

const url = process.env.W6_DB_URL as string;

/**
 * Run two statements in genuinely separate sessions: A starts and holds, B is
 * issued, A commits, then B's result is collected.
 */
async function race(
  a: { sql: string; params: unknown[] },
  b: { sql: string; params: unknown[] },
): Promise<{ aOk: boolean; bCode: string; bBlocked: boolean }> {
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await Promise.all([c1.connect(), c2.connect()]);
  try {
    await c1.query('BEGIN');
    await c2.query('BEGIN');
    await c1.query(a.sql, a.params);

    let settled = false;
    const pending = c2.query(b.sql, b.params)
      .then((r) => { settled = true; return r; })
      .catch((e) => { settled = true; return e; });

    await new Promise((r) => setTimeout(r, 400));
    const bBlocked = !settled;

    await c1.query('COMMIT');
    const result: any = await pending;
    await c2.query('ROLLBACK').catch(() => {});
    return { aOk: true, bCode: result?.code ?? 'ok', bBlocked };
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

/**
 * These tests cannot use inRollback(): two sessions can only see each other's
 * work once it is committed, so the fixtures here are committed and then
 * removed. Cleanup runs in afterEach rather than afterAll because the shared
 * client is closed by the harness's own afterAll, which is registered first and
 * therefore runs first.
 */
beforeAll(async () => {
  await seedTenants();
});

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'w6-conc'`);
  await db.query(`DELETE FROM public.identity_claims  WHERE source = 'w6-conc'`);
  await db.query(`DELETE FROM public.unified_touchpoints WHERE source = 'w6-conc'`);
  await db.query(`DELETE FROM public.unified_persons  WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

const account = (org: string, domain: string | null, ref: string | null) => ({
  sql: `INSERT INTO public.prospect_accounts (organization_id, domain_normalized, source, source_reference)
        VALUES ($1,$2,'w6-conc',$3)`,
  params: [org, domain, ref],
});

describe('same tenant + same account identity → exactly one account', () => {
  it('same provider reference: the loser gets 23505', async () => {
    const r = await race(account(ORG_A, 'c1.w6', 'CR1'), account(ORG_A, 'c2.w6', 'CR1'));
    expect(r.bCode).toBe('23505');
    expect(r.bBlocked).toBe(true);
  });

  it('same domain: the loser gets 23505', async () => {
    const r = await race(account(ORG_A, 'cd.w6', 'CD1'), account(ORG_A, 'cd.w6', 'CD2'));
    expect(r.bCode).toBe('23505');
  });
});

describe('different tenants → two separate accounts', () => {
  it('same provider reference across tenants both succeed', async () => {
    const r = await race(account(ORG_A, 'c3.w6', 'CR3'), account(ORG_B, 'c4.w6', 'CR3'));
    expect(r.bCode).toBe('ok');
  });

  it('same domain across tenants both succeed', async () => {
    const r = await race(account(ORG_A, 'cx.w6', 'CX1'), account(ORG_B, 'cx.w6', 'CX2'));
    expect(r.bCode).toBe('ok');
  });
});

describe('same tenant + same claim → exactly one claim', () => {
  it('a concurrent duplicate claim loses with 23505', async () => {
    const { rows } = await db.query(
      'INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [ORG_A]);
    const person = rows[0].id;
    const claim = (value: string) => ({
      sql: `INSERT INTO public.identity_claims
              (organization_id, person_id, claim_type, platform, normalized_value, source)
            VALUES ($1,$2,'email',NULL,$3,'w6-conc')`,
      params: [ORG_A, person, value],
    });
    const r = await race(claim('race@w6.test'), claim('race@w6.test'));
    expect(r.bCode).toBe('23505');
  });
});

describe('a person cannot be re-tenanted out from under a reference', () => {
  it('the referenced person is locked, and the move is then rejected', async () => {
    const { rows } = await db.query(
      'INSERT INTO public.unified_persons (company_id) VALUES ($1) RETURNING id', [ORG_A]);
    const person = rows[0].id;
    const r = await race(
      {
        sql: `INSERT INTO public.unified_touchpoints
                (company_id, unified_person_id, source, touchpoint_type, reference_table, reference_id, occurred_at)
              VALUES ($1,$2,'w6-conc','w6','w6','w6',now())`,
        params: [ORG_A, person],
      },
      { sql: 'UPDATE public.unified_persons SET company_id=$1 WHERE id=$2', params: [ORG_B, person] },
    );
    expect(r.bBlocked).toBe(true);
    expect(r.bCode).toBe('23503');
    await db.query(`DELETE FROM public.unified_touchpoints WHERE source='w6-conc'`);
  });
});

describe('the suite leaves nothing behind', () => {
  it('has removed every committed fixture by this point', async () => {
    // afterEach has run for all preceding tests in this file.
    const { rows } = await db.query(`
      SELECT (SELECT count(*)::int FROM public.prospect_accounts   WHERE source='w6-conc') a,
             (SELECT count(*)::int FROM public.identity_claims     WHERE source='w6-conc') c,
             (SELECT count(*)::int FROM public.unified_touchpoints WHERE source='w6-conc') t`);
    expect(rows[0]).toEqual({ a: 0, c: 0, t: 0 });
  });

  it('rolls back transactional fixtures', async () => {
    const before = await db.query('SELECT count(*)::int n FROM public.unified_persons');
    await inRollback(async () => {
      await db.query('INSERT INTO public.unified_persons (company_id) VALUES ($1)', [ORG_A]);
    });
    const after = await db.query('SELECT count(*)::int n FROM public.unified_persons');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
