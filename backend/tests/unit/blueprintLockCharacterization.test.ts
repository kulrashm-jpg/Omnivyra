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
/** Production shape: the optional `campaigns.execution_status` column is absent (42703). */
let execStatusColumnAbsent = false;
/** Tables whose reads fail with a genuine database error. */
let failingTables: string[] = [];
/** Fail only the optional execution_status read with a genuine (non-42703) error. */
let failExecStatusRead = false;
/** Every select list issued against `campaigns`. */
const campaignSelects: string[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let selected = '';
      let inFilter: unknown[] | null = null;
      const builder: any = {};
      builder.select = (cols: string) => {
        selected = cols;
        if (table === 'campaigns') campaignSelects.push(cols);
        return builder;
      };
      const forcedError = () => {
        if (failingTables.includes(table)) return { code: 'XX000', message: `forced failure on ${table}` };
        if (table === 'campaigns' && selected.includes('execution_status')) {
          if (failExecStatusRead) return { code: 'XX000', message: 'forced execution_status failure' };
          if (execStatusColumnAbsent) return { code: '42703', message: 'column campaigns.execution_status does not exist' };
        }
        return null;
      };
      for (const op of ['eq', 'order', 'limit']) builder[op] = () => builder;
      builder.in = (_col: string, vals: unknown[]) => { inFilter = vals; return builder; };
      const rowsFor = (): Row[] => {
        if (table === 'scheduled_posts') {
          const base = inFilter ? postRows.filter((p) => (inFilter as unknown[]).includes(p.id)) : postRows;
          if (selected.includes('scheduled_at') && !selected.includes('status')) {
            // legacy earliest-post query — emulate order by scheduled_at asc
            return [...base].sort((a, b) => String(a.scheduled_at ?? '').localeCompare(String(b.scheduled_at ?? '')));
          }
          return base;
        }
        if (table === 'daily_content_plans') {
          return inFilter ? planRows.filter((p) => (inFilter as unknown[]).includes(p.execution_id)) : planRows;
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
  assertBlueprintMutable,
  isBlueprintMutable,
  getBlueprintBlockReason,
  BlueprintImmutableError,
  BlueprintExecutionFreezeError,
  BlueprintMutabilityReadError,
} from '../../services/campaignBlueprintService';
import { findAbsentColumns } from '../../../lib/campaign/executionStatusCompat';

const HOURS = 3600000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOURS).toISOString();

beforeEach(() => {
  campaignRow = null;
  postRows = [];
  planRows = [];
  execStatusColumnAbsent = false;
  failingTables = [];
  failExecStatusRead = false;
  campaignSelects.length = 0;
  delete process.env.BLUEPRINT_PER_ITEM_LOCKS;
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
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_at: at(100) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    expect(await getBlueprintBlockReason('c-1')).toBe('IMMUTABLE');
  });

  it('non-ACTIVE, non-PAUSED campaigns freeze the moment ANY scheduled post exists', async () => {
    campaignRow = { execution_status: 'COMPLETED', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_at: at(100) }]; // far future — still frozen
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    postRows = [];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('PAUSED / INVALIDATED escape the blanket but hit the CAMPAIGN-WIDE 24h window (earliest post)', async () => {
    campaignRow = { execution_status: 'PAUSED', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_at: at(100) }];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();

    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_at: at(2) }, // inside 24h → freezes EVERYTHING
      { id: 'sp-2', status: 'scheduled', scheduled_at: at(100) },
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
      { id: 'sp-1', status: 'scheduled', scheduled_at: at(100) },
      { id: 'sp-2', status: 'scheduled', scheduled_at: at(48) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
    expect(await isBlueprintMutable('c-1')).toBe(true);
    expect(await getBlueprintBlockReason('c-1')).toBeNull();
  });

  it('publishing / published items protect the blueprint (IMMUTABLE)', async () => {
    for (const status of ['publishing', 'published']) {
      postRows = [
        { id: 'sp-1', status, scheduled_at: at(-1) },
        { id: 'sp-2', status: 'scheduled', scheduled_at: at(100) },
      ];
      await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
      expect(await getBlueprintBlockReason('c-1')).toBe('IMMUTABLE');
    }
  });

  it('an item inside ITS OWN 24h window freezes (nearest item reported); failed-retryable counts, cancelled never does', async () => {
    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_at: at(2) },
      { id: 'sp-2', status: 'scheduled', scheduled_at: at(10) },
      { id: 'sp-3', status: 'scheduled', scheduled_at: at(100) },
    ];
    const err = await assertBlueprintMutable('c-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintExecutionFreezeError);
    expect(err.hoursUntilExecution).toBeLessThanOrEqual(2.01); // nearest, not first-row
    expect(err.freezeWindowHours).toBe(24);

    postRows = [{ id: 'sp-1', status: 'failed', scheduled_at: at(-3) }]; // past-dated retryable
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);

    postRows = [
      { id: 'sp-1', status: 'cancelled', scheduled_at: at(1) },
      { id: 'sp-2', status: 'draft', scheduled_at: at(1) },
      { id: 'sp-3', status: 'blocked', scheduled_at: at(1) },
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
      { id: 'sp-frozen', status: 'scheduled', scheduled_at: at(1) },   // inside window
      { id: 'sp-free', status: 'scheduled', scheduled_at: at(100) },   // far future
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
    postRows = [{ id: 'sp-1', status: 'failed', scheduled_at: at(100) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
  });

  it('null blueprint_status and absent execution_status are both no signal', async () => {
    campaignRow = { blueprint_status: null, duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('INVALIDATED keeps the 24h freeze rule when execution_status is absent', async () => {
    campaignRow = { blueprint_status: 'INVALIDATED', duration_weeks: 4 };
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_at: at(2) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);
    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_at: at(100) }];
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

    postRows = [{ id: 'sp-1', status: 'published', scheduled_at: at(-5) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);

    postRows = [{ id: 'sp-1', status: 'scheduled', scheduled_at: at(3) }];
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintExecutionFreezeError);

    postRows = [
      { id: 'sp-1', status: 'scheduled', scheduled_at: at(100) },
      { id: 'sp-2', status: 'cancelled', scheduled_at: at(1) },
    ];
    await expect(assertBlueprintMutable('c-1')).resolves.toBeUndefined();
  });

  it('UI helpers stay fail-closed on a read failure', async () => {
    campaignRow = { blueprint_status: 'ACTIVE', duration_weeks: 4 };
    failingTables = ['scheduled_posts'];
    expect(await isBlueprintMutable('c-1')).toBe(false);
    expect(await getBlueprintBlockReason('c-1')).toBe('IMMUTABLE');
  });
});
