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

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let selected = '';
      let inFilter: unknown[] | null = null;
      const builder: any = {};
      builder.select = (cols: string) => { selected = cols; return builder; };
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
      builder.maybeSingle = () =>
        Promise.resolve({
          data: table === 'campaigns' ? campaignRow : rowsFor()[0] ?? null,
          error: null,
        });
      builder.then = (res: any) => Promise.resolve({ data: rowsFor(), error: null }).then(res);
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
} from '../../services/campaignBlueprintService';

const HOURS = 3600000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOURS).toISOString();

beforeEach(() => {
  campaignRow = null;
  postRows = [];
  planRows = [];
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

  it('ACTIVE campaigns are blanket-immutable (even with zero scheduled posts)', async () => {
    campaignRow = { execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    // null execution_status defaults to ACTIVE — same blanket freeze
    campaignRow = { execution_status: null, blueprint_status: 'ACTIVE', duration_weeks: 4 };
    await expect(assertBlueprintMutable('c-1')).rejects.toThrow(BlueprintImmutableError);
    expect(await isBlueprintMutable('c-1')).toBe(false);
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
