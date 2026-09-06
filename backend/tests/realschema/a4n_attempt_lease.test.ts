/**
 * A4N — the enrichment attempt lease, against real PostgreSQL.
 *
 * The claim's whole safety property is a database guarantee, so it is asserted
 * against the database. A mock can be made to reject a second insert; only
 * PostgreSQL can show that two genuinely concurrent sessions racing on the
 * partial unique index produce exactly one winner, and that the loser is
 * refused rather than blocked forever or silently allowed through.
 *
 * What is under test:
 *   - `prospect_enrichment_attempts_{person,account}_live` really do permit at
 *     most ONE open attempt per (tenant, entity, provider);
 *   - a completed attempt leaves that index, so append-only history still
 *     accumulates and the next attempt may claim;
 *   - the tenant is part of the key, so one tenant cannot block another;
 *   - different entities and different providers are independent work items;
 *   - the reclaim UPDATE re-checks expiry in its WHERE clause, so an ACTIVE
 *     lease cannot be stolen while an EXPIRED one can.
 *
 * Deterministic, not timing-based: the second session is issued while the first
 * transaction is still open, and the assertion is on the SQLSTATE the loser
 * receives after the winner commits.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract
 * as its siblings and has not been run locally.
 */
import { Client } from 'pg';
import { db, seedTenants, newAccount, newPerson, ORG_A, ORG_B } from './setup';

const url = process.env.W6_DB_URL as string;

const PROVIDER = 'a4n-lease';

/** Two genuinely separate sessions: A holds, B is issued, A commits. */
async function race(
  a: { sql: string; params: unknown[] },
  b: { sql: string; params: unknown[] },
): Promise<{ bCode: string; bBlocked: boolean }> {
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
    return { bCode: result?.code ?? 'ok', bBlocked };
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
}

const openAttempt = (org: string, accountId: string, n: number, provider = PROVIDER) => ({
  sql: `INSERT INTO public.prospect_enrichment_attempts
          (organization_id, account_id, provider_key, requested_attributes,
           attempt_number, correlation_id, started_at, claimed_by, claimed_until)
        VALUES ($1,$2,$3,'{employee_count}',$4,'a4n-corr', now(), 'worker', now() + interval '1 minute')`,
  params: [org, accountId, provider, n],
});

beforeAll(async () => {
  await seedTenants();
});

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key LIKE 'a4n-%'`);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a4n'`);
  await db.query(`DELETE FROM public.unified_persons WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

describe('A4N — the live index exists and is shaped as the migration declares', () => {
  it('both live partial unique indexes are present', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='prospect_enrichment_attempts'
          AND indexname IN ('prospect_enrichment_attempts_person_live',
                            'prospect_enrichment_attempts_account_live')
        ORDER BY indexname`);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.indexdef).toMatch(/UNIQUE/);
      expect(r.indexdef).toMatch(/completed_at IS NULL/);
    }
  });

  it('the lease columns exist and are nullable', async () => {
    const { rows } = await db.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'
          AND column_name IN ('claimed_by','claimed_until') ORDER BY column_name`);
    expect(rows.map((r) => r.column_name)).toEqual(['claimed_by', 'claimed_until']);
    expect(rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });
});

describe('A4N — exactly one concurrent claim survives', () => {
  it('two sessions racing the same work item: the loser gets 23505', async () => {
    const account = await newAccount(ORG_A, { domain: 'a4n1.w6', source: 'a4n' });
    // DIFFERENT attempt numbers — the case A4J could not stop.
    const r = await race(openAttempt(ORG_A, account, 1), openAttempt(ORG_A, account, 2));
    expect(r.bCode).toBe('23505');
  });

  it('a completed attempt frees the slot, so history still accumulates', async () => {
    const account = await newAccount(ORG_A, { domain: 'a4n2.w6', source: 'a4n' });
    await db.query(openAttempt(ORG_A, account, 1).sql, openAttempt(ORG_A, account, 1).params);
    await db.query(
      `UPDATE public.prospect_enrichment_attempts SET completed_at = now(), outcome = 'enriched'
        WHERE organization_id=$1 AND account_id=$2`, [ORG_A, account]);

    // The second attempt now inserts cleanly — append-only history preserved.
    await db.query(openAttempt(ORG_A, account, 2).sql, openAttempt(ORG_A, account, 2).params);
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.prospect_enrichment_attempts
        WHERE organization_id=$1 AND account_id=$2`, [ORG_A, account]);
    expect(rows[0].n).toBe(2);
  });

  it('one tenant cannot block another', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4n3.w6', source: 'a4n' });
    const b = await newAccount(ORG_B, { domain: 'a4n4.w6', source: 'a4n' });
    const r = await race(openAttempt(ORG_A, a, 1), openAttempt(ORG_B, b, 1));
    expect(r.bCode).toBe('ok');
  });

  it('different entities are independent work items', async () => {
    const a1 = await newAccount(ORG_A, { domain: 'a4n5.w6', source: 'a4n' });
    const a2 = await newAccount(ORG_A, { domain: 'a4n6.w6', source: 'a4n' });
    const r = await race(openAttempt(ORG_A, a1, 1), openAttempt(ORG_A, a2, 1));
    expect(r.bCode).toBe('ok');
  });

  it('different providers are independent work items', async () => {
    const account = await newAccount(ORG_A, { domain: 'a4n7.w6', source: 'a4n' });
    const r = await race(openAttempt(ORG_A, account, 1, 'a4n-x'), openAttempt(ORG_A, account, 1, 'a4n-y'));
    expect(r.bCode).toBe('ok');
  });

  it('the person leg is arbitrated too', async () => {
    const person = await newPerson(ORG_A);
    const openPerson = (n: number) => ({
      sql: `INSERT INTO public.prospect_enrichment_attempts
              (organization_id, person_id, provider_key, requested_attributes,
               attempt_number, correlation_id, started_at)
            VALUES ($1,$2,$3,'{job_title}',$4,'a4n-corr', now())`,
      params: [ORG_A, person, PROVIDER, n],
    });
    const r = await race(openPerson(1), openPerson(2));
    expect(r.bCode).toBe('23505');
  });
});

describe('A4N — reclaim re-checks expiry in the predicate', () => {
  it('an ACTIVE lease cannot be stolen', async () => {
    const account = await newAccount(ORG_A, { domain: 'a4n8.w6', source: 'a4n' });
    await db.query(openAttempt(ORG_A, account, 1).sql, openAttempt(ORG_A, account, 1).params);
    // The reclaim predicate: live AND expired. The lease has a minute to run.
    const { rowCount } = await db.query(
      `UPDATE public.prospect_enrichment_attempts
          SET claimed_by='thief', claimed_until = now() + interval '1 minute'
        WHERE organization_id=$1 AND account_id=$2 AND provider_key=$3
          AND completed_at IS NULL AND claimed_until < now()
        RETURNING id`, [ORG_A, account, PROVIDER]);
    expect(rowCount).toBe(0);
  });

  it('an EXPIRED lease is reclaimable, exactly once', async () => {
    const account = await newAccount(ORG_A, { domain: 'a4n9.w6', source: 'a4n' });
    await db.query(
      `INSERT INTO public.prospect_enrichment_attempts
         (organization_id, account_id, provider_key, requested_attributes,
          attempt_number, correlation_id, started_at, claimed_by, claimed_until)
       VALUES ($1,$2,$3,'{employee_count}',1,'a4n-corr', now(), 'dead-worker', now() - interval '1 minute')`,
      [ORG_A, account, PROVIDER]);

    const steal = {
      sql: `UPDATE public.prospect_enrichment_attempts
               SET claimed_by='recoverer', claimed_until = now() + interval '1 minute'
             WHERE organization_id=$1 AND account_id=$2 AND provider_key=$3
               AND completed_at IS NULL AND claimed_until < now()
             RETURNING id`,
      params: [ORG_A, account, PROVIDER],
    };
    const { rowCount } = await db.query(steal.sql, steal.params);
    expect(rowCount).toBe(1);

    // A second reclaimer finds nothing: the predicate no longer matches.
    const again = await db.query(steal.sql, steal.params);
    expect(again.rowCount).toBe(0);
  });
});
