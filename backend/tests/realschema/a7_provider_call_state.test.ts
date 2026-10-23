/**
 * A7 — the three-valued `provider_call_state`, against real PostgreSQL.
 *
 * A4Q shipped the column, the CHECK, the partial index and the writer, and was
 * proven entirely against mocks. Its siblings A4U and A4N were proven against
 * PostgreSQL because their defects were about what PostgreSQL DOES. B3's
 * property is the same kind of thing and had no real-schema test at all:
 *
 *   - only the database can show the CHECK REJECTING a fourth value; a mock can
 *     only promise that it would;
 *   - only the database can show what the column HOLDS after a writer stops
 *     halfway, because that is a question about committed rows;
 *   - only the database can show that recovery — an UPDATE naming two columns —
 *     leaves `unknown` standing, since "the UPDATE does not mention it" is a
 *     claim about SQL, not about TypeScript.
 *
 * What is under test:
 *   - the column's shape: NOT NULL, DEFAULT 'not_called', CHECK over exactly
 *     the three values, and the partial index the reclaimer's read needs;
 *   - the CHECK admits `not_called|called|unknown` and refuses everything else,
 *     including NULL and the empty string;
 *   - the pre-transport marker: not_called -> unknown, tenant-scoped, never
 *     re-opening a completed row, idempotent;
 *   - completion overwrites `unknown` with the proven answer, in both directions;
 *   - the FAILURE-BOUNDARY MATRIX: what the committed row says when the writer
 *     stops at each of the six boundaries, and the retry verdict each implies;
 *   - `unknown` is never silently downgraded — not by recovery, not by repeated
 *     recovery, and not by a recovery that also moves tenanted ownership;
 *   - abandoned work cannot produce an unsafe duplicate call: while the
 *     `unknown` row is open the live index refuses a second one, and the row a
 *     reclaimer inherits still refuses to say a call is safe.
 *
 * ─── THE SQL HERE IS A TRANSCRIPTION ──────────────────────────────────────
 * `markProviderCallPending` and `dbReclaim` compose their statements through
 * the Supabase builder, so the SQL below is written out by hand, exactly as
 * they compose it — the same convention `a4n`, `a4u` and `a4y` follow. That the
 * transcription matches the writer is asserted separately, on the source, in
 * `backend/tests/unit/piA7ProcessDeathProof.test.ts`.
 *
 * NOT EXECUTED BY THE AUTHOR: this suite requires `W6_DB_URL` and a disposable
 * database (scripts/ci/real-schema-ci.sh). It is written to the same contract
 * as its siblings and has not been run locally.
 */
import { db, seedTenants, newAccount, ORG_A, ORG_B } from './setup';

const PROVIDER = 'a7-call-state';
const SET = '{employee_count}';

/**
 * `markProviderCallPending`, exactly as it composes its UPDATE.
 *
 * `RETURNING id` is the one addition: the writer discards the row count, and
 * this suite needs it to tell "matched and updated" from "matched nothing" —
 * which is the whole difference between a tenant-scoped write and an
 * unscoped one.
 */
const MARK = `
  UPDATE public.prospect_enrichment_attempts
     SET provider_call_state = 'unknown'
   WHERE id = $1 AND organization_id = $2
     AND completed_at IS NULL
   RETURNING id`;

/** `completeAttempt`, narrowed to the columns this suite is about (+ RETURNING). */
const COMPLETE = `
  UPDATE public.prospect_enrichment_attempts
     SET outcome = $3, provider_called = $4, provider_call_state = $5, completed_at = now()
   WHERE id = $1 AND organization_id = $2
   RETURNING id`;

/** `dbReclaim` with A4U's cutoff and A4Y's attribute predicate, both present. */
const RECOVER = `
  UPDATE public.prospect_enrichment_attempts
     SET claimed_by = $6, claimed_until = now() + interval '1 minute'
   WHERE organization_id = $1 AND account_id = $2 AND provider_key = $3
     AND requested_attributes = $4::text[]
     AND completed_at IS NULL
     AND (claimed_until < now()
          OR (claimed_until IS NULL AND started_at < $5::timestamptz))
   RETURNING id`;

const CUTOFF = () => new Date(Date.now() - 30 * 60_000).toISOString();

/** Open an attempt the way `recordAttempt` does: state defaulted, never set. */
async function openAttempt(org: string, account: string, opts: {
  n?: number; lease?: string | null; startedAgo?: string; provider?: string;
} = {}): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.prospect_enrichment_attempts
       (organization_id, account_id, provider_key, requested_attributes, attempt_number,
        correlation_id, started_at, claimed_by, claimed_until)
     VALUES ($1,$2,$3,$4::text[],$5,'corr-a7', now() - ($6)::interval, 'worker-1', $7)
     RETURNING id`,
    [org, account, opts.provider ?? PROVIDER, SET, opts.n ?? 1,
      opts.startedAgo ?? '2 hours', opts.lease ?? null],
  );
  return rows[0].id;
}

/** The whole row, as a reclaimer would read it. */
async function row(id: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `SELECT provider_call_state, provider_called, outcome, completed_at,
            claimed_by, claimed_until, requested_attributes, correlation_id, attempt_number
       FROM public.prospect_enrichment_attempts WHERE id = $1`, [id]);
  return rows[0];
}

/** The ONLY safe reading. `provider_called` is deliberately not consulted. */
const safeToCall = (r: Record<string, unknown>): boolean => r.provider_call_state === 'not_called';

beforeAll(async () => { await seedTenants(); });

afterEach(async () => {
  await db.query(`DELETE FROM public.prospect_enrichment_attempts WHERE provider_key LIKE 'a7-%'`);
  await db.query(`DELETE FROM public.prospect_accounts WHERE source = 'a7'`);
  // These suites share one database. A leaked canonical row previously broke a
  // SIBLING that legitimately asserted a tenant held none — same cleanup as A4N.
  await db.query(`DELETE FROM public.unified_persons WHERE company_id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
});

// ── the column is shaped as the migration declares ──────────────────────────

describe('A7 — the deployed column', () => {
  it('is NOT NULL and defaults to not_called', async () => {
    const { rows } = await db.query(
      `SELECT is_nullable, column_default, data_type
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='prospect_enrichment_attempts'
          AND column_name='provider_call_state'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].data_type).toBe('text');
    expect(String(rows[0].column_default)).toMatch(/'not_called'/);
  });

  it('carries a CHECK naming exactly the three states', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
        WHERE conname = 'prospect_enrichment_attempts_call_state_valid'`);
    expect(rows).toHaveLength(1);
    for (const v of ['not_called', 'called', 'unknown']) expect(rows[0].d).toContain(`'${v}'`);
  });

  it('carries the partial index the reclaimer read needs', async () => {
    const { rows } = await db.query(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public'
          AND indexname='idx_prospect_enrichment_attempts_call_state'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/organization_id/);
    expect(rows[0].indexdef).toMatch(/provider_call_state/);
    // Partial on the live predicate: in-flight work only, which is the only
    // work a reclaimer can act on.
    expect(rows[0].indexdef).toMatch(/completed_at IS NULL/);
  });
});

// ── the CHECK really refuses, it does not merely promise to ─────────────────

describe('A7 — the vocabulary is enforced by the database', () => {
  it.each(['not_called', 'called', 'unknown'])('accepts %s', async (state) => {
    const a = await newAccount(ORG_A, { domain: `a7-ok-${state}.w6`, source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    const { rowCount } = await db.query(
      `UPDATE public.prospect_enrichment_attempts SET provider_call_state = $2
        WHERE id = $1 RETURNING id`, [id, state]);
    expect(rowCount).toBe(1);
    expect((await row(id)).provider_call_state).toBe(state);
  });

  it.each(['pending', 'maybe', 'NOT_CALLED', 'Called', '', ' unknown '])(
    'refuses %p with a CHECK violation', async (state) => {
      const a = await newAccount(ORG_A, { domain: 'a7-check.w6', source: 'a7' });
      const id = await openAttempt(ORG_A, a);
      // Asserted as a rejection rather than through setup's `attempt()`, which
      // issues a SAVEPOINT and is therefore only usable inside `inRollback()`.
      await expect(db.query(
        `UPDATE public.prospect_enrichment_attempts SET provider_call_state = $2 WHERE id = $1`,
        [id, state],
      )).rejects.toMatchObject({ code: '23514' });
    });

  it('refuses NULL — there is no fourth, absent state', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-null.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await expect(db.query(
      `UPDATE public.prospect_enrichment_attempts SET provider_call_state = NULL WHERE id = $1`, [id],
    )).rejects.toMatchObject({ code: '23502' });
  });

  it('a freshly opened attempt agrees with the boolean: nothing called yet', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-default.w6', source: 'a7' });
    const r = await row(await openAttempt(ORG_A, a));
    expect(r.provider_call_state).toBe('not_called');
    expect(r.provider_called).toBe(false);
    expect(r.completed_at).toBeNull();
  });
});

// ── the pre-transport marker ────────────────────────────────────────────────

describe('A7 — markProviderCallPending', () => {
  it('moves an open attempt from not_called to unknown', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-mark1.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    const { rowCount } = await db.query(MARK, [id, ORG_A]);
    expect(rowCount).toBe(1);
    expect((await row(id)).provider_call_state).toBe('unknown');
  });

  it('is idempotent — a retried mark does not change the answer', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-mark2.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    const again = await db.query(MARK, [id, ORG_A]);
    expect(again.rowCount).toBe(1);
    expect((await row(id)).provider_call_state).toBe('unknown');
  });

  it('one tenant cannot mark another tenant\'s attempt', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-mark3.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    const { rowCount } = await db.query(MARK, [id, ORG_B]);
    expect(rowCount).toBe(0);                                   // not found, not refused
    expect((await row(id)).provider_call_state).toBe('not_called');
  });

  it('never re-opens a completed attempt', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-mark4.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(COMPLETE, [id, ORG_A, 'enriched', true, 'called']);
    const { rowCount } = await db.query(MARK, [id, ORG_A]);
    expect(rowCount).toBe(0);
    // A late mark on a finished attempt would turn a PROVEN answer back into
    // an unprovable one, which is a downgrade in the other direction.
    expect((await row(id)).provider_call_state).toBe('called');
  });
});

// ── completion overwrites the mark with the proven answer ───────────────────

describe('A7 — completion is the only thing that resolves unknown', () => {
  it('unknown -> called when the process survived a real call', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-c1.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    await db.query(COMPLETE, [id, ORG_A, 'enriched', true, 'called']);
    const r = await row(id);
    expect(r.provider_call_state).toBe('called');
    expect(r.provider_called).toBe(true);
    expect(r.completed_at).not.toBeNull();
  });

  it('unknown -> not_called when the mark was written but transport was refused', async () => {
    // A4Q's `rethrowMarkFailure` path and the pre-transport refusals both close
    // this way: the process SURVIVED, so it knows, and `unknown` must not linger.
    const a = await newAccount(ORG_A, { domain: 'a7-c2.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    await db.query(COMPLETE, [id, ORG_A, null, false, 'not_called']);
    const r = await row(id);
    expect(r.provider_call_state).toBe('not_called');
    expect(r.completed_at).not.toBeNull();
    expect(safeToCall(r)).toBe(true);
  });

  it('a completed attempt leaves the live index, so the next one may open', async () => {
    // Closed while still holding `unknown`. The SHIPPED writer never does this
    // — `completeAttempt` derives `called|not_called` and A4Q's own suite
    // pins that — but the column permits it, and a future sweeper closing out
    // an unresolvable attempt is the only sane way to release the work item.
    // Asserted here so that the permission is a known property of the schema
    // rather than something discovered later by a sweeper author.
    const a = await newAccount(ORG_A, { domain: 'a7-c3.w6', source: 'a7' });
    const first = await openAttempt(ORG_A, a);
    await db.query(MARK, [first, ORG_A]);
    await db.query(COMPLETE, [first, ORG_A, null, false, 'unknown']);

    // The history is append-only: the unresolvable attempt is still readable.
    const second = await openAttempt(ORG_A, a, { n: 2 });
    expect((await row(first)).provider_call_state).toBe('unknown');
    expect((await row(second)).provider_call_state).toBe('not_called');
  });
});

// ── the failure-boundary matrix ─────────────────────────────────────────────

describe('A7 — what the committed row says at each failure boundary', () => {
  it('died before the attempt was created: no row, nothing spent, nothing to recover', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-b0.w6', source: 'a7' });
    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.prospect_enrichment_attempts
        WHERE organization_id=$1 AND account_id=$2`, [ORG_A, a]);
    expect(rows[0].n).toBe(0);
  });

  it('died after creation, before the mark: open, not_called, SAFE to retry', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-b1.w6', source: 'a7' });
    const r = await row(await openAttempt(ORG_A, a));
    expect(r.provider_call_state).toBe('not_called');
    expect(r.completed_at).toBeNull();
    expect(safeToCall(r)).toBe(true);
  });

  it('died after the mark, before transport: open, unknown, UNSAFE to retry', async () => {
    // Deliberately indistinguishable from the next case. The mark is written
    // before the risk is taken, so it over-reports exposure and never
    // under-reports it — which is the only direction that is safe to be wrong in.
    const a = await newAccount(ORG_A, { domain: 'a7-b2.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    const r = await row(id);
    expect(r.provider_call_state).toBe('unknown');
    expect(r.completed_at).toBeNull();
    expect(safeToCall(r)).toBe(false);
  });

  it('died during transport: open, unknown, UNSAFE to retry', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-b3.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    const r = await row(id);
    expect(r.provider_call_state).toBe('unknown');
    expect(safeToCall(r)).toBe(false);
  });

  it('died after the provider answered, before completion: open, unknown, UNSAFE', async () => {
    // The quota WAS spent. `provider_called` is still its insert-time false —
    // the flag that knew died with the process — and only the state is truthful.
    const a = await newAccount(ORG_A, { domain: 'a7-b4.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    const r = await row(id);
    expect(r.provider_call_state).toBe('unknown');
    expect(r.provider_called).toBe(false);              // stale, and not consulted
    expect(safeToCall(r)).toBe(false);
  });

  it('completion ran: closed, called, and no longer a candidate for recovery', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-b5.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    await db.query(COMPLETE, [id, ORG_A, 'enriched', true, 'called']);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, SET, CUTOFF(), 'recoverer']);
    expect(rowCount).toBe(0);
    expect((await row(id)).provider_call_state).toBe('called');
  });

  it('the two open deaths are separable ONLY by the state', async () => {
    const a1 = await newAccount(ORG_A, { domain: 'a7-sep1.w6', source: 'a7' });
    const a2 = await newAccount(ORG_A, { domain: 'a7-sep2.w6', source: 'a7' });
    const before = await row(await openAttempt(ORG_A, a1));          // died pre-mark
    const marked = await openAttempt(ORG_A, a2);
    await db.query(MARK, [marked, ORG_A]);
    const after = await row(marked);                                 // died post-mark

    expect(before.provider_called).toBe(after.provider_called);      // identical
    expect(before.outcome).toBe(after.outcome);                      // identical
    expect(before.completed_at).toBe(after.completed_at);            // identical
    expect(before.provider_call_state).not.toBe(after.provider_call_state);
  });
});

// ── unknown is never silently downgraded ────────────────────────────────────

describe('A7 — recovery moves ownership and nothing else', () => {
  it('an unleased abandoned unknown row is recovered, still unknown', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-r1.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);                          // NULL lease
    await db.query(MARK, [id, ORG_A]);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, SET, CUTOFF(), 'recoverer']);
    expect(rowCount).toBe(1);

    const r = await row(id);
    expect(r.provider_call_state).toBe('unknown');                   // NOT downgraded
    expect(r.claimed_by).toBe('recoverer');                          // ownership DID move
    expect(r.completed_at).toBeNull();
    expect(safeToCall(r)).toBe(false);
  });

  it('an expired-lease unknown row is recovered, still unknown', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-r2.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a, {
      lease: new Date(Date.now() - 60_000).toISOString(),
    });
    await db.query(MARK, [id, ORG_A]);
    const { rowCount } = await db.query(RECOVER,
      [ORG_A, a, PROVIDER, SET, CUTOFF(), 'recoverer']);
    expect(rowCount).toBe(1);
    expect((await row(id)).provider_call_state).toBe('unknown');
  });

  it('repeated recovery never wears it down', async () => {
    // The scenario a long-lived worker pool actually produces: a work item
    // abandoned, taken, abandoned again, taken again. If ANY hop reset the
    // state, the last holder would believe a call was never made.
    const a = await newAccount(ORG_A, { domain: 'a7-r3.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);

    for (const who of ['recoverer-1', 'recoverer-2', 'recoverer-3']) {
      // Expire the lease the previous hop took, so the next hop qualifies.
      await db.query(
        `UPDATE public.prospect_enrichment_attempts
            SET claimed_until = now() - interval '1 minute' WHERE id = $1`, [id]);
      const { rowCount } = await db.query(RECOVER, [ORG_A, a, PROVIDER, SET, CUTOFF(), who]);
      expect(rowCount).toBe(1);
      expect((await row(id)).provider_call_state).toBe('unknown');
    }
    expect((await row(id)).claimed_by).toBe('recoverer-3');
  });

  it('the whole record except ownership survives recovery', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-r4.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a, { n: 4 });
    await db.query(MARK, [id, ORG_A]);
    await db.query(RECOVER, [ORG_A, a, PROVIDER, SET, CUTOFF(), 'recoverer']);

    const r = await row(id);
    expect(r.provider_call_state).toBe('unknown');
    expect(r.provider_called).toBe(false);
    expect(r.outcome).toBeNull();
    expect(r.requested_attributes).toEqual(['employee_count']);
    expect(r.correlation_id).toBe('corr-a7');
    expect(r.attempt_number).toBe(4);
  });

  it('another tenant cannot recover it, and therefore cannot touch its state', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-r5.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    const { rowCount } = await db.query(RECOVER,
      [ORG_B, a, PROVIDER, SET, CUTOFF(), 'other-tenant']);
    expect(rowCount).toBe(0);
    expect((await row(id)).claimed_by).toBe('worker-1');
  });
});

// ── abandoned work cannot become a duplicate call ───────────────────────────

describe('A7 — an abandoned unknown attempt cannot produce an unsafe duplicate', () => {
  it('the live index refuses a second open attempt while the unknown row stands', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-d1.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);
    // A worker that ignored recovery and simply opened a new attempt is stopped
    // by the arbiter, not by anybody's good judgement.
    await expect(openAttempt(ORG_A, a, { n: 2 })).rejects.toMatchObject({ code: '23505' });
  });

  it('recovery yields exactly one holder, and that holder reads unknown', async () => {
    const a = await newAccount(ORG_A, { domain: 'a7-d2.w6', source: 'a7' });
    const id = await openAttempt(ORG_A, a);
    await db.query(MARK, [id, ORG_A]);

    const first = await db.query(RECOVER, [ORG_A, a, PROVIDER, SET, CUTOFF(), 'worker-A']);
    const second = await db.query(RECOVER, [ORG_A, a, PROVIDER, SET, CUTOFF(), 'worker-B']);
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);                    // A's lease is now in the future

    const r = await row(id);
    expect(r.claimed_by).toBe('worker-A');
    expect(safeToCall(r)).toBe(false);                  // and A is told: do not call
  });

  it('the ambiguity is never erased — closing it out preserves the evidence', async () => {
    // The only way past an `unknown` attempt is a deliberate policy decision.
    // Whatever it decides, the unresolvable attempt stays in the history, so
    // "how many calls might this tenant have been billed for" is still answerable.
    const a = await newAccount(ORG_A, { domain: 'a7-d3.w6', source: 'a7' });
    const abandoned = await openAttempt(ORG_A, a);
    await db.query(MARK, [abandoned, ORG_A]);
    await db.query(COMPLETE, [abandoned, ORG_A, null, false, 'unknown']);

    const next = await openAttempt(ORG_A, a, { n: 2 });
    expect((await row(abandoned)).provider_call_state).toBe('unknown');
    expect((await row(next)).provider_call_state).toBe('not_called');

    const { rows } = await db.query(
      `SELECT count(*)::int n FROM public.prospect_enrichment_attempts
        WHERE organization_id=$1 AND account_id=$2 AND provider_call_state='unknown'`,
      [ORG_A, a]);
    expect(rows[0].n).toBe(1);
  });

  it('the reclaimer read finds exactly the unresolvable live attempts, per tenant', async () => {
    const a1 = await newAccount(ORG_A, { domain: 'a7-d4.w6', source: 'a7' });
    const a2 = await newAccount(ORG_A, { domain: 'a7-d5.w6', source: 'a7' });
    const b1 = await newAccount(ORG_B, { domain: 'a7-d6.w6', source: 'a7' });

    const unresolvable = await openAttempt(ORG_A, a1);
    await db.query(MARK, [unresolvable, ORG_A]);
    await openAttempt(ORG_A, a2);                                    // still not_called
    const otherTenant = await openAttempt(ORG_B, b1);
    await db.query(MARK, [otherTenant, ORG_B]);

    const { rows } = await db.query(
      `SELECT id FROM public.prospect_enrichment_attempts
        WHERE organization_id = $1 AND provider_call_state = 'unknown'
          AND completed_at IS NULL`, [ORG_A]);
    expect(rows.map((r) => r.id)).toEqual([unresolvable]);
  });
});
