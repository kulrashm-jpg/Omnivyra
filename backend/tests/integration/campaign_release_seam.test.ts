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

/** Wire `supabase.from(table)` for the four tables the route reads. */
function wireSupabase(opts: {
  campaign?: Record<string, unknown> | null;
  planRows?: PlanRow[];
  campaignAfter?: Record<string, unknown>;
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
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              campaignSelectCount += 1;
              return { data: campaignSelectCount === 1 ? campaign : after, error: null };
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
    mockAcquireLock.mockRejectedValue(new SchedulerLockError('SCHEDULER_LOCKED'));
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
