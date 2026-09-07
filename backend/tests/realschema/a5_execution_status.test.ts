/**
 * A5 — execution status, against real PostgreSQL.
 *
 * Two things can only be proven here rather than against a mock:
 *   - the CHECK actually REJECTS a value outside the closed vocabulary;
 *   - the column really defaults to `in_flight`, so a row inserted by any path
 *     — including direct SQL that predates the TypeScript writer — starts in a
 *     truthful state rather than a null or an empty string.
 *
 * It also pins the orthogonality that A4T's audit turned on: `mark_failed` and
 * `platform_failed` must be storable side by side with the SAME null outcome and
 * DIFFERENT provider_call_state, because that pair is exactly what the previous
 * model could not express.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract as
 * its siblings and has not been run locally.
 */
import { db, seedTenants, newAccount, constraintDef, ORG_A, ORG_B } from './setup';

const PROVIDER = 'a5-exec-status';

/** Open an attempt, optionally naming an execution status. */
async function open(org: string, account: string, opts: {
  status?: string; callState?: string; outcome?: string | null; n?: number;
} = {}): Promise<string> {
  const cols = ['organization_id', 'account_id', 'provider_key', 'requested_attributes',
    'attempt_number', 'correlation_id', 'started_at', 'provider_call_state', 'outcome'];
  const vals = ['$1', '$2', '$3', `'{employee_count}'`, '$4', `'corr-a5'`, 'now()', '$5', '$6'];
  const params: unknown[] = [org, account, PROVIDER, opts.n ?? 1,
    opts.callState ?? 'not_called', opts.outcome ?? null];
  if (opts.status !== undefined) { cols.push('execution_status'); vals.push('$7'); params.push(opts.status); }
  const { rows } = await db.query(
    `INSERT INTO public.prospect_enrichment_attempts (${cols.join(',')})
     VALUES (${vals.join(',')}) RETURNING id, execution_status`, params);
  return rows[0].id;
}

beforeAll(async () => { await seedTenants(); });

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key = $1`, [PROVIDER]);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a5'`);
  await db.query(`DELETE FROM public.unified_persons WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

describe('A5 — the column and its constraint exist', () => {
  it('execution_status is text NOT NULL defaulting to in_flight', async () => {
    const { rows } = await db.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'
          AND column_name='execution_status'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('NO');
    expect(String(rows[0].column_default)).toMatch(/in_flight/);
  });

  it('the CHECK names exactly the six values', async () => {
    const def = await constraintDef('prospect_enrichment_attempts_execution_status_valid');
    expect(def).toBeTruthy();
    for (const v of ['in_flight', 'refused_pre_call', 'mark_failed',
      'platform_failed', 'completed', 'abandoned']) {
      expect(def).toContain(v);
    }
    // No scheduler or retry-policy state leaked into the database vocabulary.
    for (const v of ['retrying', 'retry_exhausted', 'waiting', 'queued', 'scheduled']) {
      expect(def).not.toContain(v);
    }
  });

  it('no retry, lineage or rate-limit column was added alongside it', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'`);
    const names = rows.map((r) => r.column_name);
    for (const forbidden of ['next_retry_at', 'retry_class', 'terminal',
      'prior_attempt_id', 'retry_policy_version', 'rate_limit_reset_at']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('A5 — the default and the closed set are enforced', () => {
  it('an insert that names no status starts in_flight', async () => {
    const a = await newAccount(ORG_A, { domain: 'a5-default.w6', source: 'a5' });
    const id = await open(ORG_A, a);
    const { rows } = await db.query(
      `SELECT execution_status FROM public.prospect_enrichment_attempts WHERE id=$1`, [id]);
    expect(rows[0].execution_status).toBe('in_flight');
  });

  it.each(['in_flight', 'refused_pre_call', 'mark_failed', 'platform_failed', 'completed', 'abandoned'])(
    '%s is storable', async (status) => {
      const a = await newAccount(ORG_A, { domain: `a5-ok-${status}.w6`, source: 'a5' });
      await expect(open(ORG_A, a, { status })).resolves.toBeTruthy();
    });

  it.each(['retrying', 'retry_exhausted', 'waiting', 'queued', 'scheduled', '', 'COMPLETED']
    .map((status, i) => [status, i] as const))(
    'a value outside the vocabulary (%s) is REJECTED', async (status, i) => {
      // The domain is derived from the INDEX, never from the status. `COMPLETED`
      // is deliberately uppercase — it proves the CHECK is case-sensitive — but
      // interpolating it produced `a5-bad-COMPLETED.w6`, which violates
      // `prospect_accounts_domain_normalized_shape`. `newAccount` then threw
      // OUTSIDE the `expect(...).rejects` wrapper, so the assertion under test
      // never ran at all. A fixture must never depend on the value it is testing.
      const a = await newAccount(ORG_A, { domain: `a5-bad-${i}.w6`, source: 'a5' });
      await expect(open(ORG_A, a, { status })).rejects.toMatchObject({ code: '23514' });
    });

  it('NULL is rejected by NOT NULL', async () => {
    const a = await newAccount(ORG_A, { domain: 'a5-null.w6', source: 'a5' });
    await expect(open(ORG_A, a, { status: null as unknown as string }))
      .rejects.toMatchObject({ code: '23502' });
  });
});

describe('A5 — the three dimensions are storable independently', () => {
  it('mark_failed and platform_failed coexist with the same NULL outcome', async () => {
    // This pair is the whole reason the column exists: identical `outcome`,
    // opposite retry safety, previously separable only by free-text detail.
    const a = await newAccount(ORG_A, { domain: 'a5-pair-1.w6', source: 'a5' });
    const b = await newAccount(ORG_A, { domain: 'a5-pair-2.w6', source: 'a5' });
    const markId = await open(ORG_A, a, { status: 'mark_failed', callState: 'not_called', outcome: null });
    const platId = await open(ORG_A, b, { status: 'platform_failed', callState: 'called', outcome: null });

    const { rows } = await db.query(
      `SELECT id, execution_status, provider_call_state, outcome
         FROM public.prospect_enrichment_attempts WHERE id = ANY($1::uuid[]) ORDER BY execution_status`,
      [[markId, platId]]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ execution_status: 'mark_failed', provider_call_state: 'not_called', outcome: null });
    expect(rows[1]).toMatchObject({ execution_status: 'platform_failed', provider_call_state: 'called', outcome: null });
  });

  it('in_flight coexists with an unknown provider-call state', async () => {
    // The process-death shape: transport was about to happen, the execution
    // never ended. Neither column can be inferred from the other.
    const a = await newAccount(ORG_A, { domain: 'a5-unknown.w6', source: 'a5' });
    const id = await open(ORG_A, a, { status: 'in_flight', callState: 'unknown' });
    const { rows } = await db.query(
      `SELECT execution_status, provider_call_state, completed_at
         FROM public.prospect_enrichment_attempts WHERE id=$1`, [id]);
    expect(rows[0]).toMatchObject({ execution_status: 'in_flight', provider_call_state: 'unknown' });
    expect(rows[0].completed_at).toBeNull();
  });

  it('completed spans several provider outcomes', async () => {
    for (const outcome of ['enriched', 'no_match', 'rate_limited']) {
      const a = await newAccount(ORG_A, { domain: `a5-out-${outcome}.w6`, source: 'a5' });
      const id = await open(ORG_A, a, { status: 'completed', callState: 'called', outcome });
      const { rows } = await db.query(
        `SELECT execution_status, outcome FROM public.prospect_enrichment_attempts WHERE id=$1`, [id]);
      expect(rows[0]).toMatchObject({ execution_status: 'completed', outcome });
    }
  });
});

describe('A5 — neighbouring contracts are untouched', () => {
  it('the A4Q call-state CHECK still stands', async () => {
    const def = await constraintDef('prospect_enrichment_attempts_call_state_valid');
    expect(def).toBeTruthy();
    for (const v of ['not_called', 'called', 'unknown']) expect(def).toContain(v);
  });

  it('the A4Y canonical-attribute CHECK still stands', async () => {
    const def = await constraintDef('prospect_enrichment_attempts_attributes_canonical');
    expect(def).toBeTruthy();
    expect(def).toMatch(/NOT \(requested_attributes IS DISTINCT FROM/i);
  });

  it('the four A4N/A4Y unique indexes are unchanged', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='prospect_enrichment_attempts'
          AND (indexname LIKE '%_live' OR indexname LIKE '%_unique') ORDER BY indexname`);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.indexdef).toMatch(/requested_attributes/);
      expect(r.indexdef).toMatch(/btree \(organization_id/);
      // A5 added no index and joined none.
      expect(r.indexdef).not.toMatch(/execution_status/);
    }
  });
});
