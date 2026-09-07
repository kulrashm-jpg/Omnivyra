/**
 * A6A — the retry horizon column, against real PostgreSQL.
 *
 * Three things can only be proven here:
 *   - the column is genuinely NULLABLE with no default, so "the provider said
 *     nothing" is storable as NULL rather than as a fabricated instant;
 *   - it is `timestamptz`, matching every other instant on this table, so a
 *     horizon is comparable to `now()` without a cast;
 *   - adding it introduced no retry classification, lineage or policy column;
 *   - and, since A6B, that the ONE index built for the horizon is exactly the
 *     one the retry-candidate reader was written against.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract as
 * its siblings and has not been run locally.
 */
import { db, seedTenants, newAccount, ORG_A, ORG_B } from './setup';

const PROVIDER = 'a6a-horizon';

async function open(org: string, account: string, opts: {
  nextRetryAt?: string | null; outcome?: string | null; status?: string; n?: number;
} = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_enrichment_attempts
       (organization_id, account_id, provider_key, requested_attributes, attempt_number,
        correlation_id, started_at, outcome, execution_status, provider_call_state, next_retry_at)
     VALUES ($1,$2,$3,'{employee_count}',$4,'corr-a6a', now(), $5, $6, 'called', $7)
     RETURNING id`,
    [org, account, PROVIDER, opts.n ?? 1, opts.outcome ?? null,
      opts.status ?? 'completed', opts.nextRetryAt ?? null]);
  return rows[0].id;
}

beforeAll(async () => { await seedTenants(); });

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key = $1`, [PROVIDER]);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a6a'`);
  await db.query(`DELETE FROM public.unified_persons WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

describe('A6A — the column is shaped for "no opinion"', () => {
  it('next_retry_at is a NULLABLE timestamptz with no default', async () => {
    const { rows } = await db.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'
          AND column_name='next_retry_at'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('timestamp with time zone');
    // NULL is the normal case — most responses carry no horizon at all.
    expect(rows[0].is_nullable).toBe('YES');
    expect(rows[0].column_default).toBeNull();
  });

  it('no retry classification, lineage or policy column came with it', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'`);
    const names = rows.map((r) => r.column_name);
    expect(names).toContain('next_retry_at');
    for (const forbidden of ['retry_class', 'terminal', 'prior_attempt_id',
      'retry_policy_version', 'rate_limit_reset_at', 'max_attempts']) {
      expect(names).not.toContain(forbidden);
    }
  });

  // ─── SUPERSEDED BY A6B, DELIBERATELY INVERTED ───────────────────────────
  // This assertion used to read `.toBe(false)`: A6A added the column and no
  // index, because its own migration said an index "would only pay off for a
  // scheduler scanning for due work, and no such reader exists". A6B built that
  // reader (`listDueRetryCandidates`), so the precondition is gone and migration
  // 20261021000000 adds the index. The invariant is inverted rather than deleted:
  // the question "is the horizon indexed, and correctly?" still has to be
  // answered here, because only real PostgreSQL can answer it.
  describe('A6B — the horizon index', () => {
    const NAME = 'idx_prospect_enrichment_attempts_retry_due';

    it('exists, under the name the migration gives it', async () => {
      const { rows } = await db.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname='public' AND tablename='prospect_enrichment_attempts'
            AND indexname=$1`, [NAME]);
      expect(rows).toHaveLength(1);
    });

    it('leads on organization_id and follows with next_retry_at, in that order', async () => {
      // Read from the catalogue, not from indexdef text: the column ORDER is the
      // property that makes this index serve the reader's equality-then-range
      // predicate and its ORDER BY, and a text match could be satisfied by a
      // definition that happens to contain both names.
      const { rows } = await db.query(
        `SELECT a.attname
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE c.relname = $1
          ORDER BY k.ord`, [NAME]);
      // Tenant first — isolation is structural, not conventional. The horizon
      // second, because it is both the range predicate and the sort.
      expect(rows.map((r) => r.attname)).toEqual(['organization_id', 'next_retry_at']);
    });

    it('is PARTIAL on next_retry_at IS NOT NULL — a row with no horizon is not stored', async () => {
      const { rows } = await db.query(
        `SELECT i.indpred IS NOT NULL AS partial,
                pg_get_expr(i.indpred, i.indrelid) AS predicate,
                i.indisunique AS unique
           FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = $1`, [NAME]);
      expect(rows).toHaveLength(1);
      expect(rows[0].partial).toBe(true);
      // NULL is the normal case and 20261020 is explicit that it does NOT mean
      // "retry now", so those rows are excluded from the index rather than kept.
      expect(rows[0].predicate).toBe('(next_retry_at IS NOT NULL)');
      // An access path, never a constraint: two attempts may share a horizon.
      expect(rows[0].unique).toBe(false);
    });

    it('is the ONLY index on the horizon — no duplicate access path came with it', async () => {
      const { rows } = await db.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname='public' AND tablename='prospect_enrichment_attempts'
            AND indexdef LIKE '%next_retry_at%'
          ORDER BY indexname`);
      expect(rows.map((r) => r.indexname)).toEqual([NAME]);
    });
  });
});

describe('A6A — a horizon is storable, absent, and comparable', () => {
  it('a real horizon round-trips as an instant', async () => {
    const a = await newAccount(ORG_A, { domain: 'a6a-1.w6', source: 'a6a' });
    const at = '2026-09-07T12:05:00.000Z';
    const id = await open(ORG_A, a, { outcome: 'rate_limited', nextRetryAt: at });

    const { rows } = await db.query(
      `SELECT next_retry_at FROM public.prospect_enrichment_attempts WHERE id=$1`, [id]);
    expect(new Date(rows[0].next_retry_at).toISOString()).toBe(at);
  });

  it('an absent horizon is NULL, not an epoch or a zero', async () => {
    const a = await newAccount(ORG_A, { domain: 'a6a-2.w6', source: 'a6a' });
    const id = await open(ORG_A, a, { outcome: 'no_match' });

    const { rows } = await db.query(
      `SELECT next_retry_at FROM public.prospect_enrichment_attempts WHERE id=$1`, [id]);
    expect(rows[0].next_retry_at).toBeNull();
  });

  it('a future horizon is comparable to now() without a cast', async () => {
    // This is the whole point of timestamptz: a future scheduler must be able to
    // ask "is this due?" directly. NULL must not answer that question either way.
    const a = await newAccount(ORG_A, { domain: 'a6a-3.w6', source: 'a6a' });
    const b = await newAccount(ORG_A, { domain: 'a6a-4.w6', source: 'a6a' });
    await open(ORG_A, a, { outcome: 'rate_limited', nextRetryAt: new Date(Date.now() + 3_600_000).toISOString() });
    await open(ORG_A, b, { outcome: 'no_match' });

    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE next_retry_at > now())::int future,
              count(*) FILTER (WHERE next_retry_at IS NULL)::int silent,
              count(*)::int total
         FROM public.prospect_enrichment_attempts WHERE provider_key = $1`, [PROVIDER]);
    expect(rows[0]).toMatchObject({ future: 1, silent: 1, total: 2 });
  });
});

describe('A6A — neighbouring contracts are untouched', () => {
  it('the A5 execution-status CHECK still stands', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conname='prospect_enrichment_attempts_execution_status_valid'`);
    expect(rows).toHaveLength(1);
    for (const v of ['in_flight', 'refused_pre_call', 'mark_failed',
      'platform_failed', 'completed', 'abandoned']) {
      expect(rows[0].d).toContain(v);
    }
  });

  it('the A4Q call-state CHECK still stands', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conname='prospect_enrichment_attempts_call_state_valid'`);
    expect(rows).toHaveLength(1);
    for (const v of ['not_called', 'called', 'unknown']) expect(rows[0].d).toContain(v);
  });

  it('the four A4N/A4Y unique indexes are unchanged', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='prospect_enrichment_attempts'
          AND (indexname LIKE '%_live' OR indexname LIKE '%_unique')`);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.indexdef).toMatch(/requested_attributes/);
      expect(r.indexdef).toMatch(/btree \(organization_id/);
    }
  });
});
