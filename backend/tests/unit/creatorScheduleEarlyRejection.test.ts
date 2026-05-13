function createRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: unknown) {
      this.body = body;
      return this;
    }),
  };
}

let supabaseRows: Record<string, unknown> = {};

function createSupabaseMock() {
  const from = jest.fn((table: string) => {
    const state = { table };
    const api: any = {
      select: jest.fn(() => api),
      eq: jest.fn(() => api),
      order: jest.fn(() => api),
      limit: jest.fn(() => api),
      update: jest.fn(() => api),
      maybeSingle: jest.fn(async () => ({ data: supabaseRows[`${state.table}:single`] ?? null, error: null })),
      single: jest.fn(async () => ({ data: supabaseRows[`${state.table}:single`] ?? null, error: null })),
      then(resolve: any, reject: any) {
        return Promise.resolve({ data: supabaseRows[state.table] ?? [], error: null }).then(resolve, reject);
      },
    };
    return api;
  });
  return { from };
}

const acquireSchedulerLock = jest.fn();
const releaseSchedulerLock = jest.fn();
const scheduleStructuredPlan = jest.fn();
const saveCampaignBlueprintFromLegacy = jest.fn();
const recordGovernanceEvent = jest.fn();
const syncCampaignVersionStage = jest.fn();
const checkAndCompleteCampaignIfEligible = jest.fn();
const assertBlueprintMutable = jest.fn();
const assertBlueprintActive = jest.fn();
const assertSchedulerExecutable = jest.fn();
const assertCampaignNotFinalized = jest.fn();
const isGovernanceLocked = jest.fn();
const requireCampaignAccess = jest.fn();

jest.mock('../../db/supabaseClient', () => ({
  supabase: createSupabaseMock(),
}));

function setSupabaseRows(contentType: string) {
  supabaseRows = {
    'campaign_versions:single': {
      company_id: 'company-1',
      campaign_snapshot: {
        execution_config: {
          campaign_mode: 'creator',
        },
      },
    },
    'campaigns:single': {
      start_date: '2026-05-14T00:00:00.000Z',
      execution_status: 'draft',
      blueprint_status: 'ACTIVE',
      duration_locked: false,
    },
    daily_content_plans: [
      {
        id: 'plan-1',
        content_type: contentType,
        week_number: 1,
      },
    ],
  };
}

jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: (...args: unknown[]) => requireCampaignAccess(...args),
}));

jest.mock('../../services/GovernanceLockdownService', () => ({
  isGovernanceLocked: (...args: unknown[]) => isGovernanceLocked(...args),
}));

jest.mock('../../services/structuredPlanScheduler', () => ({
  ScheduleEligibilityError: class ScheduleEligibilityError extends Error {
    code = 'SCHEDULE_ELIGIBILITY_ERROR';
    details = {};
  },
  scheduleStructuredPlan: (...args: unknown[]) => scheduleStructuredPlan(...args),
}));

jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: (...args: unknown[]) => saveCampaignBlueprintFromLegacy(...args),
}));

jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromStructuredPlan: jest.fn((plan) => plan),
}));

jest.mock('../../services/campaignBlueprintService', () => ({
  BlueprintImmutableError: class BlueprintImmutableError extends Error {},
  BlueprintExecutionFreezeError: class BlueprintExecutionFreezeError extends Error {},
  assertBlueprintMutable: (...args: unknown[]) => assertBlueprintMutable(...args),
  assertBlueprintActive: (...args: unknown[]) => assertBlueprintActive(...args),
}));

jest.mock('../../services/CampaignFinalizationGuard', () => ({
  CampaignFinalizedError: class CampaignFinalizedError extends Error {},
  assertCampaignNotFinalized: (...args: unknown[]) => assertCampaignNotFinalized(...args),
}));

jest.mock('../../services/SchedulerIntegrityGuard', () => ({
  SchedulerIntegrityError: class SchedulerIntegrityError extends Error {
    code = 'SCHEDULER_INTEGRITY_ERROR';
  },
  assertSchedulerExecutable: (...args: unknown[]) => assertSchedulerExecutable(...args),
}));

jest.mock('../../services/SchedulerLockService', () => ({
  SchedulerLockError: class SchedulerLockError extends Error {
    code = 'SCHEDULER_ALREADY_RUNNING';
  },
  acquireSchedulerLock: (...args: unknown[]) => acquireSchedulerLock(...args),
  releaseSchedulerLock: (...args: unknown[]) => releaseSchedulerLock(...args),
}));

jest.mock('../../services/CampaignCompletionService', () => ({
  checkAndCompleteCampaignIfEligible: (...args: unknown[]) => checkAndCompleteCampaignIfEligible(...args),
}));

jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: (...args: unknown[]) => recordGovernanceEvent(...args),
}));

jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: (...args: unknown[]) => syncCampaignVersionStage(...args),
}));

jest.mock('../../governance/ExecutionStateMachine', () => ({
  normalizeExecutionState: jest.fn((value) => value || 'draft'),
}));

jest.mock('../../services/campaignScheduleEligibilityService', () => ({
  evaluateScheduleEligibility: jest.fn(() => ({
    eligible: true,
    blockingCount: 0,
    fullyAiExecutable: true,
  })),
}));

describe('creator schedule early rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseRows('reel');
    isGovernanceLocked.mockResolvedValue(false);
    requireCampaignAccess.mockResolvedValue({ campaignId: 'campaign-1' });
    acquireSchedulerLock.mockResolvedValue('lock-1');
    releaseSchedulerLock.mockResolvedValue(undefined);
    scheduleStructuredPlan.mockResolvedValue({ scheduled_count: 1 });
    checkAndCompleteCampaignIfEligible.mockResolvedValue(undefined);
    syncCampaignVersionStage.mockResolvedValue(undefined);
    recordGovernanceEvent.mockResolvedValue(undefined);
  });

  test('schedule-structured-plan rejects guidance-only creator rows before locks, blueprint persistence, or scheduling', async () => {
    const { default: handler } = await import('../../../pages/api/campaigns/[id]/schedule-structured-plan');
    const req = {
      method: 'POST',
      query: { id: 'campaign-1' },
      body: { plan: { weeks: [{ week: 1 }] } },
    } as any;
    const res = createRes() as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'CREATOR_SCHEDULE_BLOCKED_BY_GOVERNANCE',
      blocked_formats: ['reel'],
    });
    expect(acquireSchedulerLock).not.toHaveBeenCalled();
    expect(saveCampaignBlueprintFromLegacy).not.toHaveBeenCalled();
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
    expect(recordGovernanceEvent).not.toHaveBeenCalled();
    expect(syncCampaignVersionStage).not.toHaveBeenCalled();
    expect(checkAndCompleteCampaignIfEligible).not.toHaveBeenCalled();
  });

  test('repurpose-and-schedule rejects guidance-only creator rows before lock acquisition or scheduling', async () => {
    const { default: handler } = await import('../../../pages/api/campaigns/[id]/repurpose-and-schedule');
    const req = {
      method: 'POST',
      query: { id: 'campaign-1' },
      body: {},
    } as any;
    const res = createRes() as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'CREATOR_SCHEDULE_BLOCKED_BY_GOVERNANCE',
      blocked_formats: ['reel'],
    });
    expect(acquireSchedulerLock).not.toHaveBeenCalled();
    expect(scheduleStructuredPlan).not.toHaveBeenCalled();
    expect(releaseSchedulerLock).not.toHaveBeenCalled();
  });

  test('valid autonomous creator schedule still reaches lock acquisition and scheduler', async () => {
    setSupabaseRows('infographic');
    const { default: handler } = await import('../../../pages/api/campaigns/[id]/schedule-structured-plan');
    const req = {
      method: 'POST',
      query: { id: 'campaign-1' },
      body: { plan: { weeks: [{ week: 1, content_type_mix: ['infographic'] }] } },
    } as any;
    const res = createRes() as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(acquireSchedulerLock).toHaveBeenCalledWith('campaign-1');
    expect(saveCampaignBlueprintFromLegacy).toHaveBeenCalled();
    expect(scheduleStructuredPlan).toHaveBeenCalled();
  });
});
