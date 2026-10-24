/**
 * Strategic Mix R2-P2 — blueprint lock doctrine.
 *
 * PART 1 (characterization, written BEFORE any change): the legacy
 * campaign-wide guard's complete failure-mode matrix. This behavior must
 * remain reproducible forever under legacy mode (flag off — the default).
 *
 * PART 2 (canonical, added with the implementation): per-item evaluation
 * under BLUEPRINT_PER_ITEM_LOCKS=true — an item protects the blueprint
 * only when it is publishing, published, or inside ITS OWN freeze window;
 * campaign-level scheduling never freezes unrelated items; scoped
 * operations evaluate only their affectedSlots.
 */

type Row = Record<string, unknown>;
let campaignRow: Row | null = null;
let postRows: Row[] = [];
let planRows: Row[] = [];
/** queue_jobs rows (publish pipeline state) for the retry-aware failed-post rule. */
let queueRows: Row[] = [];
/**
 * Schema mode for queue_jobs. true = migration 20261202000000 applied (the
 * retry_state column exists); false = BASELINE schema, where naming retry_state
 * is rejected with 42703 exactly like PostgREST.
 */
let queueRetryStateMigrated = true;
/** Unknown-column references a test DELIBERATELY provokes (baseline mode). */
let expectedUnknownRefs: string[] = [];
/** Production shape: the optional `campaigns.execution_status` column is absent (42703). */
let execStatusColumnAbsent = false;
/** Tables whose reads fail with a genuine database error. */
let failingTables: string[] = [];
/** Fail only the optional execution_status read with a genuine (non-42703) error. */
let failExecStatusRead = false;
/** Every select list issued against `campaigns`. */
const campaignSelects: string[] = [];

/**
 * Real column lists, read from the canonical baseline schema at test time —
 * never hand-copied — so the fake answers an unknown column the way PostgREST
 * does (42703). This is what lets a schema mismatch such as selecting
 * `scheduled_posts.scheduled_at` (the real column is `scheduled_for`) fail a
 * test instead of passing silently.
 */
function baselineColumns(table: string): Set<string> {
  // Loaded here, not via top-level imports: this runs at module scope above them.
  const { readFileSync } = jest.requireActual<typeof import('fs')>('fs');
  const { join } = jest.requireActual<typeof import('path')>('path');
  const sql = readFileSync(join(__dirname, '../../../supabase/_schema/baseline.sql'), 'utf8');
  const start = sql.indexOf(`CREATE TABLE public.${table} (`);
  if (start < 0) throw new Error(`baseline schema has no table public.${table}`);
  const body = sql.slice(start, sql.indexOf('\n);', start));
  const cols = new Set<string>();
  for (const line of body.split(/\r?\n/).slice(1)) {
    const m = line.match(/^\s{4}([a-z_][a-z0-9_]*)\s/);
    if (m) cols.add(m[1]);
  }
  if (cols.size === 0) throw new Error(`no columns parsed for public.${table}`);
  return cols;
}
const KNOWN_COLUMNS: Record<string, Set<string>> = {
  // execution_status is the optional legacy column: allowed here so the
  // column-PRESENT case stays testable; its ABSENT case (production) is
  // simulated explicitly by execStatusColumnAbsent below.
  campaigns: new Set([...baselineColumns('campaigns'), 'execution_status']),
  scheduled_posts: baselineColumns('scheduled_posts'),
  daily_content_plans: baselineColumns('daily_content_plans'),
  queue_jobs: baselineColumns('queue_jobs'),
};
/**
 * Columns added by the prepared (unapplied) migration, parsed from the file so
 * the migrated mode cannot drift from what the migration actually adds.
 */
function migrationAddedColumns(file: string): string[] {
  const { readFileSync } = jest.requireActual<typeof import('fs')>('fs');
  const { join } = jest.requireActual<typeof import('path')>('path');
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations', file), 'utf8');
  const cols = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS ([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
  if (cols.length === 0) throw new Error(`no ADD COLUMN parsed from ${file}`);
  return cols;
}
const RETRY_STATE_MIGRATION_COLUMNS = migrationAddedColumns('20261202000000_queue_jobs_retry_state.sql');
const knownColumns = (table: string): Set<string> | undefined =>
  table === 'queue_jobs' && queueRetryStateMigrated
    ? new Set([...KNOWN_COLUMNS.queue_jobs, ...RETRY_STATE_MIGRATION_COLUMNS])
    : KNOWN_COLUMNS[table];
/** Every unknown column referenced by the code under test (must stay empty). */
const unknownColumnRefs: string[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let selected = '';
      let inFilter: unknown[] | null = null;
      let orderColumn: string | null = null;
      const unknown: string[] = [];
      const check = (col: string) => {
        const known = knownColumns(table);
        if (known && col !== '*' && !known.has(col)) {
          unknown.push(col);
          unknownColumnRefs.push(`${table}.${col}`);
        }
      };
      const builder: any = {};
      builder.select = (cols: string) => {
        selected = cols;
        if (table === 'campaigns') campaignSelects.push(cols);
        cols.split(',').map((c) => c.trim()).filter(Boolean).forEach(check);
        return builder;
      };
      const forcedError = () => {
        if (unknown.length > 0) return { code: '42703', message: `column ${table}.${unknown[0]} does not exist` };
        if (failingTables.includes(table)) return { code: 'XX000', message: `forced failure on ${table}` };
        if (table === 'campaigns' && selected.includes('execution_status')) {
          if (failExecStatusRead) return { code: 'XX000', message: 'forced execution_status failure' };
          if (execStatusColumnAbsent) return { code: '42703', message: 'column campaigns.execution_status does not exist' };
        }
        return null;
      };
      builder.eq = (col: string) => { check(col); return builder; };
      builder.limit = () => builder;
      builder.order = (col: string) => { check(col); orderColumn = col; return builder; };
      builder.in = (col: string, vals: unknown[]) => { check(col); inFilter = vals; return builder; };
      const rowsFor = (): Row[] => {
        if (table === 'scheduled_posts') {
          const base = inFilter ? postRows.filter((p) => (inFilter as unknown[]).includes(p.id)) : postRows;
          if (orderColumn) {
            const col = orderColumn;
            // ascending, like PostgREST's default; rows use ISO-8601 UTC strings
            return [...base].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')));
          }
          return base;
        }
        if (table === 'daily_content_plans') {
          return inFilter ? planRows.filter((p) => (inFilter as unknown[]).includes(p.execution_id)) : planRows;
        }
        if (table === 'queue_jobs') {
          return inFilter ? queueRows.filter((q) => (inFilter as unknown[]).includes(q.scheduled_post_id)) : queueRows;
        }
        return [];
      };
      builder.maybeSingle = () => {
        const error = forcedError();
        if (error) return Promise.resolve({ data: null, error });
        return Promise.resolve({
          data: table === 'campaigns' ? campaignRow : rowsFor()[0] ?? null,
          error: null,
        });
      };
      builder.then = (res: any) => {
        const error = forcedError();
        return Promise.resolve(error ? { data: null, error } : { data: rowsFor(), error: null }).then(res);
      };
      return builder;
    },
  },
}));

import {
  assertBlueprintActive,
  assertBlueprintMutable,
  isBlueprintMutable,
  getBlueprintBlockReason,
  BlueprintImmutableError,
  BlueprintExecutionFreezeError,
  BlueprintMutabilityReadError,
} from '../../services/campaignBlueprintService';
import { findAbsentColumns } from '../../../lib/campaign/executionStatusCompat';
import { classifyPostQueueJobs } from '../../queue/publishRetryState';
import { supabase } from '../../db/supabaseClient';

const HOURS = 3600000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOURS).toISOString();

beforeEach(() => {
  campaignRow = null;
  postRows = [];
  planRows = [];
  queueRows = [];
  queueRetryStateMigrated = true;
  expectedUnknownRefs = [];
  execStatusColumnAbsent = false;
  failingTables = [];
  failExecStatusRead = false;
  campaignSelects.length = 0;
  delete process.env.BLUEPRINT_PER_ITEM_LOCKS;
});

afterEach(() => {
  // The code under test must never reference a column the real schema lacks.
  // A baseline-mode test may declare the ONE reference it provokes on purpose;
  // nothing else is tolerated.
  const refs = [...unknownColumnRefs].filter((r) => !expectedUnknownRefs.includes(r));
  unknownColumnRefs.length = 0;
  expect(refs).toEqual([]);
});

afterAll(() => { delete process.env.BLUEPRINT_PER_ITEM_LOCKS; });

describe('LEGACY characterization — campaign-wide guard (flag off, the default)', () => {
  it('uninitialized campaigns (no duration) and missing campaigns are mutable', async () => {
    campaignRow = null;
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    campaignRow = { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: null };
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('a genuinely ACTIVE campaign is blanket-immutable (even with zero scheduled posts)', async () => {
    campaignRow = { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    expect(await isBlueprintMutable('c-1')).toBe(false);
    expect(await getBlueprintBlockReason('c-1')).toBe('IMMUTABLE');
  });

  it('a null execution_status is NO SIGNAL, not ACTIVE: only the scheduled-post blanket applies', async () => {
    // Owner decision: a missing lifecycle value is never synthesized into 'ACTIVE'
    // (lib/campaign/executionStatusCompat.ts). Previously this row was blanket-frozen.
    campaignRow = { execution_status: null, blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(100) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    expect(await getBlueprintBlockReason('c-1')).toBe('IMMUTABLE');
  });

  it('non-ACTIVE, non-PAUSED campaigns freeze the moment ANY scheduled post exists', async () => {
    campaignRow = { execution_status: 'COMPLETED', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(100) }]; // far future — still frozen
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    postRows = [];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('PAUSED / INVALIDATED escape the blanket but hit the CAMPAIGN-WIDE 24h window (earliest post)', async () => {
    campaignRow = { execution_status: 'PAUSED', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(100) }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_for: at(2) }, // inside 24h → freezes EVERYTHING
      { id: 'sp-2', status: 'scheduled', scheduled_for: at(100) },
    ];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.freezeWindowHours).toBe(24);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(24);
    expect(await getBlueprintBlockReason('c-1')).toBe('FROZEN');

    campaignRow = { execution_status: 'RUNNING', blueprint_status: 'INVALIDATED', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
  });
});

describe('CANONICAL — per-item lock doctrine (BLUEPRINT_PER_ITEM_LOCKS=true)', () => {
  beforeEach(() => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    // The harshest legacy case: ACTIVE campaign — blanket-frozen under
    // legacy, evaluated per-item under the canonical doctrine.
    campaignRow = { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: 4 };
  });

  it('an ACTIVE campaign with only far-future items is MUTABLE (no blanket freeze)', async () => {
    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_for: at(100) },
      { id: 'sp-2', status: 'scheduled', scheduled_for: at(48) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    expect(await isBlueprintMutable('c-1')).toBe(true);
    expect(await getBlueprintBlockReason('c-1')).toBeNull();
  });

  it('publishing / published items protect the blueprint (IMMUTABLE)', async () => {
    for (const status of ['publishing', 'published']) {
      postRows = [
        { id: 'sp-1', status, scheduled_for: at(-1) },
        { id: 'sp-2', status: 'scheduled', scheduled_for: at(100) },
      ];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
      expect(await getBlueprintBlockReason('c-1')).toBe('IMMUTABLE');
    }
  });

  it('an item inside ITS OWN 24h window freezes (nearest item reported); failed-retryable counts, cancelled never does', async () => {
    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_for: at(2) },
      { id: 'sp-2', status: 'scheduled', scheduled_for: at(10) },
      { id: 'sp-3', status: 'scheduled', scheduled_for: at(100) },
    ];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(2.01); // nearest, not first-row
    expect(err.freezeWindowHours).toBe(24);

    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }]; // past-dated retryable
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);

    postRows = [
      { id: 'sp-1', status: 'cancelled', scheduled_for: at(1) },
      { id: 'sp-2', status: 'draft', scheduled_for: at(1) },
      { id: 'sp-3', status: 'blocked', scheduled_for: at(1) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('scoped operations evaluate ONLY their affectedSlots (unrelated frozen items never block)', async () => {
    planRows = [
      { execution_id: 'ex-frozen', scheduled_post_id: 'sp-frozen' },
      { execution_id: 'ex-free', scheduled_post_id: 'sp-free' },
      { execution_id: 'ex-unscheduled', scheduled_post_id: null },
    ];
    postRows = [
      { id: 'sp-frozen', status: 'scheduled', scheduled_for: at(1) },   // inside window
      { id: 'sp-free', status: 'scheduled', scheduled_for: at(100) },   // far future
    ];

    // Whole-campaign op: the frozen item blocks
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    // Scoped to the free slot: mutable — campaign-level scheduling never freezes unrelated items
    await expect(assertBlueprintMutable('c-1', { affectedSlots: ['ex-free'] })).resolves.toBeUndefined();
    // Scoped to the frozen slot: blocked
    await expect(assertBlueprintMutable('c-1', { affectedSlots: ['ex-frozen'] })).rejects.toThrow(BlueprintExecutionFreezeError);
    // Scoped to a slot with no live item: mutable
    await expect(assertBlueprintMutable('c-1', { affectedSlots: ['ex-unscheduled'] })).resolves.toBeUndefined();
    expect(await isBlueprintMutable('c-1', { affectedSlots: ['ex-free'] })).toBe(true);
  });

  it('uninitialized campaigns stay mutable; zero posts stay mutable; flag OFF restores legacy verbatim', async () => {
    campaignRow = { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: null };
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    campaignRow = { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    postRows = [];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    // Configuration-only switching: same campaign, flag off → legacy blanket
    delete process.env.BLUEPRINT_PER_ITEM_LOCKS;
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
  });
});

describe('FAIL-CLOSED read contract (production shape: execution_status column absent)', () => {
  beforeEach(() => {
    execStatusColumnAbsent = true;
  });

  it('the mandatory campaign read never names an absent column', async () => {
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await assertBlueprintMutable('c-1');
    expect(campaignSelects.length).toBeGreaterThan(0);
    expect(findAbsentColumns(campaignSelects[0])).toEqual([]);
  });

  it('a missing execution_status column does not skip evaluation: posts still decide (legacy)', async () => {
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(100) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
  });

  it('null blueprint_status and absent execution_status are both no signal', async () => {
    campaignRow = { blueprint_status: null, duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('INVALIDATED keeps the 24h freeze rule when execution_status is absent', async () => {
    campaignRow = { blueprint_status: 'INVALIDATED', duration_weeks: 4 };
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(2) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(100) }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('a missing campaign is allowed and is distinguishable from a read failure', async () => {
    campaignRow = null;
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    failingTables = ['campaigns'];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintMutabilityReadError);
    expect(err.code).toBe('BLUEPRINT_STATE_READ_FAILED');
    expect(err.httpStatus).toBe(503);
  });

  it('a genuine (non-42703) execution_status read failure fails closed', async () => {
    execStatusColumnAbsent = false;
    failExecStatusRead = true;
    campaignRow = { execution_status: 'PAUSED', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintMutabilityReadError);
  });

  it('a scheduled_posts read failure fails closed (legacy blanket check)', async () => {
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
    failingTables = ['scheduled_posts'];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintMutabilityReadError);
  });

  it('a freeze-window read failure fails closed (INVALIDATED path)', async () => {
    campaignRow = { blueprint_status: 'INVALIDATED', duration_weeks: 4 };
    failingTables = ['scheduled_posts'];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintMutabilityReadError);
  });

  it('per-item reads fail closed: daily_content_plans (scoped) and scheduled_posts', async () => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };

    failingTables = ['daily_content_plans'];
    await expect(assertBlueprintMutable('c-1', { affectedSlots: ['ex-1'] }))
      .rejects.toThrow(BlueprintMutabilityReadError);

    failingTables = ['scheduled_posts'];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintMutabilityReadError);
  });

  it('per-item doctrine still applies with the column absent (published blocks, recent scheduled freezes, others mutable)', async () => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };

    postRows = [{ id: 'sp-1', status: 'published', scheduled_for: at(-5) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);

    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(3) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);

    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_for: at(100) },
      { id: 'sp-2', status: 'cancelled', scheduled_for: at(1) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('UI helpers stay fail-closed on a read failure, and never report it as a confirmed IMMUTABLE (D4)', async () => {
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
    failingTables = ['scheduled_posts'];
    expect(await isBlueprintMutable('c-1')).toBe(false);
    expect(await getBlueprintBlockReason('c-1')).toBe('UNAVAILABLE');
  });
});

describe('assertBlueprintActive — read contract', () => {
  it('an ACTIVE blueprint passes', async () => {
    campaignRow = { blueprint_status: 'ACTIVE' };
    await expect(assertBlueprintActive('c-1')).resolves.toBeUndefined();
  });

  it('a present non-ACTIVE status keeps its existing policy error', async () => {
    campaignRow = { blueprint_status: 'INVALIDATED' };
    await expect(assertBlueprintActive('c-1')).rejects.toThrow('Blueprint outdated. Regeneration required.');
    await expect(assertBlueprintActive('c-1')).rejects.not.toBeInstanceOf(BlueprintMutabilityReadError);
  });

  it('a null blueprint_status is no signal, not a manufactured ACTIVE or a failure', async () => {
    campaignRow = { blueprint_status: null };
    await expect(assertBlueprintActive('c-1')).resolves.toBeUndefined();
  });

  it('a missing campaign is allowed (callers own the 404)', async () => {
    campaignRow = null;
    await expect(assertBlueprintActive('c-1')).resolves.toBeUndefined();
  });

  it('the absent execution_status column is never read', async () => {
    execStatusColumnAbsent = true;
    campaignRow = { blueprint_status: 'ACTIVE' };
    await expect(assertBlueprintActive('c-1')).resolves.toBeUndefined();
    expect(campaignSelects.every((s) => findAbsentColumns(s).length === 0)).toBe(true);
  });

  it('a genuine read failure fails closed with the typed error', async () => {
    campaignRow = { blueprint_status: 'ACTIVE' };
    failingTables = ['campaigns'];
    const err = await assertBlueprintActive('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintMutabilityReadError);
    expect(err.code).toBe('BLUEPRINT_STATE_READ_FAILED');
    expect(err.httpStatus).toBe(503);
  });
});

describe('SCHEMA — scheduled_posts timestamp is scheduled_for (no scheduled_at column)', () => {
  it('the fake rejects an unknown column exactly like PostgREST (42703)', async () => {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('scheduled_at')
      .eq('campaign_id', 'c-1')
      .maybeSingle();
    expect(data).toBeNull();
    expect(error).toEqual({ code: '42703', message: 'column scheduled_posts.scheduled_at does not exist' });
    expect(unknownColumnRefs).toEqual(['scheduled_posts.scheduled_at']);
    unknownColumnRefs.length = 0; // deliberate in this test only
  });

  it('per-item freeze is evaluated from scheduled_for', async () => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };

    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(3) }];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.hoursUntilExecution).toBeGreaterThan(2.9);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(3);

    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(30) }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('the freeze window uses the EARLIEST scheduled_for, whatever the row order', async () => {
    campaignRow = { blueprint_status: 'INVALIDATED', duration_weeks: 4 };
    postRows = [
      { id: 'sp-late', status: 'scheduled', scheduled_for: at(100) },
      { id: 'sp-soon', status: 'scheduled', scheduled_for: at(5) },
    ];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(5);

    postRows = [{ id: 'sp-late', status: 'scheduled', scheduled_for: at(100) }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });
});

describe('CHARACTERIZATION — how current rules treat each post category (policy NOT decided here)', () => {
  it('per-item: past scheduled/failed items freeze regardless of age; other non-published statuses never block', async () => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };

    for (const [status, hoursFromNow] of [
      ['failed', -2], ['failed', -200], ['scheduled', -2], ['scheduled', -200],
    ] as const) {
      postRows = [{ id: 'sp-1', status, scheduled_for: at(hoursFromNow) }];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    }
    for (const status of ['cancelled', 'draft', 'blocked']) {
      postRows = [{ id: 'sp-1', status, scheduled_for: at(-200) }];
      await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    }
  });

  it('legacy freeze window ignores a past PUBLISHED post (D2): only protecting statuses are candidates', async () => {
    // Was: the earliest post of ANY status froze the campaign, so one old
    // published post froze an INVALIDATED campaign forever.
    campaignRow = { blueprint_status: 'INVALIDATED', duration_weeks: 4 };
    postRows = [
      { id: 'sp-old', status: 'published', scheduled_for: at(-500) },
      { id: 'sp-new', status: 'scheduled', scheduled_for: at(100) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — retry-aware protecting-status policy (owner decisions D1–D4)
//
//   publishing / published → protect (per-item: IMMUTABLE; legacy freeze: not
//                            published — D2)
//   scheduled              → protects (per-item: inside its own 24h window,
//                            overdue included)
//   failed                 → protects unless ALL its queue_jobs rows show the
//                            publish pipeline terminally done with it; no rows
//                            is UNKNOWN and protects (D1)
//   cancelled/draft/blocked → never protect on their own
// ─────────────────────────────────────────────────────────────────────────────

const qj = (postId: string, status: unknown, retryState?: unknown): Row =>
  retryState === undefined
    ? { scheduled_post_id: postId, status }
    : { scheduled_post_id: postId, status, retry_state: retryState };

describe('STEP 4 — classifyPostQueueJobs (pure)', () => {
  const cases: Array<[string, Row[], 'LIVE' | 'UNKNOWN' | 'TERMINAL']> = [
    ['no rows (D1 — e.g. a failed thread child)', [], 'UNKNOWN'],
    ['pending', [qj('p', 'pending', null)], 'LIVE'],
    ['processing', [qj('p', 'processing', null)], 'LIVE'],
    ['failed + awaiting_retry', [qj('p', 'failed', 'awaiting_retry')], 'LIVE'],
    ['failed + exhausted', [qj('p', 'failed', 'exhausted')], 'TERMINAL'],
    ['failed + NULL (legacy)', [qj('p', 'failed', null)], 'UNKNOWN'],
    ['failed, column absent (pre-migration row shape)', [qj('p', 'failed')], 'UNKNOWN'],
    ['failed + unrecognised state', [qj('p', 'failed', 'retrying')], 'UNKNOWN'],
    ['cancelled', [qj('p', 'cancelled', null)], 'TERMINAL'],
    ['completed', [qj('p', 'completed', null)], 'TERMINAL'],
    ['unrecognised status', [qj('p', 'poisoned', null)], 'UNKNOWN'],
    ['NULL status', [qj('p', null, null)], 'UNKNOWN'],
    ['exhausted + cancelled + completed', [qj('p', 'failed', 'exhausted'), qj('p', 'cancelled', null), qj('p', 'completed', null)], 'TERMINAL'],
    ['exhausted + legacy NULL (one exhausted row is not enough)', [qj('p', 'failed', 'exhausted'), qj('p', 'failed', null)], 'UNKNOWN'],
    ['exhausted + awaiting_retry', [qj('p', 'failed', 'exhausted'), qj('p', 'failed', 'awaiting_retry')], 'LIVE'],
    ['exhausted + pending', [qj('p', 'failed', 'exhausted'), qj('p', 'pending', null)], 'LIVE'],
    ['legacy NULL + pending (live wins)', [qj('p', 'failed', null), qj('p', 'pending', null)], 'LIVE'],
  ];
  it.each(cases)('%s', (_label, rows, expected) => {
    expect(classifyPostQueueJobs(rows)).toBe(expected);
  });
});

describe('STEP 4 — per-item rule (BLUEPRINT_PER_ITEM_LOCKS=true)', () => {
  beforeEach(() => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
  });

  it('a failed post inside its window is non-blocking ONLY when terminal', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];

    queueRows = [qj('sp-1', 'failed', 'exhausted')];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    queueRows = [qj('sp-1', 'failed', 'exhausted'), qj('sp-1', 'cancelled', null), qj('sp-1', 'completed', null)];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    for (const rows of [
      [qj('sp-1', 'failed', 'awaiting_retry')],                     // LIVE
      [qj('sp-1', 'pending', null)],                                // LIVE
      [qj('sp-1', 'failed', null)],                                 // legacy UNKNOWN
      [],                                                           // no rows — UNKNOWN (D1)
      [qj('sp-1', 'failed', 'exhausted'), qj('sp-1', 'failed', null)], // mixed — UNKNOWN
      [qj('sp-1', 'failed', 'exhausted'), qj('sp-1', 'processing', null)], // mixed — LIVE
      [qj('sp-1', 'mystery', null)],                                // unrecognised — UNKNOWN
    ]) {
      queueRows = rows;
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    }
  });

  it("other posts' queue rows never classify this post", async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    queueRows = [qj('sp-OTHER', 'failed', 'exhausted')];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
  });

  it('a failed post beyond its window does not block, whatever its retry state', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(100) }];
    queueRows = [qj('sp-1', 'failed', 'awaiting_retry')];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('scheduled: within 24h and overdue freeze; beyond 24h does not', async () => {
    for (const h of [23, 1, -1, -500]) {
      postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(h) }];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    }
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_for: at(25) }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('published / publishing stay IMMUTABLE even beside a terminal failure; cancelled/draft/blocked never block', async () => {
    for (const status of ['published', 'publishing']) {
      postRows = [
        { id: 'sp-1', status, scheduled_for: at(-200) },
        { id: 'sp-2', status: 'failed', scheduled_for: at(-2) },
      ];
      queueRows = [qj('sp-2', 'failed', 'exhausted')];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    }
    postRows = ['cancelled', 'draft', 'blocked'].map((status, i) => ({ id: `sp-${i}`, status, scheduled_for: at(-2) }));
    queueRows = [];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('the reported hours come from the nearest PROTECTING post, never from a terminal failure', async () => {
    postRows = [
      { id: 'sp-term', status: 'failed', scheduled_for: at(-10) },
      { id: 'sp-sched', status: 'scheduled', scheduled_for: at(5) },
    ];
    queueRows = [qj('sp-term', 'failed', 'exhausted')];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.hoursUntilExecution).toBeGreaterThan(4.9);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(5);
  });

  it('BASELINE schema (retry_state absent): every failed post in its window is UNKNOWN and blocks', async () => {
    queueRetryStateMigrated = false;
    expectedUnknownRefs = ['queue_jobs.retry_state'];
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    queueRows = [qj('sp-1', 'failed')];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
  });

  it('a genuine queue_jobs read failure fails closed with the typed 503 error', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    failingTables = ['queue_jobs'];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintMutabilityReadError);
    expect(err.httpStatus).toBe(503);
    expect(err.source).toBe('queue_jobs');
    expect(await getBlueprintBlockReason('c-1')).toBe('UNAVAILABLE');
    expect(await isBlueprintMutable('c-1')).toBe(false);
  });
});

describe('STEP 4 — legacy blanket (flag off; not INVALIDATED, not PAUSED)', () => {
  beforeEach(() => {
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
  });

  it('REGRESSION: historical cancelled / draft / blocked posts no longer make the campaign immutable (D3)', async () => {
    postRows = [
      { id: 'sp-1', status: 'cancelled', scheduled_for: at(-500) },
      { id: 'sp-2', status: 'draft', scheduled_for: at(-400) },
      { id: 'sp-3', status: 'blocked', scheduled_for: at(-300) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    expect(await getBlueprintBlockReason('c-1')).toBeNull();
  });

  it('scheduled (any time), publishing and published protect — campaign-wide, no window', async () => {
    for (const [status, h] of [['scheduled', 500], ['scheduled', -5], ['publishing', -1], ['published', -500]] as const) {
      postRows = [
        { id: 'sp-1', status, scheduled_for: at(h) },
        { id: 'sp-2', status: 'cancelled', scheduled_for: at(-1) },
      ];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    }
  });

  it('a failed post protects unless terminal (no window in the blanket rule)', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(500) }];

    queueRows = [qj('sp-1', 'failed', 'exhausted'), qj('sp-1', 'cancelled', null)];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    for (const rows of [[], [qj('sp-1', 'failed', null)], [qj('sp-1', 'failed', 'awaiting_retry')], [qj('sp-1', 'failed', 'exhausted'), qj('sp-1', 'failed', null)]]) {
      queueRows = rows;
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    }
  });

  it('BASELINE schema: a failed post is UNKNOWN and keeps the campaign immutable', async () => {
    queueRetryStateMigrated = false;
    expectedUnknownRefs = ['queue_jobs.retry_state'];
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-50) }];
    queueRows = [qj('sp-1', 'failed')];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
  });

  it('a queue_jobs read failure fails closed (typed 503), never "no rows"', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-50) }];
    failingTables = ['queue_jobs'];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintMutabilityReadError);
    expect(await getBlueprintBlockReason('c-1')).toBe('UNAVAILABLE');
  });
});

describe('STEP 4 — legacy freeze window (PAUSED and INVALIDATED share it)', () => {
  const escapes: Array<[string, Row]> = [
    ['INVALIDATED', { blueprint_status: 'INVALIDATED', duration_weeks: 4 }],
    ['PAUSED', { execution_status: 'PAUSED', blueprint_status: 'ACTIVE', duration_weeks: 4 }],
  ];

  it.each(escapes)('%s — REGRESSION: historical published / cancelled / draft / blocked posts never freeze', async (_l, campaign) => {
    campaignRow = campaign;
    postRows = ['published', 'cancelled', 'draft', 'blocked'].map((status, i) => ({ id: `sp-${i}`, status, scheduled_for: at(-500 + i) }));
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it.each(escapes)('%s — scheduled and publishing inside 24h (overdue included) freeze', async (_l, campaign) => {
    campaignRow = campaign;
    for (const [status, h] of [['scheduled', 3], ['scheduled', -3], ['publishing', -1]] as const) {
      postRows = [{ id: 'sp-1', status, scheduled_for: at(h) }];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    }
  });

  it.each(escapes)('%s — a failed post freezes unless terminal; beyond the window it never does', async (_l, campaign) => {
    campaignRow = campaign;
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];

    queueRows = [qj('sp-1', 'failed', 'exhausted')];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    for (const rows of [[], [qj('sp-1', 'failed', null)], [qj('sp-1', 'failed', 'awaiting_retry')]]) {
      queueRows = rows;
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    }

    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(100) }];
    queueRows = [];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it.each(escapes)('%s — the earliest PROTECTING post decides, not the earliest row', async (_l, campaign) => {
    campaignRow = campaign;
    postRows = [
      { id: 'sp-pub', status: 'published', scheduled_for: at(-500) },
      { id: 'sp-term', status: 'failed', scheduled_for: at(-100) },
      { id: 'sp-soon', status: 'scheduled', scheduled_for: at(6) },
    ];
    queueRows = [qj('sp-term', 'failed', 'exhausted')];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.hoursUntilExecution).toBeGreaterThan(5.9);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(6);
  });

  it.each(escapes)('%s — BASELINE schema: a failed post in the window is UNKNOWN and freezes', async (_l, campaign) => {
    campaignRow = campaign;
    queueRetryStateMigrated = false;
    expectedUnknownRefs = ['queue_jobs.retry_state'];
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    queueRows = [qj('sp-1', 'failed')];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
  });

  it.each(escapes)('%s — read failures fail closed with the same typed error', async (_l, campaign) => {
    campaignRow = campaign;
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    for (const table of ['queue_jobs', 'scheduled_posts']) {
      failingTables = [table];
      const err = await assertBlueprintMutable('c-1').catch((e) => e);
      expect(err).toBeInstanceOf(BlueprintMutabilityReadError);
      expect(err.source).toBe(table);
    }
  });
});

describe('STEP 4 — an unrecognised or NULL post status is UNKNOWN and protects (fail-safe)', () => {
  // scheduled_posts.status is CHECK-constrained but NULLABLE.
  for (const status of [null, 'archived']) {
    it(`per-item: status ${String(status)} inside its window freezes; beyond it does not`, async () => {
      process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
      campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
      postRows = [{ id: 'sp-1', status, scheduled_for: at(-2) }];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
      postRows = [{ id: 'sp-1', status, scheduled_for: at(100) }];
      await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    });

    it(`legacy blanket: status ${String(status)} keeps the campaign immutable`, async () => {
      campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
      postRows = [{ id: 'sp-1', status, scheduled_for: at(-200) }];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    });

    it(`legacy freeze: status ${String(status)} inside the window freezes`, async () => {
      campaignRow = { blueprint_status: 'INVALIDATED', duration_weeks: 4 };
      postRows = [{ id: 'sp-1', status, scheduled_for: at(-2) }];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    });
  }
});

// ─── Workstream C — an uncertain publish outcome is never TERMINAL ───────────
//
// A queue row the worker recorded as PUBLISH_OUTCOME_UNCERTAIN carries
// retry_state='exhausted' (it must never be retried automatically), yet the
// post may already be live on the platform. The guard must keep protecting it.

const qjc = (postId: string, status: unknown, retryState: unknown, errorCode: unknown): Row =>
  ({ scheduled_post_id: postId, status, retry_state: retryState, error_code: errorCode });

describe('Workstream C — classifyPostQueueJobs and PUBLISH_OUTCOME_UNCERTAIN', () => {
  const cases: Array<[string, Row[], 'LIVE' | 'UNKNOWN' | 'TERMINAL']> = [
    ['failed + exhausted + uncertain', [qjc('p', 'failed', 'exhausted', 'PUBLISH_OUTCOME_UNCERTAIN')], 'UNKNOWN'],
    ['failed + uncertain, column absent (mixed version)', [{ scheduled_post_id: 'p', status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }], 'UNKNOWN'],
    ['failed + exhausted + a KNOWN platform error stays terminal', [qjc('p', 'failed', 'exhausted', 'RATE_LIMITED')], 'TERMINAL'],
    ['failed + exhausted + NULL error_code stays terminal', [qjc('p', 'failed', 'exhausted', null)], 'TERMINAL'],
    ['uncertain beside terminal rows still UNKNOWN', [qjc('p', 'failed', 'exhausted', 'PUBLISH_OUTCOME_UNCERTAIN'), qj('p', 'completed', null)], 'UNKNOWN'],
    ['uncertain beside a live row is LIVE', [qjc('p', 'failed', 'exhausted', 'PUBLISH_OUTCOME_UNCERTAIN'), qj('p', 'pending', null)], 'LIVE'],
  ];
  it.each(cases)('%s', (_label, rows, expected) => {
    expect(classifyPostQueueJobs(rows)).toBe(expected);
  });
});

describe('Workstream C — the per-item guard protects an uncertain post', () => {
  beforeEach(() => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
  });

  it('a failed post whose only queue row is exhausted-but-uncertain freezes the blueprint', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    queueRows = [qjc('sp-1', 'failed', 'exhausted', 'PUBLISH_OUTCOME_UNCERTAIN')];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
  });

  it('the same row with a known platform failure is terminal and does not block', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3) }];
    queueRows = [qjc('sp-1', 'failed', 'exhausted', 'RATE_LIMITED')];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });
});

// ─── Closure-002 — the post's OWN uncertain outcome protects ────────────────
//
// An exhausted queue row is TERMINAL for the pipeline, not proof that nothing
// was published. A failed post whose own row says the outcome is uncertain
// (or still carries the platform-call marker) may be live, so it protects.

describe('Closure-002 — a failed post with an uncertain outcome protects whatever its queue rows say', () => {
  beforeEach(() => {
    process.env.BLUEPRINT_PER_ITEM_LOCKS = 'true';
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
  });

  it.each(['PUBLISH_OUTCOME_UNCERTAIN', 'PUBLISH_CALL_STARTED'])(
    'per-item: failed + %s with a TERMINAL queue row freezes the blueprint',
    async (code) => {
      postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3), error_code: code, platform_post_id: null }];
      queueRows = [qj('sp-1', 'failed', 'exhausted')];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    },
  );

  it('per-item: the same post reconciled as not published is terminal again', async () => {
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(-3), error_code: 'PUBLISH_RECONCILED_NOT_PUBLISHED', platform_post_id: null }];
    queueRows = [qj('sp-1', 'failed', 'exhausted')];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('legacy blanket (flag off): an uncertain failed post with terminal queue rows protects; a known failure does not', async () => {
    delete process.env.BLUEPRINT_PER_ITEM_LOCKS;
    queueRows = [qj('sp-1', 'failed', 'exhausted'), qj('sp-1', 'cancelled', null)];

    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(500), error_code: 'LINKEDIN_RATE_LIMIT', platform_post_id: null }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    postRows = [{ id: 'sp-1', status: 'failed', scheduled_for: at(500), error_code: 'PUBLISH_OUTCOME_UNCERTAIN', platform_post_id: null }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
  });
});
