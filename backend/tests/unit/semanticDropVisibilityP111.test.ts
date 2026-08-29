/**
 * Phase 111 — SEMANTIC DROP VISIBILITY.
 *
 * A plan row lost to the semantic-validation gate must say so on the row:
 *   failure_type   = 'semantic_validation'
 *   failure_reason = the actual validation reason
 *
 * and it must cost nothing:
 *   - the accepted sibling row is never annotated;
 *   - the annotation never writes `content` or `content_status` (planner-owned);
 *   - it is guarded on scheduled_post_id IS NULL, so losing a compare-and-swap
 *     against a worker that already scheduled the row changes nothing;
 *   - an annotation failure is non-fatal — the campaign still schedules the
 *     rows it accepted.
 */

type Row = Record<string, unknown>;

const scheduledPostInserts: Row[] = [];
/** Every daily_content_plans UPDATE, with the filters it was scoped by. */
const planWrites: Array<{ payload: Row; filters: string[] }> = [];
let insertCounter = 0;
let annotationThrows = false;
/** Rows the CAS should treat as already scheduled (scheduled_post_id NOT NULL). */
const alreadyScheduled = new Set<string>();

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'scheduled_posts') {
        return {
          insert: (payload: Row) => {
            insertCounter += 1;
            scheduledPostInserts.push(payload);
            return { select: () => ({ maybeSingle: async () => ({ data: { id: `sp-${insertCounter}` }, error: null }) }) };
          },
        };
      }
      if (table === 'daily_content_plans') {
        return {
          update: (payload: Row) => {
            const filters: string[] = [];
            const write = { payload, filters };
            const chain: Record<string, unknown> = {
              eq: (col: string, val: unknown) => { filters.push(`eq:${col}=${String(val)}`); return chain; },
              is: (col: string, val: unknown) => { filters.push(`is:${col}=${String(val)}`); return chain; },
              // Awaited at the end of the chain — records the write unless the
              // CAS excluded the row or the store is simulating a failure.
              then: (resolve: (v: { error: null }) => unknown) => {
                // Only the annotation is made to fail — the ordinary finalized
                // write-back must stay healthy or the test proves nothing.
                if (annotationThrows && 'failure_type' in payload) throw new Error('daily_content_plans update exploded');
                const casNull = filters.includes('is:scheduled_post_id=null');
                const target = filters.find((f) => f.startsWith('eq:id='))?.slice('eq:id='.length) ?? '';
                if (!(casNull && alreadyScheduled.has(target))) planWrites.push(write);
                return resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === 'blogs') return { insert: async () => ({ error: null }) };
      if (table === 'campaigns') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: 'co-1' } }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async () => undefined),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async () => ({
    id: 'master-gen',
    generated_at: '2026-07-12T00:00:00.000Z',
    content: 'Identical master body for both rows.',
    generation_status: 'generated',
    generation_source: 'ai',
  })),
  buildPlatformVariantsFromMaster: jest.fn(async () => ([
    { platform: 'linkedin', content_type: 'post', generated_content: 'Identical LinkedIn body.', generation_status: 'generated' },
  ])),
}));

jest.mock('../../services/creator/governanceItemEnricher', () => ({
  enrichItemWithGovernance: jest.fn(async (item: unknown) => item),
}));

jest.mock('../../services/campaign/plannerMetrics', () => ({
  emitPlannerDrop: jest.fn(),
  emitLifecycleTransition: jest.fn(),
}));

import { processBlockSchedule } from '../../services/boltScheduleBlockProcessor';

const CAMPAIGN = { start_date: '2099-01-04', user_id: 'user-1', company_id: 'co-1' };
const ACCOUNTS = new Map([['linkedin', 'acct-li']]);
const normalize = (p: string) => (p === 'linkedin' ? 'linkedin' : null);

/** Two rows of ONE card on the SAME platform+type ⇒ the second is a genuine
 *  duplicate_asset and is dropped by the gate. */
const dupRows = (): Row[] => ([
  {
    id: 'row-keep', campaign_id: 'camp-1', week_number: 1, day_of_week: 'Monday',
    date: '2099-01-04', platform: 'linkedin', content_type: 'post',
    title: 'Kickoff topic', topic: 'Kickoff topic', scheduled_time: '09:00',
    content: JSON.stringify({ execution_id: 'ex-1', topic: 'Kickoff topic' }),
  },
  {
    id: 'row-dropped', campaign_id: 'camp-1', week_number: 1, day_of_week: 'Wednesday',
    date: '2099-01-06', platform: 'linkedin', content_type: 'post',
    title: 'Kickoff topic', topic: 'Kickoff topic', scheduled_time: '09:00',
    content: JSON.stringify({ execution_id: 'ex-1', topic: 'Kickoff topic' }),
  },
]);

const run = (rows: Row[]) => processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});

/** Only the Phase 111 annotation writes failure_type. */
const annotations = () => planWrites.filter((w) => 'failure_type' in w.payload);

beforeEach(() => {
  jest.clearAllMocks();
  scheduledPostInserts.length = 0;
  planWrites.length = 0;
  insertCounter = 0;
  annotationThrows = false;
  alreadyScheduled.clear();
});

describe('Phase 111 — semantic drops are visible on the plan row', () => {
  test('the dropped row is annotated with the semantic reason', async () => {
    const result = await run(dupRows());

    expect(result.skipped_count).toBe(1);
    expect(scheduledPostInserts).toHaveLength(1);

    const notes = annotations();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.payload.failure_type).toBe('semantic_validation');
    // The ACTUAL validation reason — a real `dimension: detail` verdict string,
    // never a generic label. Which dimension fires first is the validator's
    // business (and differs by scoping strategy), so this pins the contract D3
    // owns: the verdict's own reason reaches the row intact.
    const reason = String(notes[0]!.payload.failure_reason);
    expect(reason).toMatch(/^(duplicate_(headline|opening|cta|asset|slide|semantic_idea|narrative)|cross_platform_duplication|historical_duplication|master_idea_consistency): .+/);
    expect(reason).not.toBe('semantic validation drop'); // not the fallback
    expect(notes[0]!.filters).toContain('eq:id=row-dropped');
  });

  test('the accepted row is never annotated', async () => {
    await run(dupRows());

    for (const note of annotations()) {
      expect(note.filters).not.toContain('eq:id=row-keep');
    }
  });

  test('the annotation never rewrites planner-owned fields', async () => {
    await run(dupRows());

    const payload = annotations()[0]!.payload;
    expect(payload).not.toHaveProperty('content');
    expect(payload).not.toHaveProperty('content_status');
    expect(payload).not.toHaveProperty('status');
    // No false success: it must never claim a scheduled post.
    expect(payload).not.toHaveProperty('scheduled_post_id');
    expect(Object.keys(payload).sort()).toEqual(['failure_reason', 'failure_type', 'updated_at']);
  });

  test('it is compare-and-swap guarded on scheduled_post_id IS NULL', async () => {
    await run(dupRows());

    expect(annotations()[0]!.filters).toContain('is:scheduled_post_id=null');
  });

  test('losing the CAS to a worker that already scheduled the row changes nothing', async () => {
    // Another worker scheduled row-dropped between our read and our write.
    alreadyScheduled.add('row-dropped');

    const result = await run(dupRows());

    // The guarded update matches zero rows — no annotation, nothing destroyed.
    expect(annotations()).toHaveLength(0);
    // And the campaign is otherwise unaffected.
    expect(result.skipped_count).toBe(1);
    expect(scheduledPostInserts).toHaveLength(1);
  });

  test('an annotation failure is non-fatal — the accepted row still schedules', async () => {
    annotationThrows = true;

    const result = await run(dupRows());

    expect(result.scheduled_count).toBe(1);
    expect(result.skipped_count).toBe(1);
    expect(scheduledPostInserts).toHaveLength(1);
  });
});
