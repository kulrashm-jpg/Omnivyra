/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — campaign binding, family 2 (planner routes).
 *
 *  - campaigns/planner-finalize: companyId was authorized but a supplied
 *    campaignId was never tied to it, so a member of A could finalize (read,
 *    re-date, re-snapshot, rewrite plan + slots of) B's campaign.
 *  - campaigns/ai/plan-v2: getUserCompanyRole's role was never checked; any
 *    authenticated user could queue planning jobs for any campaign.
 *  - campaigns/ai/plan: the campaign's company was resolved, but the unchecked
 *    body companyId was then used for the company-context read, the rollout
 *    lookup and the enqueued job; and the LLM moderation call ran BEFORE auth.
 *
 * The real guard chain runs; only the DB, identity provider and paid/heavy
 * services are faked. Denials assert the sink was never reached.
 */
import {
  seed, invoke, writeCalls, sinkCalls, leaksB,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, USER_A,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// ── planner-finalize services ──
const mockGetCampaignById = jest.fn(async (id: string, ..._a: any[]) =>
  (require('../helpers/routeAuthHarness').rows('campaigns').some((c: { id: string }) => c.id === id)
    ? { id, status: 'planning', current_stage: 'planning', start_date: '2026-08-03' }
    : null));
jest.mock('../../db/campaignStore', () => ({ getCampaignById: (id: string, ...a: any[]) => mockGetCampaignById(id, ...a) }));
jest.mock('../../services/campaignBlueprintAdapter', () => ({ fromStructuredPlan: (input: unknown) => ({ blueprint: true, input }) }));
const mockSaveStructured = jest.fn(async (..._a: any[]) => undefined);
const mockCommitDraft = jest.fn(async (..._a: any[]) => undefined);
const mockSaveAiCampaignPlan = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../db/campaignPlanStore', () => ({
  saveStructuredCampaignPlan: (...a: any[]) => mockSaveStructured(...a),
  commitDraftBlueprint: (...a: any[]) => mockCommitDraft(...a),
  saveAiCampaignPlan: (...a: any[]) => mockSaveAiCampaignPlan(...a),
  saveDraftBlueprint: async () => undefined,
  getLatestDraftPlan: async () => null,
}));
const mockGenerateFromManual = jest.fn(async (..._a: any[]) => undefined);
const mockSaveWeekPlans = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/executionPlannerService', () => ({
  generateFromManualPlanner: (...a: any[]) => mockGenerateFromManual(...a),
  saveWeekPlans: (...a: any[]) => mockSaveWeekPlans(...a),
}));
jest.mock('../../db/campaignVersionStore', () => ({ syncCampaignVersionStage: async () => undefined }));
jest.mock('../../services/campaignPlanningInputsService', () => ({
  saveCampaignPlanningInputs: async () => undefined,
  getCampaignPlanningInputs: async () => null,
}));
jest.mock('../../services/plannerIntegrityService', () => ({ validateCalendarPlan: () => ({ valid: true, errors: [] }) }));
const mockGetLatestCompanyContext = jest.fn(async (..._a: any[]) => null);
jest.mock('../../services/campaignContextService', () => ({
  saveCampaignContextSnapshot: async () => undefined,
  getLatestCampaignContextForCompany: (...a: any[]) => mockGetLatestCompanyContext(...a),
}));
jest.mock('../../services/creator/campaignPlanValidationService', () => ({
  plannedAssetsFromActivities: () => [],
  validateCampaignPlanAssets: async () => ({ ok: true, perAsset: [] }),
}));
jest.mock('../../services/orchestration', () => ({
  reconcileExecution: async () => undefined,
  runAuthoritativeGenerationGate: async () => undefined,
}));
jest.mock('../../services/strategy', () => ({ getOrCreateCampaignStrategy: async () => undefined }));

// ── plan-v2 services ──
const mockSafeEnqueue = jest.fn(async (..._a: any[]) => true);
jest.mock('../../queue/bullmqClient', () => ({ getAiHeavyQueue: () => ({}), makeStableJobId: () => 'job-1' }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: (...a: any[]) => mockSafeEnqueue(...a) }));
jest.mock('../../services/jobCostEstimator', () => ({ quickEstimateCost: () => 0.01 }));
jest.mock('../../services/planResolutionService', () => ({ resolveOrganizationPlanLimits: async () => ({ plan_key: 'growth' }) }));

// ── ai/plan services ──
const mockModerate = jest.fn(async (..._a: any[]) => ({ allowed: true }));
jest.mock('../../chatGovernance', () => ({ validateAndModerateUserMessage: (...a: any[]) => mockModerate(...a) }));
const mockRunPlan = jest.fn(async (args: any) => ({ mode: args.mode, snapshot_hash: 'h', omnivyre_decision: { status: 'ok' }, plan: null }));
jest.mock('../../services/campaignAiOrchestrator', () => ({
  runCampaignAiPlan: (a: any) => mockRunPlan(a),
  normalizeCapacityCounts: (v: unknown) => v,
  normalizeCapacityCountsWithBreakdown: (v: unknown) => v,
}));
const mockPreview = jest.fn(async (..._a: any[]) => ({ plan: { weeks: [] } }));
jest.mock('../../services/planPreviewService', () => ({
  generatePlanPreview: (...a: any[]) => mockPreview(...a),
  PlanningValidationError: class PlanningValidationError extends Error {},
  PlanningGenerationError: class PlanningGenerationError extends Error {},
}));
jest.mock('../../services/plannerCommandExtractor', () => ({ extractPlannerCommands: async () => [] }));
jest.mock('../../services/plannerCommandInterpreter', () => ({
  applyPlannerCommands: (_c: unknown, p: unknown) => p,
  PlannerCommandValidationError: class PlannerCommandValidationError extends Error {},
}));
jest.mock('../../services/schedulingService', () => ({ detectCampaignConflicts: async () => [], suggestAvailableDateRange: async () => null }));
jest.mock('../../../lib/platform/runway', () => ({
  buildRunwayPollKey: () => 'poll', pollRunwayResult: async () => null,
  enqueueRunwayOperation: async () => ({}), getRunwayJobStatus: async () => ({ state: 'none' }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const plannerFinalize = require('../../../pages/api/campaigns/planner-finalize').default;
const planV2 = require('../../../pages/api/campaigns/ai/plan-v2').default;
const plan = require('../../../pages/api/campaigns/ai/plan').default;
/* eslint-enable @typescript-eslint/no-var-requires */

beforeEach(() => {
  seed();
  for (const m of [mockGetCampaignById, mockSaveStructured, mockCommitDraft, mockSaveAiCampaignPlan, mockGenerateFromManual,
    mockSaveWeekPlans, mockGetLatestCompanyContext, mockSafeEnqueue, mockModerate, mockRunPlan, mockPreview]) m.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

const FINALIZE_SINK_TABLES = ['campaigns', 'campaign_versions', 'daily_content_plans'];
const finalizeSinksUntouched = () => {
  expect(writeCalls(FINALIZE_SINK_TABLES)).toHaveLength(0);
  expect(mockGetCampaignById).not.toHaveBeenCalled();
  expect(mockSaveStructured).not.toHaveBeenCalled();
  expect(mockCommitDraft).not.toHaveBeenCalled();
  expect(mockGenerateFromManual).not.toHaveBeenCalled();
  expect(mockSaveWeekPlans).not.toHaveBeenCalled();
};

// ───────────────────────────────────────────────────────── planner-finalize ──
describe('campaigns/planner-finalize', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    companyId: CO_A,
    idea_spine: { title: 'Launch' },
    strategy_context: { duration_weeks: 1, platforms: ['linkedin'], posting_frequency: { linkedin: 1 }, planned_start_date: '2026-08-03' },
    execution_handoff: { skeleton_confirmed: true, strategy_confirmed: true },
    ...over,
  });

  it('unauthenticated → 401, nothing touched', async () => {
    const r = await invoke(plannerFinalize, { method: 'POST', as: null, body: body({ campaignId: CAMPAIGN_A }) });
    expect(r.status).toBe(401);
    finalizeSinksUntouched();
  });
  it('member of A naming company B → 403, nothing touched', async () => {
    const r = await invoke(plannerFinalize, { method: 'POST', as: 'A', body: body({ companyId: CO_B, campaignId: CAMPAIGN_B }) });
    expect(r.status).toBe(403);
    finalizeSinksUntouched();
  });
  it('member of A authorizing as A with B\'s campaignId → 404, B never read or rewritten (the defect)', async () => {
    const r = await invoke(plannerFinalize, { method: 'POST', as: 'A', body: body({ campaignId: CAMPAIGN_B }) });
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
    finalizeSinksUntouched();
  });
  it('unknown campaignId → 404 from the route own campaign lookup, nothing written', async () => {
    // A campaign that does not exist cannot belong to another tenant, so the
    // shared binder lets it through; the route then refuses to finalize it.
    const r = await invoke(plannerFinalize, { method: 'POST', as: 'A', body: body({ campaignId: UNKNOWN_ID }) });
    expect(r.status).toBe(404);
    expect(writeCalls(FINALIZE_SINK_TABLES)).toHaveLength(0);
    expect(mockSaveStructured).not.toHaveBeenCalled();
    expect(mockGenerateFromManual).not.toHaveBeenCalled();
  });
  it('member of A finalizes own existing campaign → 200', async () => {
    const r = await invoke(plannerFinalize, { method: 'POST', as: 'A', body: body({ campaignId: CAMPAIGN_A }) });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ campaign_id: CAMPAIGN_A });
    expect(mockSaveStructured).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMPAIGN_A }));
    expect(mockGenerateFromManual).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMPAIGN_A, companyId: CO_A }));
  });
  it('creating a NEW campaign (no campaignId) is unchanged → 200, owner record = authorized company', async () => {
    const r = await invoke(plannerFinalize, {
      method: 'POST', as: 'A',
      body: body({ calendar_plan: { activities: [{ week_number: 1, day: 'Monday', platform: 'linkedin', content_type: 'post', title: 'x' }] } }),
    });
    expect(r.status).toBe(200);
    const version = writeCalls(['campaign_versions'])[0];
    expect(version.payload).toMatchObject({ company_id: CO_A });
  });
});

// ─────────────────────────────────────────────────────────────── ai/plan-v2 ──
describe('campaigns/ai/plan-v2', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    campaignId: CAMPAIGN_A, companyId: CO_A,
    spine: { title: 'x' }, strategyContext: { platforms: ['linkedin'], duration_weeks: 2 },
    ...over,
  });
  const untouched = () => {
    expect(mockSafeEnqueue).not.toHaveBeenCalled();
    expect(writeCalls(['campaign_plan_jobs'])).toHaveLength(0);
    expect(sinkCalls(['campaign_week_plan', 'campaigns'])).toHaveLength(0);
  };

  it('unauthenticated → 401, nothing queued', async () => {
    const r = await invoke(planV2, { method: 'POST', as: null, body: body() });
    expect(r.status).toBe(401);
    untouched();
  });
  it('member of A with B\'s campaign (and B\'s company) → 403/404, nothing queued', async () => {
    const r = await invoke(planV2, { method: 'POST', as: 'A', body: body({ campaignId: CAMPAIGN_B, companyId: CO_B }) });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    untouched();
  });
  it('member of A with B\'s campaign under own company id → 403/404, nothing queued', async () => {
    const r = await invoke(planV2, { method: 'POST', as: 'A', body: body({ campaignId: CAMPAIGN_B }) });
    expect([403, 404]).toContain(r.status);
    untouched();
  });
  it('client companyId=B cannot override the campaign\'s bound tenant → 403', async () => {
    const r = await invoke(planV2, { method: 'POST', as: 'A', body: body({ companyId: CO_B }) });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Access denied to company' });
    untouched();
  });
  it('member of A with own campaign → 202, job carries the bound tenant', async () => {
    const r = await invoke(planV2, { method: 'POST', as: 'A', body: body() });
    expect(r.status).toBe(202);
    expect(mockSafeEnqueue).toHaveBeenCalledTimes(1);
    expect(mockSafeEnqueue.mock.calls[0][3]).toMatchObject({ campaignId: CAMPAIGN_A, companyId: CO_A, userId: USER_A });
  });
});

// ───────────────────────────────────────────────────────────────── ai/plan ──
describe('campaigns/ai/plan', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    campaignId: CAMPAIGN_A, companyId: CO_A, mode: 'refine_day', message: 'Please refine Monday for me', ...over,
  });
  const untouched = () => {
    expect(mockModerate).not.toHaveBeenCalled(); // the LLM moderation call runs only after auth
    expect(mockRunPlan).not.toHaveBeenCalled();
    expect(mockPreview).not.toHaveBeenCalled();
    expect(writeCalls()).toHaveLength(0);
  };

  it('unauthenticated → 401, moderation (LLM) never called', async () => {
    const r = await invoke(plan, { method: 'POST', as: null, body: body() });
    expect(r.status).toBe(401);
    untouched();
  });
  it('member of A with B\'s campaign → 403/404, no leak', async () => {
    const r = await invoke(plan, { method: 'POST', as: 'A', body: body({ campaignId: CAMPAIGN_B, companyId: CO_B }) });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    untouched();
  });
  it('client companyId=B cannot override the campaign\'s bound tenant → 403', async () => {
    const r = await invoke(plan, { method: 'POST', as: 'A', body: body({ companyId: CO_B }) });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'Access denied to company' });
    untouched();
    expect(mockGetLatestCompanyContext).not.toHaveBeenCalled();
  });
  it('member of A with own campaign → 200, planner runs on the bound campaign', async () => {
    const r = await invoke(plan, { method: 'POST', as: 'A', body: body() });
    expect(r.status).toBe(200);
    expect(mockModerate).toHaveBeenCalledTimes(1);
    expect(mockRunPlan).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMPAIGN_A }));
  });
  it('generate_plan: the company-context read is keyed by the bound company, not the client value', async () => {
    const r = await invoke(plan, { method: 'POST', as: 'A', body: body({ mode: 'generate_plan', companyId: undefined }) });
    expect(r.status).toBe(200);
    expect(mockGetLatestCompanyContext).toHaveBeenCalledWith(CO_A, CAMPAIGN_A);
  });
  it('preview: unauthenticated → 401 and member of A previewing for company B → 403, no LLM call', async () => {
    const preview = {
      preview_mode: true, mode: 'generate_plan', companyId: CO_B,
      idea_spine: { title: 'Launch', selected_angle: 'angle' },
      strategy_context: { duration_weeks: 2, platforms: ['linkedin'], posting_frequency: { linkedin: 2 } },
    };
    const anon = await invoke(plan, { method: 'POST', as: null, body: preview });
    expect(anon.status).toBe(401);
    const foreign = await invoke(plan, { method: 'POST', as: 'A', body: preview });
    expect(foreign.status).toBe(403);
    untouched();
    const own = await invoke(plan, { method: 'POST', as: 'A', body: { ...preview, companyId: CO_A } });
    expect(own.status).toBe(200);
    expect(mockPreview).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A }));
  });
});
