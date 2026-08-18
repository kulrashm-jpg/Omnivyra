/**
 * Strategic Mix R3-P2 — characterization of processBlockSchedule, written
 * BEFORE content adoption touches it.
 *
 * This is THE text-lane scheduler: per activity card it generates one master
 * (or reuses row generated_content), builds platform variants, then inserts
 * scheduled_posts immediately (idempotency-keyed) and writes the finalized
 * envelope back onto daily_content_plans.
 *
 * Locks the pre-R3-P2 contract:
 *  - master generation + variant fanout + per-row variant→master fallback
 *  - generated_content reuse skips the master LLM call
 *  - scheduled_posts payload shape (platform/content_type mapping, status,
 *    repurpose index, deterministic idempotency key, enqueue after insert)
 *  - schedule floor (never in the past)
 *  - same-platform dedup skip
 *  - placeholder content never schedules
 *  - PLANNER-OWNED envelope fields (draft_content / content_planning_status)
 *    survive the finalized write-back verbatim
 *
 * R3-P2 may only ADD a workspace-content adoption branch; every assertion
 * here must stay green afterwards.
 */

type Row = Record<string, unknown>;

const scheduledPostInserts: Row[] = [];
const planUpdates: Array<{ id: string; payload: Row }> = [];
const blogInserts: Row[] = [];
const enqueueCalls: Row[] = [];
const drops: Array<{ reason: string; count: number }> = [];
let insertCounter = 0;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'scheduled_posts') {
        return {
          insert: (payload: Row) => {
            scheduledPostInserts.push(payload);
            insertCounter += 1;
            return { select: () => ({ maybeSingle: async () => ({ data: { id: `sp-${insertCounter}` }, error: null }) }) };
          },
        };
      }
      if (table === 'daily_content_plans') {
        return {
          update: (payload: Row) => ({
            eq: (_col: string, id: string) => {
              planUpdates.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'blogs') {
        return { insert: async (payload: Row) => { blogInserts.push(payload); return { error: null }; } };
      }
      if (table === 'campaigns') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: 'co-1' } }) }) }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async (...args: unknown[]) => { enqueueCalls.push({ args }); }),
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
    {
      platform: 'linkedin',
      content_type: 'post',
      generated_content: 'LinkedIn-native variant body.',
      generation_status: 'generated',
    },
  ])),
}));

jest.mock('../../services/creator/governanceItemEnricher', () => ({
  enrichItemWithGovernance: jest.fn(async (item: unknown) => item),
}));

jest.mock('../../services/campaign/plannerMetrics', () => ({
  emitPlannerDrop: jest.fn((reason: string, count: number) => { drops.push({ reason, count }); }),
  emitLifecycleTransition: jest.fn(),
}));

import { processBlockSchedule } from '../../services/boltScheduleBlockProcessor';
import { makeScheduledPostIdempotencyKey } from '../../services/boltScheduleIdempotency';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';

const mockedMaster = generateMasterContentFromIntent as jest.Mock;
const mockedVariants = buildPlatformVariantsFromMaster as jest.Mock;

const CAMPAIGN = { start_date: '2099-01-04', user_id: 'user-1', company_id: 'co-1' };
const ACCOUNTS = new Map([['linkedin', 'acct-li'], ['x', 'acct-x']]);
const normalize = (p: string) => (['linkedin', 'x', 'twitter'].includes(p) ? (p === 'twitter' ? 'x' : p) : null);

const row = (over: Row = {}): Row => ({
  id: `row-${Math.random().toString(36).slice(2, 8)}`,
  campaign_id: 'camp-1',
  week_number: 1,
  day_of_week: 'Monday',
  date: '2099-01-04', // far future → schedule floor never rewrites it
  platform: 'linkedin',
  content_type: 'post',
  title: 'Kickoff topic',
  topic: 'Kickoff topic',
  scheduled_time: '09:00',
  content: JSON.stringify({ execution_id: 'ex-1', topic: 'Kickoff topic' }),
  ...over,
});

const run = (rows: Row[]) =>
  processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});

beforeEach(() => {
  scheduledPostInserts.length = 0;
  planUpdates.length = 0;
  blogInserts.length = 0;
  enqueueCalls.length = 0;
  drops.length = 0;
  insertCounter = 0;
  mockedMaster.mockClear();
  mockedVariants.mockClear();
});

describe('processBlockSchedule — pre-R3-P2 contract', () => {
  test('generates master + variants and inserts a scheduled post with the locked payload shape', async () => {
    const r = row({ id: 'row-1' });
    const result = await run([r]);

    expect(mockedMaster).toHaveBeenCalledTimes(1);
    expect(mockedVariants).toHaveBeenCalledTimes(1);
    expect(result.scheduled_count).toBe(1);

    expect(scheduledPostInserts).toHaveLength(1);
    const post = scheduledPostInserts[0];
    expect(post).toMatchObject({
      user_id: 'user-1',
      social_account_id: 'acct-li',
      campaign_id: 'camp-1',
      platform: 'linkedin',
      content_type: 'post',
      title: 'Kickoff topic',
      content: 'LinkedIn-native variant body.', // variant preferred over master
      status: 'scheduled',
      repurpose_index: 1,
      repurpose_total: 1,
      idempotency_key: makeScheduledPostIdempotencyKey({
        campaignId: 'camp-1', weekNumber: 1, dayOfWeek: 'Monday',
        platform: 'linkedin', contentType: 'post', sequence: 0,
      }),
    });
    // Enqueue rides the inserted id
    expect(enqueueCalls).toHaveLength(1);
    expect((enqueueCalls[0].args as unknown[])[0]).toBe('sp-1');
    // Finalized envelope written back to the plan row
    const update = planUpdates.find((u) => u.id === 'row-1');
    const envelope = JSON.parse(String(update?.payload.content));
    expect(envelope.generated_content).toBe('LinkedIn-native variant body.');
    expect(envelope.content_status).toBe('finalized');
  });

  test('rows without a platform variant fall back to master content', async () => {
    const r = row({ id: 'row-x', platform: 'x', content_type: 'post', content: JSON.stringify({ execution_id: 'ex-x' }) });
    await run([r]);
    expect(scheduledPostInserts).toHaveLength(1);
    // x has no variant in the mock → master body; platform stored as canonical DB name
    expect(scheduledPostInserts[0].content).toBe('Generated master body with a hook and a CTA.');
    expect(scheduledPostInserts[0].platform).toBe('twitter');
    expect(scheduledPostInserts[0].content_type).toBe('tweet');
  });

  test('reusable generated_content in the row envelope skips the master LLM call', async () => {
    const r = row({
      id: 'row-reuse',
      content: JSON.stringify({ execution_id: 'ex-1', generated_content: 'Previously stored real content.' }),
    });
    await run([r]);
    expect(mockedMaster).not.toHaveBeenCalled();
    expect(mockedVariants).toHaveBeenCalledTimes(1); // variants still adapt from the reused master
  });

  test('PLANNER-OWNED fields (draft_content, content_planning_status) survive the finalized write-back', async () => {
    const draft = { body: 'Workspace copy', source: 'manual', manually_edited: true, updated_at: '2026-07-12T09:00:00.000Z' };
    const r = row({
      id: 'row-planner',
      content: JSON.stringify({ execution_id: 'ex-1', draft_content: draft, content_planning_status: 'draft' }),
    });
    await run([r]);
    const update = planUpdates.find((u) => u.id === 'row-planner');
    const envelope = JSON.parse(String(update?.payload.content));
    expect(envelope.draft_content).toEqual(draft);
    expect(envelope.content_planning_status).toBe('draft');
  });

  test('identical content on the same platform+type is dedup-skipped with a planner drop', async () => {
    // Same topic + same platform/type on two days → same card, same content → 2nd drops
    const r1 = row({ id: 'row-d1', day_of_week: 'Monday', date: '2099-01-04' });
    const r2 = row({ id: 'row-d2', day_of_week: 'Wednesday', date: '2099-01-06' });
    const result = await run([r1, r2]);
    expect(scheduledPostInserts).toHaveLength(1);
    expect(result.skipped_count).toBe(1);
    expect(drops).toContainEqual({ reason: 'duplicate_content', count: 1 });
  });

  // ── caller-local regeneration contract ──────────────────────────────────
  // buildAsset() takes only `text`; headline and cta are closed over from the
  // row. A regenerated candidate therefore carries the identical headline/CTA,
  // so the finding can never clear and the retry is a wasted generation call.

  test('a headline collision spends NO regeneration attempt (headline is row metadata)', async () => {
    // Both rows share the card title, so the second collides on duplicate_headline.
    const r1 = row({ id: 'row-rh1', day_of_week: 'Monday', date: '2099-01-04' });
    const r2 = row({ id: 'row-rh2', day_of_week: 'Wednesday', date: '2099-01-06' });
    const result = await run([r1, r2]);
    expect(result.skipped_count).toBe(1);
    // ONE card → exactly one variant build. A regeneration retry would call it again.
    expect(mockedVariants).toHaveBeenCalledTimes(1);
  });

  test('a CTA collision spends NO regeneration attempt (cta is card metadata)', async () => {
    // Two separate cards with DIFFERENT titles and DIFFERENT generated bodies, so
    // headline/opening/asset all differ and the ONLY collision is the shared CTA.
    mockedVariants
      .mockResolvedValueOnce([{ platform: 'linkedin', content_type: 'post', generated_content: 'First distinct body.', generation_status: 'generated' }])
      .mockResolvedValueOnce([{ platform: 'linkedin', content_type: 'post', generated_content: 'Second wholly different body.', generation_status: 'generated' }]);
    const mk = (id: string, ex: string, title: string, date: string, day: string) => row({
      id, title, topic: title, day_of_week: day, date,
      content: JSON.stringify({ execution_id: ex, topic: title, master_idea: { cta_strategy: 'Book a demo' } }),
    });
    const r1 = mk('row-rc1', 'ex-c1', 'Card one topic', '2099-01-04', 'Monday');
    const r2 = mk('row-rc2', 'ex-c2', 'Card two topic', '2099-01-06', 'Wednesday');
    const result = await run([r1, r2]);
    expect(result.skipped_count).toBe(1);
    expect(drops).toContainEqual({ reason: 'duplicate_content', count: 1 });
    // TWO cards → exactly two variant builds. A regeneration retry would make it three.
    expect(mockedVariants).toHaveBeenCalledTimes(2);
  });

  test('placeholder master with no variants never schedules', async () => {
    mockedMaster.mockResolvedValueOnce({
      id: 'master-bad', generated_at: 'x', content: '[MASTER GENERATION FAILED]',
      generation_status: 'failed', generation_source: 'ai',
    });
    mockedVariants.mockResolvedValueOnce([]);
    const result = await run([row({ id: 'row-ph' })]);
    expect(scheduledPostInserts).toHaveLength(0);
    expect(result.scheduled_count).toBe(0);
  });

  test('past dates are floored to now+1h (never schedule in the past)', async () => {
    const r = row({ id: 'row-past', date: '2020-01-06' });
    await run([r]);
    expect(scheduledPostInserts).toHaveLength(1);
    const scheduledFor = new Date(String(scheduledPostInserts[0].scheduled_for)).getTime();
    expect(scheduledFor).toBeGreaterThan(Date.now() + 55 * 60 * 1000);
  });
});
