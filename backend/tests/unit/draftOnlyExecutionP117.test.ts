/**
 * PHASE 117 — draft-only campaign execution.
 *
 * Campaign generation was hardwired to `status: 'scheduled'` + enqueue, so there
 * was no way to exercise the real pipeline in production without publishing to a
 * real audience. That blocked runtime verification of the canonical content
 * bridge (B4.1).
 *
 * Draft-only runs the SAME pipeline — same AI calls, same semantic gate, same
 * canonical bridge — behind two independent guards:
 *   1. the row is written 'draft', which the publisher's `status = 'scheduled'`
 *      query never selects;
 *   2. enqueueScheduledPostAt is skipped.
 *
 * The point of the mode is that everything EXCEPT publication still happens, so
 * these tests pin that too — a draft-only run that also skipped generation would
 * prove nothing about production.
 */

type Row = Record<string, unknown>;

const scheduledPostInserts: Row[] = [];
const enqueueCalls: unknown[][] = [];
let insertCounter = 0;

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
        // Supports both shapes the processor uses: the finalized write-back
        // (`.update().eq().then()`) and the semantic-drop annotation
        // (`.update().eq().is()`).
        const chain: Record<string, unknown> = {
          eq: () => chain,
          is: () => chain,
          then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
        };
        return { update: () => chain };
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
  enqueueScheduledPostAt: jest.fn(async (...args: unknown[]) => { enqueueCalls.push(args); }),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async () => ({
    id: 'master-gen',
    generated_at: '2026-07-12T00:00:00.000Z',
    content: 'Generated master body with a hook and a CTA.',
    generation_status: 'generated',
    generation_source: 'ai',
  })),
  buildPlatformVariantsFromMaster: jest.fn(async () => ([
    { platform: 'linkedin', content_type: 'post', generated_content: 'LinkedIn-native variant body.', generation_status: 'generated' },
  ])),
}));

jest.mock('../../services/creator/governanceItemEnricher', () => ({
  enrichItemWithGovernance: jest.fn(async (item: unknown) => item),
}));

jest.mock('../../services/campaign/plannerMetrics', () => ({
  emitPlannerDrop: jest.fn(),
  emitLifecycleTransition: jest.fn(),
}));

jest.mock('../../services/content/contentService', () => ({ createContent: jest.fn() }));

import { processBlockSchedule } from '../../services/boltScheduleBlockProcessor';
import { enqueueScheduledPostAt } from '../../scheduler/schedulerService';
import { generateMasterContentFromIntent } from '../../services/contentGenerationPipeline';
import { createContent } from '../../services/content/contentService';

const mockedEnqueue = enqueueScheduledPostAt as jest.MockedFunction<typeof enqueueScheduledPostAt>;
const mockedMaster = generateMasterContentFromIntent as jest.Mock;
const mockedCreateContent = createContent as jest.MockedFunction<typeof createContent>;

const CAMPAIGN = { start_date: '2099-01-04', user_id: 'user-1', company_id: 'co-1' };
const ACCOUNTS = new Map([['linkedin', 'acct-li']]);
const normalize = (p: string) => (p === 'linkedin' ? 'linkedin' : null);
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const row = (): Row => ({
  id: 'row-1',
  campaign_id: 'camp-1',
  week_number: 1,
  day_of_week: 'Monday',
  date: '2099-01-04',
  platform: 'linkedin',
  content_type: 'post',
  title: 'Kickoff topic',
  topic: 'Kickoff topic',
  scheduled_time: '09:00',
  content: JSON.stringify({ execution_id: 'ex-1', topic: 'Kickoff topic' }),
});

// options is the SEVENTH parameter; typeMapByPlatform is the sixth.
const run = (opts: Record<string, unknown>) =>
  processBlockSchedule('camp-1', [row()] as never, CAMPAIGN, ACCOUNTS, normalize, {} as never, opts as never);

beforeEach(() => {
  jest.clearAllMocks();
  scheduledPostInserts.length = 0;
  enqueueCalls.length = 0;
  insertCounter = 0;
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  mockedCreateContent.mockResolvedValue({ id: 'content-1' } as never);
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

describe('P117 — normal execution is unchanged', () => {
  test('no draftOnly ⇒ status scheduled and the post is enqueued', async () => {
    const result = await run({});

    expect(result.scheduled_count).toBe(1);
    expect(scheduledPostInserts[0]!.status).toBe('scheduled');
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  });

  test('draftOnly:false is treated exactly as absent', async () => {
    await run({ draftOnly: false });

    expect(scheduledPostInserts[0]!.status).toBe('scheduled');
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  });

  test('only an explicit true enables it — truthy strings do not', async () => {
    await run({ draftOnly: 'yes' });

    expect(scheduledPostInserts[0]!.status).toBe('scheduled');
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  });
});

describe('P117 — draft-only cannot publish', () => {
  test('GUARD 1: the row is written with an unpublishable status', async () => {
    await run({ draftOnly: true });

    expect(scheduledPostInserts).toHaveLength(1);
    // The publisher selects `status = 'scheduled'`; 'draft' is never picked up.
    expect(scheduledPostInserts[0]!.status).toBe('draft');
    expect(scheduledPostInserts[0]!.status).not.toBe('scheduled');
  });

  test('GUARD 2: the post is never handed to the publish queue', async () => {
    await run({ draftOnly: true });

    expect(mockedEnqueue).not.toHaveBeenCalled();
    expect(enqueueCalls).toHaveLength(0);
  });

  test('the status written is one the schema already allows', async () => {
    await run({ draftOnly: true });

    // chk_status permits draft|scheduled|publishing|published|failed|cancelled|blocked.
    const LEGAL = ['draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled', 'blocked'];
    expect(LEGAL).toContain(scheduledPostInserts[0]!.status);
  });
});

describe('P117 — everything except publication still happens', () => {
  test('generation still runs — a draft-only run exercises the real pipeline', async () => {
    await run({ draftOnly: true });

    expect(mockedMaster).toHaveBeenCalledTimes(1);
  });

  test('the canonical content bridge still fires (this is what it unblocks)', async () => {
    await run({ draftOnly: true });

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(mockedCreateContent.mock.calls[0]![0].campaignId).toBe('camp-1');
    expect(mockedCreateContent.mock.calls[0]![0].companyId).toBe('co-1');
  });

  test('the scheduled_post row is still written, only unpublishable', async () => {
    const result = await run({ draftOnly: true });

    expect(scheduledPostInserts).toHaveLength(1);
    expect(scheduledPostInserts[0]!.campaign_id).toBe('camp-1');
    expect(result.scheduled_count).toBe(1);
  });
});
