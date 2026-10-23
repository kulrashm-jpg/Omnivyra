/**
 * PI-C1 Phase 1 — retention pre-exclusion, tenant-scoped deletes and
 * fail-closed reads, against real PostgreSQL.
 *
 * WHY THIS SUITE EXISTS. Three defects were found and fixed in the retention
 * service, and every one of them was INVISIBLE to a mock:
 *
 *   • A delete batch holding one append-only-protected row deleted NOTHING,
 *     because the parent delete cascades onto `opportunity_lifecycle_states`
 *     and that table's BEFORE DELETE trigger refuses the whole statement. The
 *     next run selected the same batch, so eligible rows stayed blocked.
 *   • Both DELETE paths ran without an `organization_id` predicate (F-1).
 *   • The scan-count and candidate-select reads discarded their error, so a
 *     failed read was stored as a `completed` run with zero rows — identical
 *     to "there was nothing to do" (F-2).
 *
 * The properties that catch regressions here cannot be mocked: a real trigger
 * refusing a real cascade, a real privilege boundary refusing a real read, and
 * a real affected-row count. A mock would happily accept all three.
 *
 * WHAT IS REAL. The decision logic under test is the product's own
 * `runRetentionPolicy`. Pre-exclusion, tenant predicates, per-item
 * attribution, the short-count branch, status derivation and the fail-closed
 * reads all execute from `backend/services/retentionService.ts`. No retention
 * algorithm is reimplemented below.
 *
 * THE ONE SEAM. `ownedDbTable` is replaced with a translator that turns the
 * exact builder shapes the service issues into real SQL on this suite's real
 * `pg` client — the same seam and the same technique as
 * `pl_prospect_lists.test.ts` and `dl_relationship_decisions.test.ts`. In
 * production each `ownedDbTable` call is its own PostgREST request and so its
 * own transaction, which is why every statement below is wrapped in a
 * SAVEPOINT: inside `inRollback`'s single transaction a raised trigger would
 * otherwise abort everything after it. That reproduces production's
 * statement-per-call isolation rather than inventing something laxer.
 */

import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';

/**
 * Harness controls. Read by the translator, never by the product.
 *
 * `beforeBatchDelete` exists only for the short-count scenario: PostgreSQL
 * will not spontaneously report fewer affected rows than were submitted, so
 * the race has to be interleaved deliberately. See R5.
 */
const harness: {
  beforeBatchDelete: null | (() => Promise<void>);
  log: Array<{ table: string; sql: string; params: unknown[]; error: string | null }>;
} = { beforeBatchDelete: null, log: [] };

(global as unknown as { __retHarness: typeof harness }).__retHarness = harness;

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const { db: client } = require('./setup') as {
      db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
    };
    const h = (global as unknown as { __retHarness: typeof harness }).__retHarness;

    type Filter = { col: string; op: 'eq' | 'in' | 'lt'; val: unknown };
    const st = {
      op: 'select' as 'select' | 'insert' | 'delete',
      cols: '*',
      head: false,
      payload: null as Record<string, unknown> | null,
      filters: [] as Filter[],
      order: null as { col: string; asc: boolean } | null,
      limit: null as number | null,
    };
    let savepoint = 0;

    const where = (params: unknown[]): string => {
      if (st.filters.length === 0) return '';
      const parts = st.filters.map((f) => {
        params.push(f.val);
        if (f.op === 'eq') return `"${f.col}" = $${params.length}`;
        if (f.op === 'lt') return `"${f.col}" < $${params.length}`;
        return `"${f.col}" = ANY($${params.length})`;
      });
      return ` WHERE ${parts.join(' AND ')}`;
    };

    const run = async (sql: string, params: unknown[]) => {
      const sp = `ret_sp_${++savepoint}_${Math.random().toString(36).slice(2, 8)}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const res = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        h.log.push({ table, sql, params, error: null });
        return { rows: res.rows, error: null as null | { code: string; message: string } };
      } catch (e: unknown) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        const err = {
          code: String((e as { code?: unknown })?.code ?? 'unknown'),
          message: String((e as { message?: unknown })?.message ?? 'unknown'),
        };
        h.log.push({ table, sql, params, error: `${err.code}:${err.message}` });
        return { rows: [] as Array<Record<string, unknown>>, error: err };
      }
    };

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<Record<string, unknown>> => {
      const params: unknown[] = [];

      if (st.op === 'insert') {
        const payload = st.payload ?? {};
        const keys = Object.keys(payload);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const vals = keys.map((k) => { params.push(payload[k]); return `$${params.length}`; }).join(', ');
        const r = await run(`INSERT INTO public."${table}" (${cols}) VALUES (${vals}) RETURNING *`, params);
        if (r.error) return { data: null, count: null, error: r.error };
        return { data: r.rows[0] ?? null, count: 1, error: null };
      }

      if (st.op === 'delete') {
        if (st.filters.some((f) => f.op === 'in') && h.beforeBatchDelete) {
          const hook = h.beforeBatchDelete;
          h.beforeBatchDelete = null;
          await hook();
        }
        const clause = where(params);
        const r = await run(`DELETE FROM public."${table}"${clause} RETURNING "id"`, params);
        if (r.error) return { data: null, count: null, error: r.error };
        return { data: null, count: r.rows.length, error: null };
      }

      if (st.head) {
        const clause = where(params);
        const r = await run(`SELECT count(*)::int AS c FROM public."${table}"${clause}`, params);
        if (r.error) return { data: null, count: null, error: r.error };
        return { data: null, count: Number(r.rows[0]?.c ?? 0), error: null };
      }

      const clause = where(params);
      const cols = st.cols === '*' ? '*' : st.cols.split(',').map((c) => `"${c.trim()}"`).join(', ');
      const order = st.order ? ` ORDER BY "${st.order.col}" ${st.order.asc ? 'ASC' : 'DESC'}` : '';
      const limit = st.limit != null ? ` LIMIT ${st.limit}` : (mode === 'many' ? '' : ' LIMIT 1');
      const r = await run(`SELECT ${cols} FROM public."${table}"${clause}${order}${limit}`, params);
      if (r.error) return { data: null, count: null, error: r.error };
      const norm = r.rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
        return out;
      });
      if (mode === 'many') return { data: norm, count: norm.length, error: null };
      return { data: norm[0] ?? null, count: null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (typeof cols === 'string' && st.op === 'select') st.cols = cols;
        if (opts?.head) st.head = true;
        return b;
      },
      insert: (p: Record<string, unknown>) => { st.op = 'insert'; st.payload = p; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ col: c, op: 'eq', val: v }); return b; },
      in: (c: string, v: unknown) => { st.filters.push({ col: c, op: 'in', val: v }); return b; },
      lt: (c: string, v: unknown) => { st.filters.push({ col: c, op: 'lt', val: v }); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order = { col: c, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import { runRetentionPolicy } from '../../services/retentionService';

// ---------------------------------------------------------------------------
// Isolation guard. `setup.ts` already refuses a managed host; this additionally
// pins the target to loopback, so the suite cannot be pointed at a shared
// database even on a developer machine.
// ---------------------------------------------------------------------------
const DB_URL = process.env.W6_DB_URL ?? '';
const LOOPBACK = /@(127\.0\.0\.1|localhost|\[::1\]):\d+\//;
if (!LOOPBACK.test(DB_URL)) {
  throw new Error(
    'retention real-schema suite refuses a non-loopback W6_DB_URL: it mutates and DELETES rows, '
    + 'so it runs only against a disposable database published on 127.0.0.1. '
    + `Got: ${DB_URL.replace(/:[^:@]+@/, ':***@')}`,
  );
}

// ---------------------------------------------------------------------------
// Reserved fixture identifiers. The `c0ffee00` prefix cannot collide with real
// data, and every scenario is wrapped in inRollback() anyway.
// ---------------------------------------------------------------------------
const F = {
  policy: 'c0ffee00-0000-4000-8000-000000000001',
  sigProt: 'c0ffee00-0000-4000-8000-000000000011',
  sigElig1: 'c0ffee00-0000-4000-8000-000000000012',
  sigElig2: 'c0ffee00-0000-4000-8000-000000000013',
  sigXten: 'c0ffee00-0000-4000-8000-000000000014',
  feedProt: 'c0ffee00-0000-4000-8000-000000000021',
  feedElig1: 'c0ffee00-0000-4000-8000-000000000022',
  feedElig2: 'c0ffee00-0000-4000-8000-000000000023',
  feedXten: 'c0ffee00-0000-4000-8000-000000000024',
  lifecycle: 'c0ffee00-0000-4000-8000-000000000031',
};
const OLD = '2020-01-01T00:00:00.000Z';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function signal(id: string, org: string, srcId: string): Promise<void> {
  await q(
    `INSERT INTO public.lead_signals
       (id, organization_id, source_type, source_id, platform, detected_at, migration_source)
     VALUES ($1, $2, 'listening', $3, 'reddit', $4, 'ret-regression')`,
    [id, org, srcId, OLD],
  );
}

async function feed(id: string, org: string, signalId: string): Promise<void> {
  await q(
    `INSERT INTO public.opportunity_feed_items
       (id, organization_id, signal_id, opportunity_type, detected_reason, platform, created_at)
     VALUES ($1, $2, $3, 'buying_intent', $4, 'reddit', $5)`,
    [id, org, signalId, `ret-regression ${id.slice(-2)}`, OLD],
  );
}

async function lifecycleRow(id: string, org: string, feedId: string, state = 'archived'): Promise<void> {
  await q(
    `INSERT INTO public.opportunity_lifecycle_states
       (id, organization_id, opportunity_feed_item_id, state, is_initial)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [id, org, feedId, state],
  );
}

async function policy(target = 'opportunity_feed_items', mode = 'hard_delete'): Promise<void> {
  await q(
    `INSERT INTO public.retention_policies
       (id, organization_id, target_kind, retain_days, archival_mode, enabled)
     VALUES ($1, $2, $3, 30, $4, TRUE)`,
    [F.policy, ORG_A, target, mode],
  );
}

const run = (mode: 'dry_run' | 'execute' = 'execute') =>
  runRetentionPolicy({ organizationId: ORG_A, policyId: F.policy, mode, initiatedBy: null });

const exists = async (table: string, id: string): Promise<boolean> =>
  (await q(`SELECT 1 FROM public."${table}" WHERE id = $1`, [id])).rows.length > 0;

const byId = (outcomes: Array<{ id: string; disposition: string; reason: string | null }>, id: string) =>
  outcomes.find((o) => o.id === id);

const deletes = () => harness.log.filter((l) => l.sql.startsWith('DELETE'));
const probes = () => harness.log.filter((l) => l.table === 'opportunity_lifecycle_states' && l.sql.startsWith('SELECT'));

/** Every scenario: fresh harness state, seeded tenants, always rolled back. */
const scenario = <T>(body: () => Promise<T>): Promise<T> =>
  inRollback(async () => {
    harness.log = [];
    harness.beforeBatchDelete = null;
    await seedTenants();
    return body();
  });

/**
 * Grants a non-superuser role only what a scenario needs, then switches to it.
 *
 * Two facts make this necessary rather than decorative. The suite connects as
 * a SUPERUSER, which bypasses every privilege check, so a permission failure
 * cannot be induced without switching role. And RLS is enabled on all of these
 * tables, so a role without a policy would read ZERO ROWS instead of raising —
 * silently turning a permission test into an empty-result test. BYPASSRLS
 * removes that confound and matches production, where the service role
 * bypasses row-level security, so the privilege boundary is the one that
 * actually governs these reads.
 */
async function asRestricted(grants: string[]): Promise<void> {
  await q(`CREATE ROLE ret_restricted NOLOGIN NOINHERIT BYPASSRLS`);
  await q(`GRANT USAGE ON SCHEMA public TO ret_restricted`);
  await q(`GRANT SELECT ON public.retention_policies TO ret_restricted`);
  await q(`GRANT INSERT, SELECT ON public.retention_executions TO ret_restricted`);
  for (const g of grants) await q(g);
  await q(`SET LOCAL ROLE ret_restricted`);
}

describe('PI-C1 retention — the database context these tests rely on', () => {
  it('the append-only guard is present, BEFORE DELETE, row-level and enabled', async () => {
    const { rows } = await q(
      `SELECT tgname,
              (tgtype & 2) <> 0 AS before,
              (tgtype & 1) <> 0 AS row_level,
              (tgtype & 8) <> 0 AS on_delete,
              tgenabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'opportunity_lifecycle_states' AND NOT t.tgisinternal
        ORDER BY tgname`,
    );
    const del = rows.find((r) => r.tgname === 'opp_lifecycle_block_delete');
    expect(del).toBeDefined();
    expect(del?.before).toBe(true);
    expect(del?.row_level).toBe(true);
    expect(del?.on_delete).toBe(true);
    expect(del?.tgenabled).toBe('O');
  });

  it('the lifecycle anchor cascades from its parent, which is what the guard then refuses', async () => {
    const { rows } = await q(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = 'opportunity_lifecycle_states_opportunity_feed_item_id_fkey'`,
    );
    expect(rows[0]?.confdeltype).toBe('c');
  });

  it('deleting a lifecycle-bearing parent directly is refused by PostgreSQL', async () => {
    await scenario(async () => {
      await signal(F.sigProt, ORG_A, 'ret-prot');
      await feed(F.feedProt, ORG_A, F.sigProt);
      await lifecycleRow(F.lifecycle, ORG_A, F.feedProt);

      let sqlstate = 'none';
      await q('SAVEPOINT guard_probe');
      try {
        await q(`DELETE FROM public.opportunity_feed_items WHERE id = $1`, [F.feedProt]);
      } catch (e: unknown) {
        sqlstate = String((e as { code?: unknown })?.code ?? 'unknown');
        await q('ROLLBACK TO SAVEPOINT guard_probe');
      }
      // P0001: the guard raises without an explicit ERRCODE, unlike the PI
      // sibling guard which declares 42501. Both are recognised by
      // classifyLifecycleGuardError; this pins the Community one.
      expect(sqlstate).toBe('P0001');
      expect(await exists('opportunity_feed_items', F.feedProt)).toBe(true);
    });
  });
});

describe('R1 — a lifecycle-protected parent survives retention', () => {
  it('parent and lifecycle evidence remain, and no DELETE is issued at all', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigProt, ORG_A, 'ret-prot');
      await feed(F.feedProt, ORG_A, F.sigProt);
      await lifecycleRow(F.lifecycle, ORG_A, F.feedProt);

      expect(await exists('opportunity_feed_items', F.feedProt)).toBe(true);
      const result = await run();

      expect(await exists('opportunity_feed_items', F.feedProt)).toBe(true);
      expect(await exists('opportunity_lifecycle_states', F.lifecycle)).toBe(true);
      expect(byId(result.outcomes, F.feedProt)).toEqual({
        id: F.feedProt, disposition: 'excluded_protected', reason: 'append_only_child_present',
      });
      expect(result.rows_affected).toBe(0);
      expect(result.status).toBe('partial');
      // Pre-exclusion, not recovery: the protected row never reached a
      // statement, so the guard was never provoked.
      expect(deletes()).toHaveLength(0);
    });
  });
});

describe('R2 — an eligible parent is deleted, with a confirmed count', () => {
  it('the row is absent afterwards and the outcome says deleted', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);

      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(true);
      const result = await run();

      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(false);
      expect(byId(result.outcomes, F.feedElig1)?.disposition).toBe('deleted');
      expect(result.rows_scanned).toBe(1);
      expect(result.rows_affected).toBe(1);
      expect(result.status).toBe('completed');
      expect(result.detail).toBe('deleted=1');
    });
  });
});

describe('R3 — a mixed batch preserves evidence without losing eligible work', () => {
  it('both eligible rows go, the protected row and its evidence stay, counts are truthful', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigProt, ORG_A, 'ret-prot');
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await signal(F.sigElig2, ORG_A, 'ret-e2');
      await feed(F.feedProt, ORG_A, F.sigProt);
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      await feed(F.feedElig2, ORG_A, F.sigElig2);
      await lifecycleRow(F.lifecycle, ORG_A, F.feedProt);

      const result = await run();

      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(false);
      expect(await exists('opportunity_feed_items', F.feedElig2)).toBe(false);
      expect(await exists('opportunity_feed_items', F.feedProt)).toBe(true);
      expect(await exists('opportunity_lifecycle_states', F.lifecycle)).toBe(true);

      expect(result.rows_scanned).toBe(3);
      expect(result.rows_affected).toBe(2);
      expect(result.status).toBe('partial');
      expect(byId(result.outcomes, F.feedProt)?.disposition).toBe('excluded_protected');
      for (const id of [F.feedElig1, F.feedElig2]) {
        expect(byId(result.outcomes, id)?.disposition).toBe('deleted');
      }
      // Status and per-item outcomes cannot contradict each other: the count of
      // `deleted` outcomes must equal rows_affected.
      const deleted = result.outcomes.filter((o) => o.disposition === 'deleted');
      expect(deleted).toHaveLength(result.rows_affected);
    });
  });
});

describe('R4 — both DELETE paths are scoped to the authoritative tenant', () => {
  it('a cross-tenant row is neither deleted nor reported, and the batch DELETE carries the predicate', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await signal(F.sigXten, ORG_B, 'ret-x');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      await feed(F.feedXten, ORG_B, F.sigXten);

      const result = await run();

      expect(await exists('opportunity_feed_items', F.feedXten)).toBe(true);
      expect(byId(result.outcomes, F.feedXten)).toBeUndefined();
      expect(result.rows_scanned).toBe(1);
      expect(result.rows_affected).toBe(1);

      const d = deletes();
      expect(d).toHaveLength(1);
      expect(d[0].sql).toContain('"organization_id" = $1');
      expect(d[0].params[0]).toBe(ORG_A);
    });
  });

  it('the DELETE predicate is load-bearing: the product\'s own statement cannot remove another tenant\'s row', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await signal(F.sigXten, ORG_B, 'ret-x');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      await feed(F.feedXten, ORG_B, F.sigXten);

      await run();
      const emitted = deletes()[0];

      // Re-issue the product's EXACT statement, substituting the other
      // tenant's id. This is what proves the predicate — not the fact that a
      // tenant-scoped SELECT happened to feed it.
      const res = await q(emitted.sql, [ORG_A, [F.feedXten]]);
      expect(res.rows).toHaveLength(0);
      expect(await exists('opportunity_feed_items', F.feedXten)).toBe(true);
    });
  });

  it('the per-item fallback also carries the predicate', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      // Protection the tenant-scoped probe cannot see, because the lifecycle
      // row belongs to the OTHER tenant. The guard still fires on the cascade,
      // so the batch is refused and the per-item pass runs.
      await lifecycleRow(F.lifecycle, ORG_B, F.feedElig1);

      const result = await run();

      const perItem = deletes().filter((l) => l.sql.includes('"id" = $2'));
      expect(perItem.length).toBeGreaterThan(0);
      for (const d of perItem) {
        expect(d.sql).toContain('"organization_id" = $1');
        expect(d.params[0]).toBe(ORG_A);
      }
      // The row is protected in fact, so it survives and is reported as such.
      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(true);
      expect(byId(result.outcomes, F.feedElig1)?.disposition).toBe('excluded_protected');
      expect(byId(result.outcomes, F.feedElig1)?.reason).toBe('append_only_guard_P0001');
      expect(result.rows_affected).toBe(0);
    });
  });
});

describe('R5 — a short batch count is reported as indeterminate, never as deleted', () => {
  it('HARNESS-ASSISTED timing: one row vanishes between select and delete', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await signal(F.sigElig2, ORG_A, 'ret-e2');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      await feed(F.feedElig2, ORG_A, F.sigElig2);

      // The harness controls ONLY the interleaving: it removes one eligible row
      // out of band after the candidate select and before the batch delete.
      // PostgreSQL then produces the short affected-row count itself. The
      // database does not spontaneously reach this state.
      harness.beforeBatchDelete = async () => {
        await q(`DELETE FROM public.opportunity_feed_items WHERE id = $1`, [F.feedElig2]);
      };

      const result = await run();

      expect(result.rows_affected).toBe(1);
      for (const id of [F.feedElig1, F.feedElig2]) {
        expect(byId(result.outcomes, id)?.disposition).toBe('indeterminate');
      }
      expect(result.outcomes.some((o) => o.disposition === 'deleted')).toBe(false);
      expect(result.detail).toContain('batch_count_short_1_of_2');
      expect(result.detail).toContain('per_id_attribution_unavailable');
      expect(result.status).toBe('partial');

      // No per-item retry: exactly ONE delete statement from the product. The
      // harness's own out-of-band delete is not in this log.
      const d = deletes();
      expect(d).toHaveLength(1);
      expect(d[0].sql).toContain('ANY(');
    });
  });
});

describe('R6 — a failed scan count fails closed', () => {
  it('reports failure, probes nothing, deletes nothing', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      await asRestricted([]); // no privilege on the target table at all

      const result = await run();
      await q('RESET ROLE');

      expect(result.status).toBe('failed');
      expect(result.detail).toContain('scan_count_failed');
      expect(result.rows_affected).toBe(0);
      expect(result.outcomes).toHaveLength(0);
      expect(probes()).toHaveLength(0);
      expect(deletes()).toHaveLength(0);
      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(true);
    });
  });
});

describe('R7 — a failed candidate select fails closed, independently of the count', () => {
  it('reports candidate_select_failed and cannot look like an empty run', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      // Column-level privilege: enough for count(*), not enough for SELECT id.
      // This is what separates the two reads on the SAME table.
      await asRestricted([
        `GRANT SELECT (organization_id, created_at) ON public.opportunity_feed_items TO ret_restricted`,
      ]);

      const result = await run();
      await q('RESET ROLE');

      expect(result.status).toBe('failed');
      expect(result.detail).toContain('candidate_select_failed');
      expect(result.detail).not.toContain('scan_count_failed');
      expect(result.rows_affected).toBe(0);
      expect(probes()).toHaveLength(0);
      expect(deletes()).toHaveLength(0);
      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(true);
    });
  });
});

describe('R8 — an unreadable protection probe deletes nothing', () => {
  it('fails closed with protection_undetermined, though the target is readable and deletable', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      // The target is fully readable AND deletable; only the child is not
      // readable. So nothing but the probe failure can explain the refusal.
      await asRestricted([
        `GRANT SELECT, DELETE ON public.opportunity_feed_items TO ret_restricted`,
      ]);

      const result = await run();
      await q('RESET ROLE');

      expect(result.status).toBe('failed');
      expect(result.detail).toContain('protection_probe_failed');
      expect(result.rows_affected).toBe(0);
      expect(deletes()).toHaveLength(0);
      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(true);
      expect(result.outcomes.length).toBeGreaterThan(0);
      for (const o of result.outcomes) {
        expect(o.disposition).toBe('failed');
        expect(o.reason).toBe('protection_undetermined');
      }
    });
  });
});

describe('R9 — a genuinely empty run is truthful and distinct from a failed read', () => {
  it('completes with a null detail and no outcomes', async () => {
    await scenario(async () => {
      await policy();
      const result = await run();
      expect(result.status).toBe('completed');
      expect(result.detail).toBeNull();
      expect(result.rows_scanned).toBe(0);
      expect(result.rows_affected).toBe(0);
      expect(result.outcomes).toHaveLength(0);
      expect(deletes()).toHaveLength(0);
    });
  });

  it('a dry run previews the split and mutates nothing', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigProt, ORG_A, 'ret-prot');
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedProt, ORG_A, F.sigProt);
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      await lifecycleRow(F.lifecycle, ORG_A, F.feedProt);

      const result = await run('dry_run');

      expect(byId(result.outcomes, F.feedElig1)?.disposition).toBe('would_delete');
      expect(byId(result.outcomes, F.feedProt)?.disposition).toBe('excluded_protected');
      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(true);
      expect(await exists('opportunity_feed_items', F.feedProt)).toBe(true);
      expect(deletes()).toHaveLength(0);
    });
  });
});

describe('R10 — retries never invent a deletion', () => {
  it('a second run after a successful one deletes nothing more', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);

      const first = await run();
      expect(first.rows_affected).toBe(1);

      const second = await run();
      expect(second.rows_affected).toBe(0);
      expect(second.outcomes).toHaveLength(0);
      expect(second.status).toBe('completed');
      expect(second.outcomes.some((o) => o.disposition === 'deleted')).toBe(false);
    });
  });

  it('a retry over a protected row repeats the exclusion and never escalates', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigProt, ORG_A, 'ret-prot');
      await feed(F.feedProt, ORG_A, F.sigProt);
      await lifecycleRow(F.lifecycle, ORG_A, F.feedProt);

      await run();
      const second = await run();

      expect(byId(second.outcomes, F.feedProt)?.disposition).toBe('excluded_protected');
      expect(second.rows_affected).toBe(0);
      expect(await exists('opportunity_feed_items', F.feedProt)).toBe(true);
      expect(await exists('opportunity_lifecycle_states', F.lifecycle)).toBe(true);
    });
  });

  it('cleanup touches nothing outside the fixture: an unrelated row of the same tenant survives', async () => {
    await scenario(async () => {
      await policy();
      await signal(F.sigElig1, ORG_A, 'ret-e1');
      await feed(F.feedElig1, ORG_A, F.sigElig1);
      // Same tenant, but NEWER than the cutoff, so out of retention scope.
      await signal(F.sigElig2, ORG_A, 'ret-recent');
      await q(
        `INSERT INTO public.opportunity_feed_items
           (id, organization_id, signal_id, opportunity_type, detected_reason, platform, created_at)
         VALUES ($1, $2, $3, 'buying_intent', 'ret-regression recent', 'reddit', now())`,
        [F.feedElig2, ORG_A, F.sigElig2],
      );

      const result = await run();

      expect(result.rows_scanned).toBe(1);
      expect(result.rows_affected).toBe(1);
      expect(await exists('opportunity_feed_items', F.feedElig1)).toBe(false);
      expect(await exists('opportunity_feed_items', F.feedElig2)).toBe(true);
      expect(byId(result.outcomes, F.feedElig2)).toBeUndefined();
    });
  });
});
