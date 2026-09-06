/**
 * A4U — recovery of an abandoned attempt, against real PostgreSQL.
 *
 * A4T Blocker 1 was a SQL-semantics defect: `claimed_until < now()` on a NULL
 * lease evaluates to NULL, which a WHERE clause treats as false, so an
 * abandoned unleased attempt could never be reclaimed while the live partial
 * unique index went on blocking that work item forever. A defect about what
 * PostgreSQL does with NULL is asserted against PostgreSQL.
 *
 * What is under test:
 *   - an unleased abandoned row is NOT matched by the A4N predicate (the bug);
 *   - it IS matched once the A4U cutoff branch is present;
 *   - an ACTIVE unleased execution is not matched merely for lacking a lease;
 *   - an ACTIVE lease is still never stolen, and an EXPIRED one still is;
 *   - recovery is atomic: two racing recoverers produce exactly one winner;
 *   - recovery moves ownership ONLY — provider_call_state, provider_called,
 *     outcome, requested_attributes and correlation_id all survive intact;
 *   - the tenant is part of the predicate.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract
 * as its siblings and has not been run locally.
 */
import { Client } from 'pg';
import { db, seedTenants, newAccount, ORG_A, ORG_B } from './setup';

const url = process.env.W6_DB_URL as string;
const PROVIDER = 'a4u-recovery';

/** The A4U recovery statement, exactly as `dbReclaim` composes it. */
const RECOVER = `
  UPDATE public.prospect_enrichment_attempts
     SET claimed_by = $5, claimed_until = now() + interval '1 minute'
   WHERE organization_id = $1 AND account_id = $2 AND provider_key = $3
     AND completed_at IS NULL
     AND (claimed_until < now()
          OR (claimed_until IS NULL AND started_at < $4::timestamptz))
   RETURNING id`;

/** The A4N statement, without the A4U branch — used to prove the defect. */
const RECOVER_A4N_ONLY = `
  UPDATE public.prospect_enrichment_attempts
     SET claimed_by = 'a4n', claimed_until = now() + interval '1 minute'
   WHERE organization_id = $1 AND account_id = $2 AND provider_key = $3
     AND completed_at IS NULL AND claimed_until < now()
   RETURNING id`;

async function openAttempt(org: string, account: string, opts: {
  lease?: string | null; startedAgo?: string; state?: string; called?: boolean;
  outcome?: string | null; n?: number;
} = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_enrichment_attempts
       (organization_id, account_id, provider_key, requested_attributes, attempt_number,
        correlation_id, started_at, claimed_until, provider_call_state, provider_called, outcome)
     VALUES ($1,$2,$3,'{employee_count,founded_year}',$4,'corr-a4u',
             now() - ($5)::interval, $6, $7, $8, $9)
     RETURNING id`,
    [org, account, PROVIDER, opts.n ?? 1, opts.startedAgo ?? '2 hours',
      opts.lease === undefined ? null : opts.lease,
      opts.state ?? 'not_called', opts.called ?? false, opts.outcome ?? null],
  );
  return rows[0].id;
}

beforeAll(async () => { await seedTenants(); });

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key = $1`, [PROVIDER]);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a4u'`);
});

describe('A4U — the defect, and the fix', () => {
  it('A4N predicate does NOT match an unleased abandoned row (Blocker 1)', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u1.w6', source: 'a4u' });
    await openAttempt(ORG_A, a);                       // claimed_until NULL, started 2h ago
    const { rowCount } = await db.query(RECOVER_A4N_ONLY, [ORG_A, a, PROVIDER]);
    expect(rowCount).toBe(0);                          // NULL < now() is not true
  });

  it('the live index really does block a replacement while that row is open', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u2.w6', source: 'a4u' });
    await openAttempt(ORG_A, a);
    await expect(openAttempt(ORG_A, a, { n: 2 })).rejects.toMatchObject({ code: '23505' });
  });

  it('the A4U predicate DOES recover it', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u3.w6', source: 'a4u' });
    await openAttempt(ORG_A, a);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'recoverer']);
    expect(rowCount).toBe(1);
  });

  it('an ACTIVE unleased execution is not taken merely for lacking a lease', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u4.w6', source: 'a4u' });
    await openAttempt(ORG_A, a, { startedAgo: '1 minute' });     // started just now
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'thief']);
    expect(rowCount).toBe(0);
  });
});

describe('A4U — A4N lease behaviour is unchanged', () => {
  it('an ACTIVE lease is never stolen', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u5.w6', source: 'a4u' });
    await db.query(
      `INSERT INTO public.prospect_enrichment_attempts
         (organization_id, account_id, provider_key, requested_attributes, attempt_number,
          correlation_id, started_at, claimed_by, claimed_until)
       VALUES ($1,$2,$3,'{employee_count}',1,'corr-a4u', now() - interval '2 hours',
               'holder', now() + interval '5 minutes')`, [ORG_A, a, PROVIDER]);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'thief']);
    expect(rowCount).toBe(0);
  });

  it('an EXPIRED lease is still recoverable', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u6.w6', source: 'a4u' });
    await db.query(
      `INSERT INTO public.prospect_enrichment_attempts
         (organization_id, account_id, provider_key, requested_attributes, attempt_number,
          correlation_id, started_at, claimed_by, claimed_until)
       VALUES ($1,$2,$3,'{employee_count}',1,'corr-a4u', now() - interval '2 hours',
               'dead', now() - interval '1 minute')`, [ORG_A, a, PROVIDER]);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'recoverer']);
    expect(rowCount).toBe(1);
  });

  it('a completed attempt is never recovered', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u7.w6', source: 'a4u' });
    const id = await openAttempt(ORG_A, a);
    await db.query(`UPDATE public.prospect_enrichment_attempts SET completed_at = now() WHERE id = $1`, [id]);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'recoverer']);
    expect(rowCount).toBe(0);
  });
});

describe('A4U — recovery preserves everything except ownership', () => {
  it.each(['not_called', 'called', 'unknown'])('%s survives recovery', async (state) => {
    const a = await newAccount(ORG_A, { domain: `a4u-${state}.w6`, source: 'a4u' });
    const id = await openAttempt(ORG_A, a, {
      state, called: state === 'called', outcome: state === 'called' ? 'no_match' : null,
    });
    await db.query(RECOVER, [ORG_A, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'recoverer']);

    const { rows } = await db.query(
      `SELECT provider_call_state, provider_called, outcome, requested_attributes,
              correlation_id, claimed_by
         FROM public.prospect_enrichment_attempts WHERE id = $1`, [id]);
    const r = rows[0];
    expect(r.provider_call_state).toBe(state);                  // never downgraded
    expect(r.provider_called).toBe(state === 'called');
    expect(r.outcome).toBe(state === 'called' ? 'no_match' : null);
    expect(r.requested_attributes).toEqual(['employee_count', 'founded_year']);
    expect(r.correlation_id).toBe('corr-a4u');
    expect(r.claimed_by).toBe('recoverer');                     // ownership DID move
  });
});

describe('A4U — recovery is atomic and tenant-scoped', () => {
  it('two concurrent recoverers: exactly one wins', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u8.w6', source: 'a4u' });
    await openAttempt(ORG_A, a);
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();

    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      await c1.query('BEGIN');
      const first = await c1.query(RECOVER, [ORG_A, a, PROVIDER, cutoff, 'worker-A']);
      const pending = c2.query(RECOVER, [ORG_A, a, PROVIDER, cutoff, 'worker-B']);
      await c1.query('COMMIT');
      const second = await pending;
      expect(first.rowCount).toBe(1);
      // B's WHERE is re-evaluated after A commits: the lease is now in the future.
      expect(second.rowCount).toBe(0);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it('one tenant cannot recover another tenant\'s attempt', async () => {
    const a = await newAccount(ORG_A, { domain: 'a4u9.w6', source: 'a4u' });
    await openAttempt(ORG_A, a);
    const { rowCount } = await db.query(RECOVER,
      [ORG_B, a, PROVIDER, new Date(Date.now() - 30 * 60_000).toISOString(), 'other-tenant']);
    expect(rowCount).toBe(0);
  });
});
