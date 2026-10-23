/**
 * PI-C1 Phase 1 — retention pre-exclusion, fail-closed lifecycle reads, and
 * append-only SQLSTATE classification.
 *
 * What these tests are actually for. Three defects were verified against real
 * PostgreSQL in PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001 §17, and each of them is
 * silent in a way that makes it expensive:
 *
 *   • A delete batch holding ONE append-only-protected row deleted NOTHING
 *     (probe P7), and the next run selects the same batch — so eligible rows
 *     were blocked indefinitely while the only trace was a `failed` execution
 *     row carrying a raw trigger string.
 *   • `transitionLifecycle` substituted `detected` when an opportunity had no
 *     lifecycle history. The pipeline's lifecycle init is best-effort and its
 *     failure is swallowed, so that substitution was reachable, and it made an
 *     opportunity of undetermined state indistinguishable from a new one.
 *   • The two append-only guards raise DIFFERENT SQLSTATEs — `P0001` on
 *     `opportunity_lifecycle_states`, `42501` on `prospect_lifecycle_transitions`
 *     — and `42501` is `insufficient_privilege`, which this repository also
 *     uses for genuine permission denials.
 *
 * So the properties under test are the ones that fail silently: that a
 * protected row is reported rather than swallowed, that an eligible row is not
 * punished for travelling with it, that a failed deletion is never counted as
 * a success, that missing and unreadable evidence fail closed instead of
 * resolving to a state, that both SQLSTATEs are recognised while a real
 * authorization denial stays a denial, and that neither reading nor retention
 * ever writes a transition.
 *
 * The database double mirrors the constraint that matters here: it enforces
 * the append-only guard itself, raising `P0001` when a delete would cascade
 * onto a protected lifecycle row. Without that fidelity a test could "pass"
 * against a double that simply allows the delete the real database refuses.
 */

type Row = Record<string, unknown>;
type Filter = [kind: 'eq' | 'in' | 'lt', column: string, value: unknown];

const pgError = (code: string, message: string) => ({ code, message });

const db = {
  tables: {} as Record<string, Row[]>,
  /** Per-table error injection, for the fail-closed paths. */
  failures: {} as Record<string, { code: string; message: string }>,
  /**
   * Per-table, per-operation error injection. The retention service issues two
   * DIFFERENT reads against the same target table — a head count and a
   * candidate select — and F-2 requires each to be provably fail-closed on its
   * own, which a whole-table failure cannot distinguish.
   */
  opFailures: {} as Record<string, { code: string; message: string }>,
  /**
   * F-1 only. When set to a table name, SELECTs against it ignore the
   * `organization_id` predicate, simulating a selection path that has been
   * widened or mis-filtered. Nothing in the product does this; the point is to
   * prove the DELETE's own tenant predicate still refuses the row, i.e. that
   * it is load-bearing rather than redundant.
   */
  leakSelectForTable: null as string | null,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select',
      filters: [] as Filter[],
      payload: null as Row | null,
      head: false,
      limit: Number.POSITIVE_INFINITY,
    };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row): boolean => {
      const leaking = db.leakSelectForTable === table && st.op === 'select';
      return st.filters.every(([kind, col, val]) => {
        if (leaking && col === 'organization_id') return true;
        if (kind === 'eq') return r[col] === val;
        if (kind === 'in') return Array.isArray(val) && (val as unknown[]).includes(r[col] ?? null);
        if (kind === 'lt') return String(r[col] ?? '') < String(val);
        return true;
      });
    };

    /**
     * The real guard: `opportunity_lifecycle_states` has a BEFORE DELETE row
     * trigger raising `P0001`, and a cascade from `opportunity_feed_items`
     * fires it — aborting the whole statement, not just the offending row.
     */
    const guardRefusal = (doomed: Row[]): { code: string; message: string } | null => {
      if (table === 'opportunity_lifecycle_states' && doomed.length > 0) {
        return pgError('P0001', 'opportunity_lifecycle_states is append-only');
      }
      if (table === 'opportunity_feed_items') {
        const lifecycle = db.tables['opportunity_lifecycle_states'] ?? [];
        const protectedParents = new Set(lifecycle.map((l) => l.opportunity_feed_item_id));
        if (doomed.some((d) => protectedParents.has(d.id))) {
          return pgError('P0001', 'opportunity_lifecycle_states is append-only');
        }
      }
      return null;
    };

    const exec = async (mode: 'many' | 'maybe' | 'single' | 'delete'): Promise<Row> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      const failure = db.failures[table];
      if (failure) return { data: null, count: null, error: failure };
      // F-2: distinguish the head count from the candidate select on the SAME
      // table, so each can be failed independently.
      const opKey = `${table}:${st.op}:${st.head ? 'head' : 'rows'}`;
      const opFailure = db.opFailures[opKey];
      if (opFailure) return { data: null, count: null, error: opFailure };

      if (st.op === 'insert') {
        const created = { id: `${table}-${db.nextId++}`, ...(st.payload as Row) };
        rows().push(created);
        return { data: created, count: 1, error: null };
      }
      if (st.op === 'delete') {
        const doomed = rows().filter(match);
        const refusal = guardRefusal(doomed);
        // The whole statement is refused, exactly as a cascade would be.
        if (refusal) return { data: null, count: null, error: refusal };
        db.tables[table] = rows().filter((r) => !doomed.includes(r));
        return { data: null, count: doomed.length, error: null };
      }
      const found = rows().filter(match);
      if (st.head) return { data: null, count: found.length, error: null };
      const limited = found.slice(0, st.limit);
      if (mode === 'many') return { data: limited, count: limited.length, error: null };
      return { data: limited[0] ?? null, count: null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) st.head = true;
        return b;
      },
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      lt: (c: string, v: unknown) => { st.filters.push(['lt', c, v]); return b; },
      order: () => b,
      // Chainable: the lifecycle reader calls `.limit(1).maybeSingle()`, while
      // retention awaits `.limit(n)` directly — `then` below serves that case.
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        exec(st.op === 'delete' ? 'delete' : 'many').then(res, rej),
    };
    return b;
  },
}));

import { runRetentionPolicy } from '../../services/retentionService';
import {
  readCurrentLifecycleState,
  transitionLifecycle,
  isResolvedForAccountDeletion,
  LifecycleEvidenceUnavailableError,
  LifecycleTransitionError,
} from '../../services/opportunityLifecycleService';
import {
  classifyLifecycleGuardError,
  isAuthorizationRefusal,
} from '../../services/lifecycleGuardErrors';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const POLICY = 'policy-1';
const OLD = '2020-01-01T00:00:00.000Z';
const PROTECTED_ITEM = 'feed-protected';
const ELIGIBLE_ITEM = 'feed-eligible';

const policyRow = (over: Row = {}): Row => ({
  id: POLICY,
  organization_id: ORG_A,
  target_kind: 'opportunity_feed_items',
  retain_days: 30,
  archival_mode: 'hard_delete',
  enabled: true,
  metadata: {},
  created_by: null,
  created_at: OLD,
  updated_at: OLD,
  ...over,
});

const feedRow = (id: string, over: Row = {}): Row => ({
  id,
  organization_id: ORG_A,
  created_at: OLD,
  detected_reason: `reason for ${id}`,
  ...over,
});

const lifecycleRow = (over: Row = {}): Row => ({
  id: `lc-${db.nextId++}`,
  organization_id: ORG_A,
  opportunity_feed_item_id: PROTECTED_ITEM,
  state: 'archived',
  previous_state: 'converted',
  is_initial: false,
  reasoning: null,
  actor_user_id: null,
  metadata: {},
  transitioned_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  db.tables = {};
  db.failures = {};
  db.opFailures = {};
  db.leakSelectForTable = null;
  db.queries = [];
  db.nextId = 1;
});

const run = (mode: 'dry_run' | 'execute' = 'execute') =>
  runRetentionPolicy({ organizationId: ORG_A, policyId: POLICY, mode, initiatedBy: 'operator-1' });

const byId = (outcomes: Array<{ id: string; disposition: string; reason: string | null }>, id: string) =>
  outcomes.find((o) => o.id === id);

// ---------------------------------------------------------------------------
// 1. Retention: pre-exclusion and truthful per-item outcomes
// ---------------------------------------------------------------------------

describe('PI-C1 Phase 1 — retention pre-exclusion', () => {
  beforeEach(() => {
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [feedRow(PROTECTED_ITEM), feedRow(ELIGIBLE_ITEM)];
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow()];
  });

  it('a batch holding a protected row still deletes the eligible row', async () => {
    const result = await run();

    // The defect this replaces: the real database refused the whole batch and
    // NEITHER row was deleted (probe P7).
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.disposition).toBe('deleted');
    expect(byId(result.outcomes, PROTECTED_ITEM)?.disposition).toBe('excluded_protected');
    expect(db.tables['opportunity_feed_items'].map((r) => r.id)).toEqual([PROTECTED_ITEM]);
  });

  it('the protected row and its lifecycle evidence both survive', async () => {
    await run();
    expect(db.tables['opportunity_feed_items'].some((r) => r.id === PROTECTED_ITEM)).toBe(true);
    expect(db.tables['opportunity_lifecycle_states']).toHaveLength(1);
  });

  it('reports the exclusion rather than discarding it, and is not `completed`', async () => {
    const result = await run();
    expect(result.status).toBe('partial');
    expect(result.detail).toContain('excluded_protected=1');
    expect(byId(result.outcomes, PROTECTED_ITEM)?.reason).toBe('append_only_child_present');
  });

  it('counts only confirmed deletions in rows_affected', async () => {
    const result = await run();
    expect(result.rows_affected).toBe(1);
    expect(result.rows_scanned).toBe(2);
  });

  it('is retry-safe: a second run repeats the exclusion and deletes nothing more', async () => {
    await run();
    const second = await run();
    expect(second.rows_affected).toBe(0);
    expect(byId(second.outcomes, PROTECTED_ITEM)?.disposition).toBe('excluded_protected');
    expect(db.tables['opportunity_lifecycle_states']).toHaveLength(1);
  });

  it('the protection probe is tenant-scoped', async () => {
    const probe = db.queries.length;
    await run();
    const probes = db.queries
      .slice(probe)
      .filter((q) => q.table === 'opportunity_lifecycle_states' && q.op === 'select');
    expect(probes.length).toBeGreaterThan(0);
    for (const q of probes) {
      expect(q.filters).toEqual(
        expect.arrayContaining([['eq', 'organization_id', ORG_A]]),
      );
    }
  });

  it('another tenant\'s lifecycle row does not protect this tenant\'s feed item', async () => {
    db.tables['opportunity_lifecycle_states'] = [
      lifecycleRow({ organization_id: ORG_B, opportunity_feed_item_id: ELIGIBLE_ITEM }),
    ];
    const result = await run();
    // Protection is a property of THIS tenant's evidence. The cross-tenant row
    // must not be read as protection — and the delete must still be isolated
    // rather than voiding the batch, because the guard fires regardless.
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.disposition).toBe('excluded_protected');
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.reason).toBe('append_only_guard_P0001');
    expect(byId(result.outcomes, PROTECTED_ITEM)?.disposition).toBe('deleted');
  });

  it('never reports a failed deletion as successful', async () => {
    db.tables['opportunity_feed_items'] = [feedRow(ELIGIBLE_ITEM)];
    db.tables['opportunity_lifecycle_states'] = [
      lifecycleRow({ organization_id: ORG_B, opportunity_feed_item_id: ELIGIBLE_ITEM }),
    ];
    const result = await run();
    expect(result.rows_affected).toBe(0);
    expect(result.status).not.toBe('completed');
    expect(db.tables['opportunity_feed_items']).toHaveLength(1);
  });

  it('fails closed when protection cannot be determined, deleting nothing', async () => {
    db.failures['opportunity_lifecycle_states'] = pgError('57014', 'statement timeout');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('protection_probe_failed');
    expect(result.rows_affected).toBe(0);
    // Both candidates survive: an undetermined probe must never be read as
    // "nothing is protected".
    expect(db.tables['opportunity_feed_items']).toHaveLength(2);
    for (const o of result.outcomes) {
      expect(o.disposition).toBe('failed');
      expect(o.reason).toBe('protection_undetermined');
    }
  });

  it('a dry run previews the same split and mutates nothing', async () => {
    const result = await run('dry_run');
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.disposition).toBe('would_delete');
    expect(byId(result.outcomes, PROTECTED_ITEM)?.disposition).toBe('excluded_protected');
    expect(result.rows_affected).toBe(0);
    expect(db.tables['opportunity_feed_items']).toHaveLength(2);
  });

  it('retention never writes a lifecycle transition', async () => {
    await run();
    const writes = db.queries.filter(
      (q) => q.table === 'opportunity_lifecycle_states' && q.op === 'insert',
    );
    expect(writes).toHaveLength(0);
  });

  it('a target with no protected children is unaffected', async () => {
    db.tables['retention_policies'] = [policyRow({ target_kind: 'alerts' })];
    db.tables['alerts'] = [{ id: 'alert-1', organization_id: ORG_A, created_at: OLD }];
    const result = await run();
    expect(result.rows_affected).toBe(1);
    expect(result.status).toBe('completed');
    expect(byId(result.outcomes, 'alert-1')?.disposition).toBe('deleted');
  });
});

// ---------------------------------------------------------------------------
// 1b. F-1 — tenant-scoped DELETEs
// ---------------------------------------------------------------------------

describe('PI-C1 Phase 1 F-1 — every DELETE is tenant-scoped', () => {
  const deleteQueries = () => db.queries.filter((q) => q.op === 'delete');

  it('the batch DELETE carries the organization predicate', async () => {
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [feedRow(ELIGIBLE_ITEM)];
    await run();
    const deletes = deleteQueries();
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual(
      expect.arrayContaining([['eq', 'organization_id', ORG_A]]),
    );
  });

  it('the per-item fallback DELETE carries it too', async () => {
    // Force the fallback: a protected row the pre-exclusion map cannot see,
    // because the protecting evidence belongs to another tenant.
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [feedRow(ELIGIBLE_ITEM), feedRow(PROTECTED_ITEM)];
    db.tables['opportunity_lifecycle_states'] = [
      lifecycleRow({ organization_id: ORG_B, opportunity_feed_item_id: ELIGIBLE_ITEM }),
    ];
    await run();
    const perItem = deleteQueries().filter((q) =>
      q.filters.some(([kind, col]) => kind === 'eq' && col === 'id'),
    );
    expect(perItem.length).toBeGreaterThan(0);
    for (const q of perItem) {
      expect(q.filters).toEqual(
        expect.arrayContaining([['eq', 'organization_id', ORG_A]]),
      );
    }
  });

  it('another tenant\'s row cannot be deleted even if its id reaches the batch', async () => {
    // The selection path is deliberately leaked so an ORG_B id enters the
    // candidate list. The DELETE's own predicate is then the only defence.
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [feedRow(ELIGIBLE_ITEM, { organization_id: ORG_B })];
    db.leakSelectForTable = 'opportunity_feed_items';

    const result = await run();

    // The row survives, and is NOT reported as deleted.
    expect(db.tables['opportunity_feed_items']).toHaveLength(1);
    expect(db.tables['opportunity_feed_items'][0].organization_id).toBe(ORG_B);
    expect(result.rows_affected).toBe(0);
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.disposition).not.toBe('deleted');
  });

  it('a zero-row deletion is never reported as a confirmed deletion', async () => {
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [feedRow(ELIGIBLE_ITEM, { organization_id: ORG_B })];
    db.leakSelectForTable = 'opportunity_feed_items';

    const result = await run();

    expect(result.rows_affected).toBe(0);
    // Not `deleted`, which is the property that matters: a count of zero is
    // never a confirmation. It is `indeterminate` rather than `already_absent`
    // because a tenant-scoped operation cannot tell "gone" from "never mine".
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.disposition).toBe('indeterminate');
    expect(byId(result.outcomes, ELIGIBLE_ITEM)?.disposition).not.toBe('deleted');
    expect(result.status).not.toBe('completed');
    expect(result.detail).toContain('batch_count_short_0_of_1');
  });

  it('tenant isolation holds in a mixed batch: this tenant deleted, the other untouched', async () => {
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [
      feedRow(ELIGIBLE_ITEM),
      feedRow('feed-other-tenant', { organization_id: ORG_B }),
    ];
    db.leakSelectForTable = 'opportunity_feed_items';

    const result = await run();

    const remaining = db.tables['opportunity_feed_items'];
    // The isolation property: the other tenant's row survives, this tenant's
    // does not, even though both ids reached the batch.
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('feed-other-tenant');
    expect(remaining[0].organization_id).toBe(ORG_B);
    // The database confirmed one deletion, so the count is reported as one —
    // but WHICH id it covered is not recoverable, so neither is claimed
    // `deleted`. No row is ever reported deleted on a count alone.
    expect(result.rows_affected).toBe(1);
    expect(result.status).toBe('partial');
    for (const id of [ELIGIBLE_ITEM, 'feed-other-tenant']) {
      expect(byId(result.outcomes, id)?.disposition).toBe('indeterminate');
    }
    expect(result.detail).toContain('batch_count_short_1_of_2');
  });
});

// ---------------------------------------------------------------------------
// 1c. F-2 — a failed read is never a valid empty result
// ---------------------------------------------------------------------------

describe('PI-C1 Phase 1 F-2 — required reads fail closed', () => {
  beforeEach(() => {
    db.tables['retention_policies'] = [policyRow()];
    db.tables['opportunity_feed_items'] = [feedRow(ELIGIBLE_ITEM), feedRow(PROTECTED_ITEM)];
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow()];
  });

  it('a failed scan count is reported as failure, not as an empty scope', async () => {
    db.opFailures['opportunity_feed_items:select:head'] = pgError('57014', 'statement timeout');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('scan_count_failed');
    expect(result.rows_affected).toBe(0);
  });

  it('a failed scan count performs no DELETE', async () => {
    db.opFailures['opportunity_feed_items:select:head'] = pgError('57014', 'statement timeout');
    await run();
    expect(db.queries.filter((q) => q.op === 'delete')).toHaveLength(0);
    expect(db.tables['opportunity_feed_items']).toHaveLength(2);
  });

  it('a failed candidate select is reported as failure, not as an empty candidate list', async () => {
    db.opFailures['opportunity_feed_items:select:rows'] = pgError('57014', 'statement timeout');
    const result = await run();
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('candidate_select_failed');
    expect(result.rows_affected).toBe(0);
  });

  it('a failed candidate select performs no DELETE and no protection probe', async () => {
    db.opFailures['opportunity_feed_items:select:rows'] = pgError('57014', 'statement timeout');
    await run();
    expect(db.queries.filter((q) => q.op === 'delete')).toHaveLength(0);
    expect(
      db.queries.filter((q) => q.table === 'opportunity_lifecycle_states' && q.op === 'select'),
    ).toHaveLength(0);
    expect(db.tables['opportunity_feed_items']).toHaveLength(2);
  });

  it('a genuine empty run stays distinguishable from a failed read', async () => {
    // Nothing older than the cutoff: a real, successful, empty scope.
    db.tables['opportunity_feed_items'] = [];
    const result = await run();
    expect(result.status).toBe('completed');
    expect(result.detail).toBeNull();
    expect(result.rows_scanned).toBe(0);
    expect(result.rows_affected).toBe(0);
    expect(result.outcomes).toHaveLength(0);
    expect(db.queries.filter((q) => q.op === 'delete')).toHaveLength(0);
  });

  it('a failed read in dry_run mode also reports failure rather than an empty preview', async () => {
    db.opFailures['opportunity_feed_items:select:head'] = pgError('57014', 'statement timeout');
    const result = await run('dry_run');
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('scan_count_failed');
    expect(result.outcomes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Fail-closed typed lifecycle reads
// ---------------------------------------------------------------------------

describe('PI-C1 Phase 1 — fail-closed lifecycle reads', () => {
  it('valid initial evidence reads as present and initial', async () => {
    db.tables['opportunity_lifecycle_states'] = [
      lifecycleRow({ state: 'detected', previous_state: null, is_initial: true }),
    ];
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toMatchObject({ kind: 'present', state: 'detected', isInitial: true });
  });

  it('valid later history reads as present and not initial', async () => {
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow({ state: 'qualified', previous_state: 'reviewing' })];
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toMatchObject({ kind: 'present', state: 'qualified', isInitial: false });
  });

  it('missing history is `missing`, NOT a valid initial state', async () => {
    db.tables['opportunity_lifecycle_states'] = [];
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toEqual({ kind: 'missing' });
    // The precise regression: it must not resolve to `detected`.
    expect(read).not.toMatchObject({ state: 'detected' });
  });

  it('an unknown or malformed state is unreadable, not coerced', async () => {
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow({ state: 'some_future_state' })];
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toMatchObject({ kind: 'unreadable', reason: 'unknown_state' });
  });

  it('contradictory evidence is unreadable', async () => {
    db.tables['opportunity_lifecycle_states'] = [
      lifecycleRow({ is_initial: true, previous_state: 'qualified' }),
    ];
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toMatchObject({ kind: 'unreadable', reason: 'contradictory' });
  });

  it('a read failure is unreadable and is never reported as absence', async () => {
    db.failures['opportunity_lifecycle_states'] = pgError('57014', 'statement timeout');
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toMatchObject({ kind: 'unreadable', reason: 'read_failed' });
    expect(read.kind).not.toBe('missing');
  });

  it('reading never writes', async () => {
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow()];
    await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(db.queries.filter((q) => q.op === 'insert')).toHaveLength(0);
  });

  it('is tenant-scoped', async () => {
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow({ organization_id: ORG_B })];
    const read = await readCurrentLifecycleState(ORG_A, PROTECTED_ITEM);
    expect(read).toEqual({ kind: 'missing' });
  });
});

describe('PI-C1 Phase 1 — terminality fails closed (FR-A38 / FR-A39)', () => {
  it('only a present `archived` resolves an account-deletion block', () => {
    expect(
      isResolvedForAccountDeletion({
        kind: 'present',
        state: 'archived',
        isInitial: false,
        record: lifecycleRow() as never,
      }),
    ).toBe(true);
  });

  it.each(['detected', 'triaged', 'reviewing', 'qualified', 'monitoring', 'outreach_planned', 'converted', 'dismissed'] as const)(
    '`%s` does not resolve it',
    (state) => {
      expect(
        isResolvedForAccountDeletion({
          kind: 'present',
          state,
          isInitial: false,
          record: lifecycleRow() as never,
        }),
      ).toBe(false);
    },
  );

  it('missing and unreadable both fail closed', () => {
    expect(isResolvedForAccountDeletion({ kind: 'missing' })).toBe(false);
    expect(
      isResolvedForAccountDeletion({ kind: 'unreadable', reason: 'read_failed', detail: 'x' }),
    ).toBe(false);
  });
});

describe('PI-C1 Phase 1 — transitions refuse undetermined state', () => {
  const transition = (to: Parameters<typeof transitionLifecycle>[0]['to']) =>
    transitionLifecycle({
      organizationId: ORG_A,
      opportunityFeedItemId: PROTECTED_ITEM,
      to,
      actorUserId: 'user-1',
      reasoning: null,
    });

  it('refuses when history is missing instead of assuming `detected`', async () => {
    db.tables['opportunity_lifecycle_states'] = [];
    await expect(transition('triaged')).rejects.toBeInstanceOf(LifecycleEvidenceUnavailableError);
    await expect(transition('triaged')).rejects.toMatchObject({ reason: 'missing' });
  });

  it('does not fabricate initial history when refusing', async () => {
    db.tables['opportunity_lifecycle_states'] = [];
    await expect(transition('triaged')).rejects.toBeInstanceOf(LifecycleEvidenceUnavailableError);
    expect(db.tables['opportunity_lifecycle_states'] ?? []).toHaveLength(0);
  });

  it('refuses on unreadable evidence', async () => {
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow({ state: 'not_a_state' })];
    await expect(transition('triaged')).rejects.toMatchObject({ reason: 'unknown_state' });
  });

  it('still allows a legitimate transition from real history', async () => {
    db.tables['opportunity_lifecycle_states'] = [
      lifecycleRow({ state: 'detected', previous_state: null, is_initial: true }),
    ];
    const record = await transition('triaged');
    expect(record).toMatchObject({ state: 'triaged', previous_state: 'detected' });
  });

  it('an already-archived retry is refused as an invalid transition, not as missing evidence', async () => {
    db.tables['opportunity_lifecycle_states'] = [lifecycleRow({ state: 'archived' })];
    await expect(transition('archived')).rejects.toBeInstanceOf(LifecycleTransitionError);
  });
});

// ---------------------------------------------------------------------------
// 3. SQLSTATE classification (B21)
// ---------------------------------------------------------------------------

describe('PI-C1 Phase 1 — append-only SQLSTATE classification', () => {
  it('recognises the Community guard (P0001)', () => {
    const refusal = classifyLifecycleGuardError(
      pgError('P0001', 'opportunity_lifecycle_states is append-only'),
    );
    expect(refusal).toMatchObject({ kind: 'append_only_violation', sqlstate: 'P0001' });
  });

  it('recognises the PI guard (42501)', () => {
    const refusal = classifyLifecycleGuardError(
      pgError('42501', 'prospect_lifecycle_transitions is append-only (UPDATE refused)'),
    );
    expect(refusal).toMatchObject({ kind: 'append_only_violation', sqlstate: '42501' });
  });

  it('preserves the distinct SQLSTATEs rather than collapsing them', () => {
    const a = classifyLifecycleGuardError(pgError('P0001', 'x is append-only'));
    const b = classifyLifecycleGuardError(pgError('42501', 'y is append-only'));
    expect(a?.sqlstate).not.toEqual(b?.sqlstate);
  });

  it('a genuine permission denial is NOT an append-only violation', () => {
    const denial = pgError('42501', 'permission denied for table opportunity_feed_items');
    expect(classifyLifecycleGuardError(denial)).toBeNull();
    expect(isAuthorizationRefusal(denial)).toBe(true);
  });

  it('an append-only refusal is NOT an authorization refusal', () => {
    const refusal = pgError('42501', 'prospect_lifecycle_transitions is append-only');
    expect(isAuthorizationRefusal(refusal)).toBe(false);
  });

  it('an unrelated plpgsql raise is not mistaken for a guard refusal', () => {
    expect(classifyLifecycleGuardError(pgError('P0001', 'some other business rule failed'))).toBeNull();
  });

  it.each([
    ['23505', 'duplicate key value violates unique constraint'],
    ['23503', 'insert or update violates foreign key constraint'],
    ['57014', 'statement timeout'],
  ])('%s is left alone', (code, message) => {
    expect(classifyLifecycleGuardError(pgError(code, message))).toBeNull();
    expect(isAuthorizationRefusal(pgError(code, message))).toBe(false);
  });

  it('tolerates a malformed error object', () => {
    expect(classifyLifecycleGuardError(null)).toBeNull();
    expect(classifyLifecycleGuardError({})).toBeNull();
    expect(classifyLifecycleGuardError({ code: 42501 })).toBeNull();
    expect(isAuthorizationRefusal(undefined)).toBe(false);
  });
});
