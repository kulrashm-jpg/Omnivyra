/**
 * Strategic Mix R3-P2 — end-to-end adoption simulation over the REAL
 * processBlockSchedule (only IO seams mocked: DB, queue, LLM pipeline).
 *
 * Proves, in one mixed campaign (R3-P2.1 freeze semantics):
 *  - APPROVED workspace copy is the EXACT content inserted into
 *    scheduled_posts (verbatim, no adaptation, no LLM call for its card)
 *  - REVIEW copy NEVER publishes — it is a planning state; its row
 *    generates exactly like a legacy row ("review" = "not yet approved")
 *  - draft copy follows existing policy (generation path)
 *  - legacy rows (no workspace fields) generate byte-identically
 *  - manual edits survive to the published payload verbatim
 *  - mixed cards (adopted + non-adopted rows sharing one master) generate
 *    for the non-adopted row only
 *  - scheduler batching, idempotency, enqueue, dedup and floor behavior
 *    are unchanged
 *  - execution never rewrites planner-owned fields
 */

type Row = Record<string, unknown>;

const scheduledPostInserts: Row[] = [];
const planUpdates: Array<{ id: string; payload: Row }> = [];
const enqueueCalls: unknown[][] = [];
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
            eq: (_c: string, id: string) => { planUpdates.push({ id, payload }); return Promise.resolve({ error: null }); },
          }),
        };
      }
      if (table === 'blogs') return { insert: async () => ({ error: null }) };
      if (table === 'campaigns') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: 'co-1' } }) }) }) };
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async (...args: unknown[]) => { enqueueCalls.push(args); }),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async (item: { topic?: string }) => ({
    id: 'master-gen', generated_at: '2026-07-12T00:00:00.000Z',
    content: `GENERATED master body for ${item?.topic ?? 'unknown'}.`,
    generation_status: 'generated', generation_source: 'ai',
  })),
  // Topic-aware variants (like the real pipeline) so distinct cards produce
  // distinct copy — the same-platform dedup law is exercised separately.
  buildPlatformVariantsFromMaster: jest.fn(async (item: { topic?: string }) => ([
    { platform: 'linkedin', content_type: 'post', generated_content: `GENERATED linkedin variant for ${item?.topic ?? 'unknown'}.`, generation_status: 'generated' },
    { platform: 'x', content_type: 'post', generated_content: `GENERATED x variant for ${item?.topic ?? 'unknown'}.`, generation_status: 'generated' },
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
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';

const mockedMaster = generateMasterContentFromIntent as jest.Mock;
const mockedVariants = buildPlatformVariantsFromMaster as jest.Mock;

const CAMPAIGN = { start_date: '2099-01-04', user_id: 'user-1', company_id: 'co-1' };
const ACCOUNTS = new Map([['linkedin', 'acct-li'], ['x', 'acct-x']]);
const normalize = (p: string) => (['linkedin', 'x', 'twitter'].includes(p) ? (p === 'twitter' ? 'x' : p) : null);

const APPROVED_BODY = 'APPROVED workspace copy — exact, platform-native.\n\n#launch';
const REVIEWED_BODY = 'REVIEWED workspace copy awaiting final sign-off.';
const MANUAL_BODY = 'MANUALLY EDITED copy — the human wrote every word of this.';
const DRAFT_BODY = 'Draft-only workspace copy — not yet publishable.';

const mkRow = (id: string, over: Row = {}): Row => ({
  id,
  campaign_id: 'camp-1',
  week_number: 1,
  day_of_week: 'Monday',
  date: '2099-01-04',
  platform: 'linkedin',
  content_type: 'post',
  title: `Topic ${id}`,
  topic: `Topic ${id}`,
  scheduled_time: '09:00',
  ...over,
});

const workspaceEnvelope = (executionId: string, body: string, status: string, extra: Row = {}) =>
  JSON.stringify({
    placeholder: true,
    execution_id: executionId,
    draft_content: { body, source: 'ai', updated_at: '2026-07-12T09:00:00.000Z' },
    content_planning_status: status,
    ...extra,
  });

beforeEach(() => {
  scheduledPostInserts.length = 0;
  planUpdates.length = 0;
  enqueueCalls.length = 0;
  insertCounter = 0;
  mockedMaster.mockClear();
  mockedVariants.mockClear();
});

describe('R3-P2 simulation — mixed campaign through the real text scheduler', () => {
  test('approved + manual publish verbatim; review + draft + legacy generate; batching intact', async () => {
    const rows = [
      // Card 1 — approved AI copy
      mkRow('row-approved', { content: workspaceEnvelope('ex-a', APPROVED_BODY, 'approved') }),
      // Card 2 — REVIEW copy: planning state, must NEVER publish (R3-P2.1)
      mkRow('row-reviewed', { platform: 'x', day_of_week: 'Tuesday', date: '2099-01-05', content: workspaceEnvelope('ex-b', REVIEWED_BODY, 'review') }),
      // Card 3 — manually edited + approved
      mkRow('row-manual', { day_of_week: 'Wednesday', date: '2099-01-06', content: workspaceEnvelope('ex-c', MANUAL_BODY, 'approved', { draft_content: { body: MANUAL_BODY, source: 'manual', manually_edited: true, updated_at: '2026-07-12T10:00:00.000Z' } }) }),
      // Card 4 — draft workspace copy → existing policy = generation
      mkRow('row-draft', { platform: 'x', day_of_week: 'Thursday', date: '2099-01-07', content: workspaceEnvelope('ex-d', DRAFT_BODY, 'draft') }),
      // Card 5 — pure legacy row, no workspace fields at all
      mkRow('row-legacy', { day_of_week: 'Friday', date: '2099-01-08', content: JSON.stringify({ execution_id: 'ex-e', topic: 'Topic row-legacy' }) }),
    ];

    const result = await processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});

    // All five rows scheduled
    expect(result.scheduled_count).toBe(5);
    expect(scheduledPostInserts).toHaveLength(5);
    const byTitle = new Map(scheduledPostInserts.map((p) => [String(p.title), p]));

    // Approved + manual: workspace copy is the EXACT published content — verbatim
    expect(byTitle.get('Topic row-approved')?.content).toBe(APPROVED_BODY);
    expect(byTitle.get('Topic row-manual')?.content).toBe(MANUAL_BODY);

    // REVIEW NEVER PUBLISHES: the reviewed body appears in NO scheduled post;
    // its row generated exactly like a legacy row.
    expect(byTitle.get('Topic row-reviewed')?.content).toBe('GENERATED x variant for Topic row-reviewed.');
    expect(scheduledPostInserts.some((p) => String(p.content).includes(REVIEWED_BODY))).toBe(false);

    // Draft + legacy go through generation (variant for their platform)
    expect(byTitle.get('Topic row-draft')?.content).toBe('GENERATED x variant for Topic row-draft.');
    expect(byTitle.get('Topic row-legacy')?.content).toBe('GENERATED linkedin variant for Topic row-legacy.');

    // LLM ran ONLY for the three non-adopted cards (review + draft + legacy)
    expect(mockedMaster).toHaveBeenCalledTimes(3);
    expect(mockedVariants).toHaveBeenCalledTimes(3);

    // Scheduler contracts unchanged: status/idempotency/enqueue for every insert
    for (const post of scheduledPostInserts) {
      expect(post.status).toBe('scheduled');
      expect(String(post.idempotency_key)).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(enqueueCalls).toHaveLength(5);

    // Execution never rewrites planner-owned fields; adopted rows carry the audit marker
    const approvedUpdate = JSON.parse(String(planUpdates.find((u) => u.id === 'row-approved')?.payload.content));
    expect(approvedUpdate.draft_content.body).toBe(APPROVED_BODY);
    expect(approvedUpdate.content_planning_status).toBe('approved');
    expect(approvedUpdate.content_source).toBe('workspace');
    expect(approvedUpdate.content_source_tier).toBe('approved');
    expect(approvedUpdate.generated_content).toBe(APPROVED_BODY);

    const draftUpdate = JSON.parse(String(planUpdates.find((u) => u.id === 'row-draft')?.payload.content));
    expect(draftUpdate.draft_content.body).toBe(DRAFT_BODY);      // planner copy untouched
    expect(draftUpdate.content_planning_status).toBe('draft');    // lifecycle untouched
    expect(draftUpdate.content_source).toBeUndefined();           // no false adoption marker

    // Review row: planner-owned copy + status survive; no adoption marker
    const reviewUpdate = JSON.parse(String(planUpdates.find((u) => u.id === 'row-reviewed')?.payload.content));
    expect(reviewUpdate.draft_content.body).toBe(REVIEWED_BODY);
    expect(reviewUpdate.content_planning_status).toBe('review');
    expect(reviewUpdate.content_source).toBeUndefined();
  });

  test('mixed card: adopted row publishes its body while its sibling generates from the shared master', async () => {
    // Two rows share one card via source_execution_id → one master generation
    const rows = [
      mkRow('row-mix-a', {
        content: workspaceEnvelope('ex-m1', APPROVED_BODY, 'approved', { source_execution_id: 'shared-1' }),
      }),
      mkRow('row-mix-b', {
        platform: 'x', day_of_week: 'Tuesday', date: '2099-01-05',
        content: JSON.stringify({ execution_id: 'ex-m2', source_execution_id: 'shared-1', topic: 'Topic row-mix-a' }),
        topic: 'Topic row-mix-a', title: 'Topic row-mix-a',
      }),
    ];

    const result = await processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});
    expect(result.scheduled_count).toBe(2);
    expect(mockedMaster).toHaveBeenCalledTimes(1); // generation still ran for the card

    const linkedinPost = scheduledPostInserts.find((p) => p.platform === 'linkedin');
    const xPost = scheduledPostInserts.find((p) => p.platform === 'twitter');
    expect(linkedinPost?.content).toBe(APPROVED_BODY);        // adopted row: verbatim
    expect(xPost?.content).toBe('GENERATED x variant for Topic row-mix-a.'); // sibling: generated
  });

  test('fully adopted (all APPROVED) campaign makes ZERO LLM calls', async () => {
    const rows = [
      mkRow('row-1', { content: workspaceEnvelope('ex-1', APPROVED_BODY, 'approved') }),
      mkRow('row-2', { platform: 'x', day_of_week: 'Tuesday', date: '2099-01-05', content: workspaceEnvelope('ex-2', REVIEWED_BODY, 'approved') }),
    ];
    const result = await processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});
    expect(result.scheduled_count).toBe(2);
    expect(mockedMaster).not.toHaveBeenCalled();
    expect(mockedVariants).not.toHaveBeenCalled();
  });

  test('adopted content still honors same-platform dedup (scheduling integrity law)', async () => {
    const rows = [
      mkRow('row-dup-1', { content: workspaceEnvelope('ex-d1', APPROVED_BODY, 'approved') }),
      mkRow('row-dup-2', { day_of_week: 'Wednesday', date: '2099-01-06', content: workspaceEnvelope('ex-d2', APPROVED_BODY, 'approved') }),
    ];
    const result = await processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});
    expect(scheduledPostInserts).toHaveLength(1);
    expect(result.skipped_count).toBe(1);
  });
});
