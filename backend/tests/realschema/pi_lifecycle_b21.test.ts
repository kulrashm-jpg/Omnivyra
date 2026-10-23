/**
 * PI-C1 Phase 1 — opportunity lifecycle reads, transition refusal, the
 * append-only guards, and SQLSTATE classification, against real PostgreSQL.
 *
 * WHY THIS SUITE EXISTS. Phase 1 changed three behaviours whose correctness
 * lives in the database, not in the application:
 *
 *   • `transitionLifecycle` used to substitute `detected` when an opportunity
 *     had no lifecycle history, so an opportunity of UNDETERMINED state was
 *     indistinguishable from a brand-new one. The pipeline's lifecycle init is
 *     best-effort and its failure is swallowed, so that was reachable.
 *   • The two append-only guards raise DIFFERENT SQLSTATEs — `P0001` on
 *     `opportunity_lifecycle_states`, `42501` on
 *     `prospect_lifecycle_transitions` — and `42501` is
 *     `insufficient_privilege`, which this repository also uses for genuine
 *     permission denials.
 *   • Lifecycle evidence must survive a refused mutation.
 *
 * None of that can be proven against a mock: a mock cannot raise a trigger's
 * SQLSTATE, cannot enforce a privilege boundary, and cannot refuse a cascade.
 * Every classification assertion below is fed a REAL PostgreSQL error object.
 *
 * WHAT IS REAL. The decision logic is the product's own —
 * `readCurrentLifecycleState`, `transitionLifecycle`,
 * `initialiseLifecycleForOpportunity`, `isResolvedForAccountDeletion` and
 * `classifyLifecycleGuardError` all execute from their shipped modules.
 * Nothing about lifecycle decisions is reimplemented here.
 *
 * THE ONE SEAM. The lifecycle service reaches the database through
 * `ownedDbTable`, which speaks the Supabase/PostgREST builder dialect over
 * HTTP. A `pg` client cannot answer that, so the seam is replaced with a
 * translator that turns the exact builder shapes this service issues into real
 * SQL on this suite's real client — the same technique as
 * `pl_prospect_lists.test.ts` and `dl_relationship_decisions.test.ts`. Each
 * statement gets its own SAVEPOINT because in production each `ownedDbTable`
 * call is its own request, so one refusal must not poison the next; inside
 * `inRollback`'s single transaction it otherwise would.
 */

import { db, inRollback, seedTenants, newLead, ORG_A, ORG_B } from './setup';

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as {
      db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
    };
    type Filter = { col: string; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert',
      cols: '*',
      payload: null as Record<string, unknown> | null,
      filters: [] as Filter[],
      order: null as { col: string; asc: boolean } | null,
      limit: null as number | null,
    };
    let sp = 0;

    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      return ` WHERE ${st.filters.map((f) => { params.push(f.val); return `"${f.col}" = $${params.length}`; }).join(' AND ')}`;
    };

    const run = async (sql: string, params: unknown[]) => {
      const name = `lc_sp_${++sp}_${Math.random().toString(36).slice(2, 8)}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const res = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return { rows: res.rows, error: null as null | { code: string; message: string } };
      } catch (e: unknown) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return {
          rows: [] as Array<Record<string, unknown>>,
          error: {
            code: String((e as { code?: unknown })?.code ?? 'unknown'),
            message: String((e as { message?: unknown })?.message ?? 'unknown'),
          },
        };
      }
    };

    const normalize = (row: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
      return out;
    };

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<Record<string, unknown>> => {
      const params: unknown[] = [];
      if (st.op === 'insert') {
        const payload = st.payload ?? {};
        const keys = Object.keys(payload);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => { params.push(payload[k]); return `$${params.length}`; }).join(', ');
        const r = await run(`INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING *`, params);
        if (r.error) return { data: null, error: r.error };
        return { data: normalize(r.rows[0] ?? {}), error: null };
      }
      const clause = where(params);
      const cols = st.cols === '*' ? '*' : st.cols.split(',').map((c) => `"${c.trim()}"`).join(', ');
      const order = st.order ? ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}` : '';
      const limit = st.limit != null ? ` LIMIT ${st.limit}` : (mode === 'many' ? '' : ' LIMIT 1');
      const r = await run(`SELECT ${cols} FROM public."${table}"${clause}${order}${limit}`, params);
      if (r.error) return { data: null, error: r.error };
      const rows = r.rows.map(normalize);
      if (mode === 'many') return { data: rows, error: null };
      return { data: rows[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string) => { if (typeof cols === 'string' && st.op === 'select') st.cols = cols; return b; },
      insert: (p: Record<string, unknown>) => { st.op = 'insert'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ col: c, val: v }); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order = { col: c, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import {
  readCurrentLifecycleState,
  transitionLifecycle,
  initialiseLifecycleForOpportunity,
  isResolvedForAccountDeletion,
  LifecycleEvidenceUnavailableError,
} from '../../services/opportunityLifecycleService';
import {
  classifyLifecycleGuardError,
  isAuthorizationRefusal,
} from '../../services/lifecycleGuardErrors';

// ---------------------------------------------------------------------------
// Isolation guard. `setup.ts` refuses a managed host; this suite mutates and
// provokes guard refusals, so it additionally pins the target to loopback.
// ---------------------------------------------------------------------------
const DB_URL = process.env.W6_DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error(
    'pi_lifecycle_b21 refuses a non-loopback W6_DB_URL: it mutates rows and provokes trigger '
    + `refusals, so it runs only against a disposable database on 127.0.0.1. Got: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`,
  );
}

const L = {
  sigA: 'c1fec1fe-0000-4000-8000-000000000011',
  sigB: 'c1fec1fe-0000-4000-8000-000000000012',
  feedA: 'c1fec1fe-0000-4000-8000-000000000021',
  feedB: 'c1fec1fe-0000-4000-8000-000000000022',
};
const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function signal(id: string, org: string, srcId: string): Promise<void> {
  await q(
    `INSERT INTO public.lead_signals
       (id, organization_id, source_type, source_id, platform, detected_at, migration_source)
     VALUES ($1, $2, 'listening', $3, 'reddit', now(), 'pi-lifecycle-b21')`,
    [id, org, srcId],
  );
}

async function feed(id: string, org: string, signalId: string): Promise<void> {
  await q(
    `INSERT INTO public.opportunity_feed_items
       (id, organization_id, signal_id, opportunity_type, detected_reason, platform)
     VALUES ($1, $2, $3, 'buying_intent', 'pi-lifecycle-b21', 'reddit')`,
    [id, org, signalId],
  );
}

/** An opportunity with no lifecycle history yet. */
async function opportunity(org: string, sigId: string, feedId: string, srcId: string): Promise<void> {
  await signal(sigId, org, srcId);
  await feed(feedId, org, sigId);
}

/** Captures the real pg error a statement raises, or null when it succeeds. */
async function capture(sql: string, params: unknown[] = []): Promise<{ code: string; message: string } | null> {
  const name = `cap_${Math.random().toString(36).slice(2, 8)}`;
  await q(`SAVEPOINT ${name}`);
  try {
    await q(sql, params);
    await q(`RELEASE SAVEPOINT ${name}`);
    return null;
  } catch (e: unknown) {
    await q(`ROLLBACK TO SAVEPOINT ${name}`);
    return {
      code: String((e as { code?: unknown })?.code ?? 'unknown'),
      message: String((e as { message?: unknown })?.message ?? 'unknown'),
    };
  }
}

const lifecycleCount = async (feedId: string): Promise<number> =>
  Number((await q(
    `SELECT count(*)::int AS c FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`,
    [feedId],
  )).rows[0].c);

const scenario = <T>(body: () => Promise<T>): Promise<T> =>
  inRollback(async () => { await seedTenants(); return body(); });

/**
 * A role with only the grants a scenario needs.
 *
 * The suite connects as a SUPERUSER, which bypasses every privilege check, so a
 * permission failure is unobtainable without switching role. RLS is enabled on
 * these tables, so a role with no policy would read ZERO ROWS rather than
 * raise — silently turning a permission test into an empty-result test.
 * BYPASSRLS removes that confound and matches production, where the service
 * role bypasses row-level security, so the privilege boundary is the one that
 * actually governs these reads. No RLS policy is created or modified.
 */
async function asRestricted(grants: string[]): Promise<void> {
  await q(`CREATE ROLE lc_restricted NOLOGIN NOINHERIT BYPASSRLS`);
  await q(`GRANT USAGE ON SCHEMA public TO lc_restricted`);
  for (const g of grants) await q(g);
  await q(`SET LOCAL ROLE lc_restricted`);
}

describe('context — the guards and roles these tests depend on', () => {
  it('both append-only triggers exist on the opportunity ledger, BEFORE and row-level', async () => {
    const { rows } = await q(
      `SELECT tgname, (tgtype & 2) <> 0 AS before, (tgtype & 1) <> 0 AS row_level, tgenabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'opportunity_lifecycle_states' AND NOT t.tgisinternal`,
    );
    const names = rows.map((r) => r.tgname).sort();
    expect(names).toEqual(['opp_lifecycle_block_delete', 'opp_lifecycle_block_update']);
    for (const r of rows) {
      expect(r.before).toBe(true);
      expect(r.row_level).toBe(true);
      expect(r.tgenabled).toBe('O');
    }
  });

  it('the effective role is a superuser, which is why the privilege scenarios switch role', async () => {
    const { rows } = await q(
      `SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super`,
    );
    expect(rows[0].super).toBe(true);
  });

  it('RLS is enabled on both lifecycle tables', async () => {
    const { rows } = await q(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('opportunity_lifecycle_states','prospect_lifecycle_transitions')`,
    );
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.relrowsecurity).toBe(true);
  });
});

describe('L1 — valid initial lifecycle history through the supported path', () => {
  it('reads back the initial state and fabricates nothing', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      expect(await lifecycleCount(L.feedA)).toBe(0);

      const created = await initialiseLifecycleForOpportunity({
        organizationId: ORG_A, opportunityFeedItemId: L.feedA,
      });
      expect(created?.state).toBe('detected');

      const read = await readCurrentLifecycleState(ORG_A, L.feedA);
      expect(read).toMatchObject({ kind: 'present', state: 'detected', isInitial: true });

      // Exactly one row, with no predecessor: nothing extra was invented.
      expect(await lifecycleCount(L.feedA)).toBe(1);
      const { rows } = await q(
        `SELECT state, previous_state, is_initial, organization_id
           FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`,
        [L.feedA],
      );
      expect(rows[0]).toMatchObject({
        state: 'detected', previous_state: null, is_initial: true, organization_id: ORG_A,
      });
    });
  });

  it('initialisation is idempotent and does not add a second initial row', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });
      expect(await lifecycleCount(L.feedA)).toBe(1);
    });
  });

  it('an initial `detected` state does not resolve an account-deletion block', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });
      const read = await readCurrentLifecycleState(ORG_A, L.feedA);
      expect(isResolvedForAccountDeletion(read)).toBe(false);
    });
  });
});

describe('L2 — missing history for an existing opportunity', () => {
  it('reads as `missing`, never as a valid initial state', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      const read = await readCurrentLifecycleState(ORG_A, L.feedA);
      expect(read).toEqual({ kind: 'missing' });
      expect(read).not.toMatchObject({ state: 'detected' });
      expect(isResolvedForAccountDeletion(read)).toBe(false);
    });
  });

  it('a transition is refused with the distinct missing-history error and writes nothing', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');

      await expect(transitionLifecycle({
        organizationId: ORG_A, opportunityFeedItemId: L.feedA,
        to: 'triaged', actorUserId: null, reasoning: null,
      })).rejects.toBeInstanceOf(LifecycleEvidenceUnavailableError);

      // The refusal must not have created the history it was missing.
      expect(await lifecycleCount(L.feedA)).toBe(0);
    });
  });

  it('the refusal carries reason `missing`', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await expect(transitionLifecycle({
        organizationId: ORG_A, opportunityFeedItemId: L.feedA,
        to: 'triaged', actorUserId: null, reasoning: null,
      })).rejects.toMatchObject({ reason: 'missing' });
    });
  });
});

/**
 * The initial row as the pipeline would really have left it: written in an
 * EARLIER transaction, so its `transitioned_at` precedes any later transition.
 *
 * This matters because `now()` is constant within a transaction, and
 * `inRollback` puts a whole scenario in one. Seeding the initial row with an
 * explicit earlier timestamp reproduces production ordering instead of
 * creating a tie that does not occur there. The tie itself is a real
 * fragility, measured separately in L3b — it is not papered over here.
 */
async function seedInitialEarlier(org: string, feedId: string): Promise<void> {
  await q(
    `INSERT INTO public.opportunity_lifecycle_states
       (organization_id, opportunity_feed_item_id, state, previous_state, is_initial,
        reasoning, transitioned_at)
     VALUES ($1, $2, 'detected', NULL, TRUE, 'auto_init_from_signal_pipeline',
             now() - interval '1 hour')`,
    [org, feedId],
  );
}

describe('L3 — a valid subsequent transition', () => {
  it('appends history, attributes the tenant, and leaves the earlier row intact', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await seedInitialEarlier(ORG_A, L.feedA);

      const record = await transitionLifecycle({
        organizationId: ORG_A, opportunityFeedItemId: L.feedA,
        to: 'triaged', actorUserId: null, reasoning: 'lc test',
      });
      expect(record).toMatchObject({ state: 'triaged', previous_state: 'detected', organization_id: ORG_A });

      // Append-only in practice: two rows, the initial one unchanged.
      expect(await lifecycleCount(L.feedA)).toBe(2);
      const { rows } = await q(
        `SELECT state, previous_state, is_initial FROM public.opportunity_lifecycle_states
          WHERE opportunity_feed_item_id = $1 ORDER BY transitioned_at ASC`,
        [L.feedA],
      );
      expect(rows[0]).toMatchObject({ state: 'detected', previous_state: null, is_initial: true });
      expect(rows[1]).toMatchObject({ state: 'triaged', previous_state: 'detected', is_initial: false });

      const read = await readCurrentLifecycleState(ORG_A, L.feedA);
      expect(read).toMatchObject({ kind: 'present', state: 'triaged', isInitial: false });
    });
  });

  it('an `archived` state resolves the account-deletion block, and nothing else does', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await seedInitialEarlier(ORG_A, L.feedA);
      await transitionLifecycle({
        organizationId: ORG_A, opportunityFeedItemId: L.feedA,
        to: 'archived', actorUserId: null, reasoning: null,
      });
      const read = await readCurrentLifecycleState(ORG_A, L.feedA);
      expect(read).toMatchObject({ kind: 'present', state: 'archived' });
      expect(isResolvedForAccountDeletion(read)).toBe(true);
    });
  });
});

/**
 * L3b — a measured fragility, recorded so it cannot be forgotten.
 *
 * `readCurrentLifecycleState` derives the current state from
 * `ORDER BY transitioned_at DESC LIMIT 1`, and the migration says so in as
 * many words. But `transitioned_at` defaults to `now()`, which is the
 * TRANSACTION timestamp, and the table has no sequence or identity column to
 * break a tie — its primary key is a random uuid. So when two rows share a
 * `transitioned_at` the "current" state is not uniquely determined.
 *
 * This was found by this suite: under `inRollback` two transitions land in one
 * transaction, share `now()`, and the read returned the INITIAL row rather than
 * the latest. In production each `ownedDbTable` call is its own transaction, so
 * the timestamps normally differ and the defect is LATENT rather than active —
 * but any path that performs two transitions in one transaction would hit it
 * deterministically.
 *
 * The PI sibling ledger, `prospect_lifecycle_transitions`, has exactly the
 * tiebreaker this table lacks: `seq bigint GENERATED ALWAYS AS IDENTITY`, with
 * current state defined as the greatest `seq`.
 *
 * These tests assert the STRUCTURAL facts, not the buggy outcome, so they stay
 * true until the gap is closed — and start failing the moment it is, which is
 * the signal to revisit them. Fixing it needs a schema change and is therefore
 * out of scope here.
 */
describe('L3b — current-state ordering has no tiebreaker (measured finding)', () => {
  it('the Community ledger has no identity/sequence column, while the PI ledger does', async () => {
    const { rows } = await q(
      `SELECT table_name, count(*) FILTER (WHERE is_identity = 'YES')::int AS identity_cols
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('opportunity_lifecycle_states','prospect_lifecycle_transitions')
        GROUP BY table_name ORDER BY table_name`,
    );
    const byTable = Object.fromEntries(rows.map((r) => [r.table_name, Number(r.identity_cols)]));
    expect(byTable['opportunity_lifecycle_states']).toBe(0);
    expect(byTable['prospect_lifecycle_transitions']).toBeGreaterThan(0);
  });

  it('`now()` is constant within a transaction, so same-transaction rows tie', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await q(
        `INSERT INTO public.opportunity_lifecycle_states
           (organization_id, opportunity_feed_item_id, state, previous_state, is_initial)
         VALUES ($1, $2, 'detected', NULL, TRUE), ($1, $2, 'triaged', 'detected', FALSE)`,
        [ORG_A, L.feedA],
      );
      const { rows } = await q(
        `SELECT count(DISTINCT transitioned_at)::int AS distinct_ts, count(*)::int AS total
           FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`,
        [L.feedA],
      );
      expect(rows[0].total).toBe(2);
      expect(rows[0].distinct_ts).toBe(1);
    });
  });

  it('with a tie, ORDER BY transitioned_at DESC does not determine a single row', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await q(
        `INSERT INTO public.opportunity_lifecycle_states
           (organization_id, opportunity_feed_item_id, state, previous_state, is_initial)
         VALUES ($1, $2, 'detected', NULL, TRUE), ($1, $2, 'triaged', 'detected', FALSE)`,
        [ORG_A, L.feedA],
      );
      // Two secondary orderings over the same primary ordering return different
      // rows, which is what "not a total order" means. This asserts the
      // ambiguity, not whichever row the service happens to receive.
      const asc = await q(
        `SELECT state FROM public.opportunity_lifecycle_states
          WHERE opportunity_feed_item_id = $1 ORDER BY transitioned_at DESC, state ASC LIMIT 1`,
        [L.feedA],
      );
      const desc = await q(
        `SELECT state FROM public.opportunity_lifecycle_states
          WHERE opportunity_feed_item_id = $1 ORDER BY transitioned_at DESC, state DESC LIMIT 1`,
        [L.feedA],
      );
      expect(asc.rows[0].state).not.toBe(desc.rows[0].state);
    });
  });
});

describe('L4 — the database refuses an UPDATE of lifecycle history', () => {
  it('raises P0001 with the append-only marker and leaves the row unchanged', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });

      const err = await capture(
        `UPDATE public.opportunity_lifecycle_states SET state = 'archived'
          WHERE opportunity_feed_item_id = $1`,
        [L.feedA],
      );
      expect(err).not.toBeNull();
      expect(err?.code).toBe('P0001');
      expect(err?.message).toMatch(/append-only/i);

      const { rows } = await q(
        `SELECT state FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`,
        [L.feedA],
      );
      expect(rows[0].state).toBe('detected');
    });
  });
});

describe('L5 — the database refuses a DELETE of lifecycle history', () => {
  it('raises P0001 with the marker and the evidence survives', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });

      const err = await capture(
        `DELETE FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`,
        [L.feedA],
      );
      expect(err?.code).toBe('P0001');
      expect(err?.message).toMatch(/append-only/i);
      expect(await lifecycleCount(L.feedA)).toBe(1);
    });
  });
});

describe('L6 — parent deletion when lifecycle evidence exists (measured, not assumed)', () => {
  it('the parent delete is refused and both rows survive', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });

      // The FK is declared ON DELETE CASCADE; the measurement is what the
      // guard does when that cascade fires, not what the FK says.
      const { rows: fk } = await q(
        `SELECT confdeltype FROM pg_constraint
          WHERE conname = 'opportunity_lifecycle_states_opportunity_feed_item_id_fkey'`,
      );
      expect(fk[0].confdeltype).toBe('c');

      const err = await capture(
        `DELETE FROM public.opportunity_feed_items WHERE id = $1`, [L.feedA],
      );
      expect(err).not.toBeNull();
      expect(err?.code).toBe('P0001');
      expect(err?.message).toMatch(/append-only/i);

      const parent = await q(`SELECT 1 FROM public.opportunity_feed_items WHERE id = $1`, [L.feedA]);
      expect(parent.rows).toHaveLength(1);
      expect(await lifecycleCount(L.feedA)).toBe(1);
    });
  });

  it('a parent with no lifecycle evidence deletes cleanly, which bounds the refusal', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      const err = await capture(
        `DELETE FROM public.opportunity_feed_items WHERE id = $1`, [L.feedA],
      );
      expect(err).toBeNull();
      const parent = await q(`SELECT 1 FROM public.opportunity_feed_items WHERE id = $1`, [L.feedA]);
      expect(parent.rows).toHaveLength(0);
    });
  });
});

describe('L7 — the product classifier against a real P0001', () => {
  it('classifies a real guard refusal as an append-only violation', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });

      const err = await capture(
        `DELETE FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`,
        [L.feedA],
      );
      // The REAL error object, straight from PostgreSQL, into the product.
      const refusal = classifyLifecycleGuardError(err);
      expect(refusal).toMatchObject({ kind: 'append_only_violation', sqlstate: 'P0001' });
      expect(isAuthorizationRefusal(err)).toBe(false);
    });
  });

  it('a real P0001 WITHOUT the marker is not treated as a guard refusal', async () => {
    await scenario(async () => {
      // P0001 is plpgsql's default for any RAISE EXCEPTION, so the code alone
      // cannot be the test. This is an unrelated raise, not a schema change.
      const err = await capture(`DO $$ BEGIN RAISE EXCEPTION 'unrelated business rule failed'; END $$`);
      expect(err?.code).toBe('P0001');
      expect(classifyLifecycleGuardError(err)).toBeNull();
      expect(isAuthorizationRefusal(err)).toBe(false);
    });
  });
});

describe('L8 — the product classifier against a real 42501', () => {
  it('a MARKED 42501 from the PI ledger guard is an append-only violation', async () => {
    await scenario(async () => {
      const prospect = await newLead(ORG_A, { source: 'pi-lifecycle-b21' });
      await q(
        `INSERT INTO public.prospect_lifecycle_transitions
           (organization_id, prospect_id, state, previous_state, is_initial, origin, evidence_kind)
         VALUES ($1, $2, 'identified', NULL, TRUE, 'derived', 'icp_evaluation')`,
        [ORG_A, prospect],
      );

      const err = await capture(
        `UPDATE public.prospect_lifecycle_transitions SET state = 'qualified' WHERE prospect_id = $1`,
        [prospect],
      );
      expect(err?.code).toBe('42501');
      expect(err?.message).toMatch(/append-only/i);

      const refusal = classifyLifecycleGuardError(err);
      expect(refusal).toMatchObject({ kind: 'append_only_violation', sqlstate: '42501' });
      // An append-only refusal is NOT an authorization failure.
      expect(isAuthorizationRefusal(err)).toBe(false);

      const { rows } = await q(
        `SELECT state FROM public.prospect_lifecycle_transitions WHERE prospect_id = $1`, [prospect],
      );
      expect(rows[0].state).toBe('identified');
    });
  });

  it('an UNMARKED 42501 from a real privilege boundary stays a permission error', async () => {
    await scenario(async () => {
      await asRestricted([]); // no privilege on the lifecycle table
      const err = await capture(`SELECT 1 FROM public.opportunity_lifecycle_states LIMIT 1`);
      await q('RESET ROLE');

      expect(err?.code).toBe('42501');
      expect(err?.message).toMatch(/permission denied/i);
      expect(err?.message).not.toMatch(/append-only/i);

      // The two conditions must stay apart in both directions.
      expect(classifyLifecycleGuardError(err)).toBeNull();
      expect(isAuthorizationRefusal(err)).toBe(true);
    });
  });

  it('the two guards raise different SQLSTATEs, which is why the classifier needs both', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });
      const community = await capture(
        `DELETE FROM public.opportunity_lifecycle_states WHERE opportunity_feed_item_id = $1`, [L.feedA],
      );

      const prospect = await newLead(ORG_A, { source: 'pi-lifecycle-b21' });
      await q(
        `INSERT INTO public.prospect_lifecycle_transitions
           (organization_id, prospect_id, state, previous_state, is_initial, origin, evidence_kind)
         VALUES ($1, $2, 'identified', NULL, TRUE, 'derived', 'icp_evaluation')`,
        [ORG_A, prospect],
      );
      const pi = await capture(
        `DELETE FROM public.prospect_lifecycle_transitions WHERE prospect_id = $1`, [prospect],
      );

      expect(community?.code).toBe('P0001');
      expect(pi?.code).toBe('42501');
      expect(community?.code).not.toBe(pi?.code);
      // Both must nevertheless reach the same application class.
      expect(classifyLifecycleGuardError(community)?.kind).toBe('append_only_violation');
      expect(classifyLifecycleGuardError(pi)?.kind).toBe('append_only_violation');
    });
  });
});

describe('L10 — tenant isolation at the lifecycle boundary', () => {
  it('a read for one tenant cannot see another tenant\'s history', async () => {
    await scenario(async () => {
      await opportunity(ORG_B, L.sigB, L.feedB, 'lc-b');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_B, opportunityFeedItemId: L.feedB });

      expect(await readCurrentLifecycleState(ORG_B, L.feedB)).toMatchObject({ kind: 'present' });
      // Same opportunity id, wrong tenant.
      expect(await readCurrentLifecycleState(ORG_A, L.feedB)).toEqual({ kind: 'missing' });
    });
  });

  it('a transition under the wrong tenant is refused and writes nothing', async () => {
    await scenario(async () => {
      await opportunity(ORG_B, L.sigB, L.feedB, 'lc-b');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_B, opportunityFeedItemId: L.feedB });
      const before = await lifecycleCount(L.feedB);

      await expect(transitionLifecycle({
        organizationId: ORG_A, opportunityFeedItemId: L.feedB,
        to: 'triaged', actorUserId: null, reasoning: null,
      })).rejects.toBeInstanceOf(LifecycleEvidenceUnavailableError);

      expect(await lifecycleCount(L.feedB)).toBe(before);
    });
  });

  it('measures whether the schema itself prevents a cross-tenant lifecycle citation', async () => {
    await scenario(async () => {
      await opportunity(ORG_B, L.sigB, L.feedB, 'lc-b');

      // Measured, not assumed: `opportunity_lifecycle_states` carries SEPARATE
      // foreign keys to companies and to opportunity_feed_items, with no
      // composite (feed_item, organization) key, so the database alone may not
      // forbid a row that cites another tenant's opportunity. Whatever the
      // outcome, it is recorded rather than presumed.
      const err = await capture(
        `INSERT INTO public.opportunity_lifecycle_states
           (organization_id, opportunity_feed_item_id, state, is_initial)
         VALUES ($1, $2, 'detected', TRUE)`,
        [ORG_A, L.feedB],
      );
      const composite = await q(
        `SELECT count(*)::int AS c FROM pg_constraint c
           JOIN pg_class cl ON cl.oid = c.conrelid
          WHERE cl.relname = 'opportunity_lifecycle_states' AND c.contype = 'f'
            AND array_length(c.conkey, 1) > 1`,
      );

      // The finding either way: no composite tenant foreign key exists, so the
      // insert is NOT refused by the schema. Tenant correctness at this
      // boundary rests on the application predicate, which the two tests above
      // exercise. If a composite key is ever added, this expectation changes
      // and the test will say so.
      expect(Number(composite.rows[0].c)).toBe(0);
      expect(err).toBeNull();
    });
  });
});

describe('L11 — a genuine lifecycle read failure fails closed', () => {
  it('reads as unreadable/read_failed, never as a valid initial state', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });
      await asRestricted([]); // no SELECT on opportunity_lifecycle_states

      const read = await readCurrentLifecycleState(ORG_A, L.feedA);
      await q('RESET ROLE');

      expect(read).toMatchObject({ kind: 'unreadable', reason: 'read_failed' });
      expect(read.kind).not.toBe('missing');
      expect(isResolvedForAccountDeletion(read)).toBe(false);
    });
  });

  it('a transition over an unreadable history is refused and writes nothing', async () => {
    await scenario(async () => {
      await opportunity(ORG_A, L.sigA, L.feedA, 'lc-a');
      await initialiseLifecycleForOpportunity({ organizationId: ORG_A, opportunityFeedItemId: L.feedA });
      // SELECT is refused, but INSERT is granted: if the service ever wrote
      // before establishing state, this is where it would show.
      await asRestricted([`GRANT INSERT ON public.opportunity_lifecycle_states TO lc_restricted`]);

      let thrown: unknown = null;
      try {
        await transitionLifecycle({
          organizationId: ORG_A, opportunityFeedItemId: L.feedA,
          to: 'triaged', actorUserId: null, reasoning: null,
        });
      } catch (e) { thrown = e; }
      await q('RESET ROLE');

      expect(thrown).toBeInstanceOf(LifecycleEvidenceUnavailableError);
      expect(thrown).toMatchObject({ reason: 'read_failed' });
      expect(await lifecycleCount(L.feedA)).toBe(1);
    });
  });
});
