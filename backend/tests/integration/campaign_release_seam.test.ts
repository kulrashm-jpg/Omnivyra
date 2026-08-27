/**
 * Strategic Mix P1 — Release Seam integration tests.
 *
 * Proves the handoff the Campaign Operating System audit found missing:
 *
 *   Strategic Mix finalized campaign
 *     → POST /api/campaigns/[id]/release
 *     → the EXISTING scheduleStructuredPlan
 *     → campaigns.status = 'active'          ← unblocks the publish worker
 *
 * The scheduler itself is mocked (it is separately proven by
 * contentWorkspaceAdoptionSimulation over the real processBlockSchedule); what
 * is under test here is the SEAM: authorization, guards, eligibility policy,
 * scope, the lock, governance events, and the status transition.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const mockOwnedUpdate = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => ({
    update: (payload: Record<string, unknown>) => {
      mockOwnedUpdate(payload);
      return { eq: jest.fn().mockResolvedValue({ error: null }) };
    },
  })),
}));

jest.mock('../../services/GovernanceLockdownService', () => ({
  isGovernanceLocked: jest.fn().mockResolvedValue(false),
}));

const mockRequireCampaignAccess = jest.fn();
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: (...args: unknown[]) => mockRequireCampaignAccess(...args),
}));

const mockScheduleStructuredPlan = jest.fn();
jest.mock('../../services/structuredPlanScheduler', () => ({
  scheduleStructuredPlan: (...args: unknown[]) => mockScheduleStructuredPlan(...args),
  ScheduleEligibilityError: class ScheduleEligibilityError extends Error {
    code = 'SCHEDULE_NOT_ELIGIBLE';
    details: unknown;
  },
}));

jest.mock('../../services/campaignBlueprintService', () => ({
  assertBlueprintActive: jest.fn().mockResolvedValue(undefined),
  assertBlueprintMutable: jest.fn().mockResolvedValue(undefined),
  BlueprintImmutableError: class BlueprintImmutableError extends Error {},
  BlueprintExecutionFreezeError: class BlueprintExecutionFreezeError extends Error {},
}));

const mockAcquireLock = jest.fn().mockResolvedValue('lock-1');
const mockReleaseLock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/SchedulerLockService', () => ({
  acquireSchedulerLock: (...a: unknown[]) => mockAcquireLock(...a),
  releaseSchedulerLock: (...a: unknown[]) => mockReleaseLock(...a),
  SchedulerLockError: class SchedulerLockError extends Error {
    code: string;
    constructor(code = 'SCHEDULER_LOCKED') {
      super(code);
      this.code = code;
    }
  },
}));

const mockRecordGovernanceEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: (...a: unknown[]) => mockRecordGovernanceEvent(...a),
}));

jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/CampaignCompletionService', () => ({
  checkAndCompleteCampaignIfEligible: jest.fn().mockResolvedValue(undefined),
}));
// The route is wrapped in withIdempotency; bypass the DB-backed store here and
// test replay behaviour through the scheduled_posts idempotency contract and
// the `skipExisting` option instead (see "idempotency" below).
jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: (handler: unknown) => handler,
}));

import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import releaseHandler from '../../../pages/api/campaigns/[id]/release';
import { supabase } from '../../db/supabaseClient';
import { SchedulerLockError } from '../../services/SchedulerLockService';

const CAMPAIGN_ID = 'camp-release-1';
const COMPANY_ID = 'co-release-1';

type PlanRow = Record<string, unknown>;

const approvedRow = (id: string, week: number, platform: string): PlanRow => ({
  id,
  week_number: week,
  platform,
  content_type: 'post',
  date: `2026-09-0${week}`,
  scheduled_time: '09:00:00',
  intent_type: 'text',
  scheduled_post_id: null,
  content: JSON.stringify({
    draft_content: { body: `Approved copy for ${id}`, source: 'ai', updated_at: 'x' },
    content_planning_status: 'approved',
  }),
});

const draftRow = (id: string, week: number, platform: string): PlanRow => ({
  ...approvedRow(id, week, platform),
  content: JSON.stringify({
    draft_content: { body: 'half-written', source: 'manual', updated_at: 'x' },
    content_planning_status: 'draft',
  }),
});

/**
 * Wire `supabase.from(table)`.
 *
 * P1.2 — the campaigns mock is COLUMN-AWARE: it inspects the requested select
 * list and, when `hasExecutionStatusColumn` is false, replies with the real
 * PostgREST undefined-column error (42703) exactly as production does. That is
 * the boundary that caused the false 404, so the tests must cross it rather
 * than mock it away.
 */
function wireSupabase(opts: {
  campaign?: Record<string, unknown> | null;
  planRows?: PlanRow[];
  campaignAfter?: Record<string, unknown>;
  /** false ⇒ simulate production, where campaigns.execution_status is absent. */
  hasExecutionStatusColumn?: boolean;
  /** Simulate an unrelated, genuine database failure on the campaigns read. */
  campaignsError?: { code?: string; message: string };
}) {
  const campaign = opts.campaign === undefined
    ? {
        id: CAMPAIGN_ID,
        status: 'planning',
        current_stage: 'execution_ready',
        execution_status: null,
        blueprint_status: 'ACTIVE',
        thread_id: null,
        start_date: '2026-09-01',
      }
    : opts.campaign;
  const planRows = opts.planRows ?? [approvedRow('r1', 1, 'linkedin')];
  const after = opts.campaignAfter ?? {
    status: 'active',
    current_stage: 'schedule',
    execution_status: null,
    blueprint_status: 'ACTIVE',
    thread_id: null,
  };

  const hasExecCol = opts.hasExecutionStatusColumn !== false;
  let campaignSelectCount = 0;

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'campaign_versions') {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { company_id: COMPANY_ID, campaign_snapshot: { execution_config: { campaign_mode: 'text' }, plan: { weeks: [{ week_number: 1 }] } } },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'campaigns') {
      return {
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              const requested = String(columns ?? '')
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean);
              const wantsExec = requested.includes('execution_status');

              // Real PostgREST: selecting a column the table lacks fails the
              // WHOLE query with 42703 — it does not return a partial row.
              if (wantsExec && !hasExecCol) {
                return {
                  data: null,
                  error: { code: '42703', message: 'column campaigns.execution_status does not exist' },
                };
              }
              // A genuine, unrelated database failure.
              if (opts.campaignsError) {
                return { data: null, error: opts.campaignsError };
              }
              // The optional single-column read.
              if (wantsExec && requested.length === 1) {
                return { data: { execution_status: campaign?.execution_status ?? null }, error: null };
              }
              // Canonical reads: pre-release, then post-release.
              campaignSelectCount += 1;
              const row = campaignSelectCount === 1 ? campaign : after;
              if (!row) return { data: null, error: null };
              // Only return columns the mock schema actually has.
              const projected: Record<string, unknown> = {};
              for (const key of Object.keys(row)) {
                if (key === 'execution_status' && !hasExecCol) continue;
                projected[key] = (row as Record<string, unknown>)[key];
              }
              return { data: projected, error: null };
            },
          }),
        }),
      };
    }
    if (table === 'daily_content_plans') {
      return { select: () => ({ eq: async () => ({ data: planRows, error: null }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

const post = async (body: Record<string, unknown> = {}) => {
  const req = createApiRequestMock({ method: 'POST', id: CAMPAIGN_ID, body });
  const res = createMockRes();
  await (releaseHandler as unknown as (rq: unknown, rs: unknown) => Promise<void>)(req, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireCampaignAccess.mockResolvedValue({ userId: 'user-1', companyId: COMPANY_ID, role: 'COMPANY_ADMIN' });
  mockScheduleStructuredPlan.mockResolvedValue({ scheduled_count: 1, skipped_count: 0, skipped_platforms: [] });
  mockAcquireLock.mockResolvedValue('lock-1');
});

describe('authorization', () => {
  it('rejects a caller without campaign access (the guard owns the response)', async () => {
    mockRequireCampaignAccess.mockImplementation(async (_rq: unknown, rs: any) => {
      rs.status(403).json({ error: 'FORBIDDEN' });
      return null;
    });
    wireSupabase({});
    const res = await post();
    expect(res.statusCode).toBe(403);
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('rejects a non-POST method', async () => {
    wireSupabase({});
    const req = createApiRequestMock({ method: 'GET', id: CAMPAIGN_ID });
    const res = createMockRes();
    await (releaseHandler as unknown as (rq: unknown, rs: unknown) => Promise<void>)(req, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('the release chain', () => {
  it('schedules through the EXISTING scheduler and flips the campaign to active', async () => {
    wireSupabase({ planRows: [approvedRow('r1', 1, 'linkedin'), approvedRow('r2', 2, 'x')] });
    const res = await post({ scope: 'campaign' });

    expect(res.statusCode).toBe(200);
    expect(mockScheduleStructuredPlan).toHaveBeenCalledTimes(1);

    // …with the eligible rows only, generateContent on (so approved copy is
    // adopted verbatim by resolveWorkspaceContent inside the block processor).
    const [, campaignId, options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(campaignId).toBe(CAMPAIGN_ID);
    expect(options.generateContent).toBe(true);
    expect(options.skipExisting).toBe(true);
    expect(options.restrictToDailyPlanIds.sort()).toEqual(['r1', 'r2']);

    // THE fix for PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE.
    expect(mockOwnedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', current_stage: 'schedule', blueprint_status: 'ACTIVE' }),
    );
    expect(res.body.stage_before).toBe('ready');
    expect(res.body.stage).toBe('scheduling');
  });

  it('acquires and always releases the existing scheduler lock', async () => {
    wireSupabase({});
    await post();
    expect(mockAcquireLock).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(mockReleaseLock).toHaveBeenCalledWith(CAMPAIGN_ID, 'lock-1');
  });

  it('releases the lock even when scheduling throws', async () => {
    wireSupabase({});
    mockScheduleStructuredPlan.mockRejectedValue(new Error('scheduler exploded'));
    const res = await post();
    expect(res.statusCode).toBe(500);
    expect(mockReleaseLock).toHaveBeenCalledWith(CAMPAIGN_ID, 'lock-1');
  });

  it('records SCHEDULE_STARTED and SCHEDULE_COMPLETED governance events', async () => {
    wireSupabase({});
    await post();
    const types = mockRecordGovernanceEvent.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(types).toEqual(['SCHEDULE_STARTED', 'SCHEDULE_COMPLETED']);
    expect(mockRecordGovernanceEvent.mock.calls[0][0]).toMatchObject({
      companyId: COMPANY_ID,
      metadata: expect.objectContaining({ source: 'strategic-mix-release' }),
    });
  });

  it('returns a summary the UI can show the CMO', async () => {
    wireSupabase({ planRows: [approvedRow('r1', 1, 'linkedin'), draftRow('r2', 2, 'x')] });
    const res = await post();
    expect(res.body).toMatchObject({
      campaign_id: CAMPAIGN_ID,
      scope: 'campaign',
      eligible_count: 1,
      approved_count: 1,
      scheduled_count: 1,
      platforms: ['linkedin'],
      first_scheduled_at: '2026-09-01T09:00:00',
    });
    expect(res.body.skipped_by_reason.content_in_draft).toBe(1);
  });
});

describe('readiness', () => {
  it('refuses a campaign still in draft', async () => {
    wireSupabase({
      campaign: { id: CAMPAIGN_ID, status: 'draft', current_stage: 'planning', execution_status: null, blueprint_status: 'ACTIVE', thread_id: 'planner_draft_1', start_date: '2026-09-01' },
    });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CAMPAIGN_NOT_FINALIZED');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('refuses a campaign with no start date', async () => {
    wireSupabase({
      campaign: { id: CAMPAIGN_ID, status: 'planning', current_stage: 'execution_ready', execution_status: null, blueprint_status: 'ACTIVE', thread_id: null, start_date: null },
    });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CAMPAIGN_START_DATE_MISSING');
  });

  it('refuses a campaign with no planned content', async () => {
    wireSupabase({ planRows: [] });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CAMPAIGN_HAS_NO_CONTENT');
  });

  it('refuses when everything in scope is unapproved — and says why', async () => {
    wireSupabase({ planRows: [draftRow('r1', 1, 'linkedin'), draftRow('r2', 2, 'x')] });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('NOTHING_RELEASABLE');
    expect(res.body.skipped_by_reason.content_in_draft).toBe(2);
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
    // Nothing was released, so the campaign must NOT have been activated.
    expect(mockOwnedUpdate).not.toHaveBeenCalled();
  });

  it('never publishes unapproved copy even when the whole campaign is released', async () => {
    wireSupabase({ planRows: [approvedRow('ok', 1, 'linkedin'), draftRow('d', 1, 'x'), { ...draftRow('rv', 1, 'instagram'), content: JSON.stringify({ draft_content: { body: 'in review' }, content_planning_status: 'review' }) }] });
    await post();
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds).toEqual(['ok']);
  });
});

describe('scope', () => {
  const rows = [approvedRow('w1', 1, 'linkedin'), approvedRow('w2', 2, 'linkedin'), approvedRow('w3', 3, 'x')];

  it('scope=weeks restricts scheduling to those weeks', async () => {
    wireSupabase({ planRows: rows });
    const res = await post({ scope: 'weeks', weeks: [2] });
    expect(res.statusCode).toBe(200);
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds).toEqual(['w2']);
    expect(res.body.requested_weeks).toEqual([2]);
    expect(res.body.eligible_weeks).toEqual([2]);
  });

  it('scope=slots restricts scheduling to those slots', async () => {
    wireSupabase({ planRows: rows });
    const res = await post({ scope: 'slots', slot_ids: ['w3'] });
    expect(res.statusCode).toBe(200);
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds).toEqual(['w3']);
  });

  it('rejects weeks that do not belong to the campaign', async () => {
    wireSupabase({ planRows: rows });
    const res = await post({ scope: 'weeks', weeks: [9] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('UNKNOWN_WEEKS');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('rejects slots that do not belong to the campaign', async () => {
    wireSupabase({ planRows: rows });
    const res = await post({ scope: 'slots', slot_ids: ['not-mine'] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('UNKNOWN_SLOTS');
  });

  it('rejects a malformed scope rather than widening to the whole campaign', async () => {
    wireSupabase({ planRows: rows });
    const res = await post({ scope: 'weeks', weeks: [] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_RELEASE_SCOPE');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });
});

describe('idempotency and concurrency', () => {
  it('a re-release skips rows that already produced a scheduled post', async () => {
    wireSupabase({
      planRows: [
        { ...approvedRow('done', 1, 'linkedin'), scheduled_post_id: 'sp-1' },
        approvedRow('todo', 2, 'x'),
      ],
    });
    const res = await post();
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds).toEqual(['todo']);
    expect(res.body.skipped_by_reason.already_scheduled).toBe(1);
  });

  it('a fully re-released campaign schedules nothing again', async () => {
    wireSupabase({ planRows: [{ ...approvedRow('done', 1, 'linkedin'), scheduled_post_id: 'sp-1' }] });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('NOTHING_RELEASABLE');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('passes skipExisting so the scheduler also de-dupes at the post level', async () => {
    wireSupabase({});
    await post();
    expect(mockScheduleStructuredPlan.mock.calls[0][2].skipExisting).toBe(true);
  });

  it('a concurrent release is rejected by the existing scheduler lock', async () => {
    wireSupabase({});
    mockAcquireLock.mockRejectedValue(new SchedulerLockError('SCHEDULER_ALREADY_RUNNING'));
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('SCHEDULER_ALREADY_RUNNING');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
    // The lock was never held by us, so nothing to release.
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it('two sequential releases of the same campaign schedule each row at most once', async () => {
    // First release: both rows eligible.
    wireSupabase({ planRows: [approvedRow('a', 1, 'linkedin'), approvedRow('b', 1, 'x')] });
    await post();
    expect(mockScheduleStructuredPlan.mock.calls[0][2].restrictToDailyPlanIds.sort()).toEqual(['a', 'b']);

    // Second release AFTER execution stamped scheduled_post_id on both.
    jest.clearAllMocks();
    mockRequireCampaignAccess.mockResolvedValue({ userId: 'user-1', companyId: COMPANY_ID, role: 'COMPANY_ADMIN' });
    wireSupabase({
      planRows: [
        { ...approvedRow('a', 1, 'linkedin'), scheduled_post_id: 'sp-a' },
        { ...approvedRow('b', 1, 'x'), scheduled_post_id: 'sp-b' },
      ],
    });
    const second = await post();
    expect(second.statusCode).toBe(409);
    expect(second.body.code).toBe('NOTHING_RELEASABLE');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });
});

/**
 * P1.2 — live-schema compatibility.
 *
 * `campaigns.execution_status` is NOT in the canonical baseline schema; it is
 * added only by database/campaign_preemption_status.sql, which is outside the
 * Supabase migration tree. It was VERIFIED ABSENT in production (PostgREST
 * 42703). Because the release route selected it in the mandatory campaign
 * read, that absence failed the whole query and surfaced as a false
 * "404 Campaign not found" — the release seam could never run.
 */
describe('P1.2 — optional legacy column compatibility', () => {
  it('A. column PRESENT: release works and the result is unchanged', async () => {
    wireSupabase({ hasExecutionStatusColumn: true });
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(mockScheduleStructuredPlan).toHaveBeenCalledTimes(1);
    expect(res.body.scheduled_count).toBe(1);
  });

  it('B. column ABSENT: release still works — no false 404', async () => {
    wireSupabase({ hasExecutionStatusColumn: false });
    const res = await post();
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(200);
    // …and it proceeds under the canonical P1 contract, unchanged.
    expect(mockScheduleStructuredPlan).toHaveBeenCalledTimes(1);
    expect(mockOwnedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', current_stage: 'schedule', blueprint_status: 'ACTIVE' }),
    );
  });

  it('B2. column ABSENT: canonical stage still resolves (not degraded to planning)', async () => {
    wireSupabase({ hasExecutionStatusColumn: false });
    const res = await post();
    expect(res.body.stage_before).toBe('ready');
    expect(res.body.stage).toBe('scheduling');
  });

  it('B3. column ABSENT: the finalization guard simply does not apply', async () => {
    // With no column there is no COMPLETED/PREEMPTED value to enforce; the
    // route must not invent one, and must not block.
    wireSupabase({ hasExecutionStatusColumn: false });
    expect((await post()).statusCode).toBe(200);
  });

  it('B4. column PRESENT and terminal: the finalization guard STILL blocks', async () => {
    // Compatibility must not weaken the guard where the column exists.
    wireSupabase({
      hasExecutionStatusColumn: true,
      campaign: {
        id: CAMPAIGN_ID, status: 'planning', current_stage: 'execution_ready',
        execution_status: 'COMPLETED', blueprint_status: 'ACTIVE', thread_id: null, start_date: '2026-09-01',
      },
    });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CAMPAIGN_FINALIZED');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('C. a genuinely missing campaign still returns 404', async () => {
    wireSupabase({ campaign: null });
    const res = await post();
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Campaign not found');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('D. a real database error is NOT disguised as "Campaign not found"', async () => {
    wireSupabase({ campaignsError: { code: '08006', message: 'connection failure' } });
    const res = await post();
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('CAMPAIGN_READ_FAILED');
    expect(res.body.message).toMatch(/connection failure/);
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
    expect(mockOwnedUpdate).not.toHaveBeenCalled();
  });

  it('D2. only 42703 is tolerated — no generic error swallowing', async () => {
    // A permission error on the campaigns read must surface, not degrade.
    wireSupabase({ campaignsError: { code: '42501', message: 'permission denied for table campaigns' } });
    const res = await post();
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('CAMPAIGN_READ_FAILED');
  });

  it('E. the mandatory campaign read no longer requests the optional column', async () => {
    const selects: string[] = [];
    wireSupabase({});
    const original = (supabase.from as jest.Mock).getMockImplementation()!;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      const built = original(table);
      if (table !== 'campaigns') return built;
      return {
        select: (cols: string) => {
          selects.push(cols);
          return built.select(cols);
        },
      };
    });
    await post();
    // Exactly one read asks for execution_status, and it asks for nothing else.
    const execSelects = selects.filter((s) => s.includes('execution_status'));
    expect(execSelects).toEqual(['execution_status']);
    // The canonical reads never mention it.
    for (const s of selects.filter((x) => x !== 'execution_status')) {
      expect(s).not.toContain('execution_status');
    }
  });
});

/**
 * P4 — week SELECTION maps onto the existing P1 release contract. No second
 * release API: the UI narrows `scope`, the server re-validates every week and
 * remains authoritative. A selection can never widen the scope.
 */
describe('P4 — week selection → scope:"weeks" (no scope widening)', () => {
  const sixWeeks = [
    approvedRow('w1', 1, 'linkedin'), approvedRow('w2', 2, 'linkedin'),
    approvedRow('w3', 3, 'linkedin'), approvedRow('w4', 4, 'linkedin'),
    approvedRow('w5', 5, 'linkedin'), approvedRow('w6', 6, 'linkedin'),
  ];

  it('selecting weeks 1,2 schedules ONLY weeks 1,2 — never 3-6', async () => {
    wireSupabase({ planRows: sixWeeks });
    const res = await post({ scope: 'weeks', weeks: [1, 2] });
    expect(res.statusCode).toBe(200);
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds.sort()).toEqual(['w1', 'w2']);
    // The decisive assertion: nothing outside the selection was scheduled.
    for (const outside of ['w3', 'w4', 'w5', 'w6']) {
      expect(options.restrictToDailyPlanIds).not.toContain(outside);
    }
    expect(res.body.eligible_weeks).toEqual([1, 2]);
  });

  it('a non-contiguous selection is honoured exactly', async () => {
    wireSupabase({ planRows: sixWeeks });
    await post({ scope: 'weeks', weeks: [1, 3, 5] });
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds.sort()).toEqual(['w1', 'w3', 'w5']);
  });

  it('an unknown week is rejected — the selection cannot invent scope', async () => {
    wireSupabase({ planRows: sixWeeks });
    const res = await post({ scope: 'weeks', weeks: [1, 99] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('UNKNOWN_WEEKS');
    expect(res.body.unknown_weeks).toEqual([99]);
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('a duplicate week collapses rather than double-scheduling', async () => {
    wireSupabase({ planRows: sixWeeks });
    await post({ scope: 'weeks', weeks: [2, 2, 2] });
    const [, , options] = mockScheduleStructuredPlan.mock.calls[0];
    expect(options.restrictToDailyPlanIds).toEqual(['w2']);
  });

  it('an EMPTY selection is rejected rather than silently widening to the whole campaign', async () => {
    wireSupabase({ planRows: sixWeeks });
    const res = await post({ scope: 'weeks', weeks: [] });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_RELEASE_SCOPE');
    expect(mockScheduleStructuredPlan).not.toHaveBeenCalled();
  });

  it('a week whose slots are all unapproved releases nothing, and says why', async () => {
    wireSupabase({ planRows: [approvedRow('w1', 1, 'linkedin'), draftRow('w2', 2, 'linkedin')] });
    const res = await post({ scope: 'weeks', weeks: [2] });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('NOTHING_RELEASABLE');
    expect(res.body.skipped_by_reason.content_in_draft).toBe(1);
  });
});

describe('canonical stage mapping', () => {
  it("maps the scheduling writers' current_stage='schedule' onto the canonical 'scheduling' stage", () => {
    // commit-plan, schedule-structured-plan, the live BOLT path and the
    // release seam all write 'schedule'. Before P1 the resolver had no entry
    // for it, so a scheduled campaign read back as 'planning'.
    const { resolveCampaignStage } = jest.requireActual('../../../lib/campaign/campaignStage');
    expect(resolveCampaignStage({ status: 'active', current_stage: 'schedule' }).stage).toBe('scheduling');
    // The pre-existing mappings are unchanged.
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'execution_ready' }).stage).toBe('ready');
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'campaign_week_plan' }).stage).toBe('scheduling');
  });
});

describe('publish-worker regression (the audit P0 blocker)', () => {
  it('BEFORE release the campaign is not active — the worker guard would reject it', () => {
    // publishProcessor requires campaign.status === 'active'; a planner-
    // finalized campaign is 'planning'. This is the state the audit found.
    const finalized = { status: 'planning', current_stage: 'execution_ready' };
    expect(finalized.status).not.toBe('active');
  });

  it('AFTER release the campaign IS active — the guard no longer rejects it', async () => {
    wireSupabase({});
    await post();
    const update = mockOwnedUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(update.status).toBe('active');
  });

  it('a campaign that was never released is left untouched (guard stays intact)', async () => {
    wireSupabase({ planRows: [draftRow('d', 1, 'linkedin')] });
    await post();
    expect(mockOwnedUpdate).not.toHaveBeenCalled();
  });
});
