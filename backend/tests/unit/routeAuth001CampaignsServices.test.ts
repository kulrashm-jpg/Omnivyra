/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — "Campaigns" family, part 2: routes that
 * delegate to services (LLM generation, blueprint stores, schedulers) or take
 * a non-campaign id (companyId, dayPlanId, user_id, campaignIds batch).
 *
 * THE DEFECT: none of these routes authenticated. Anonymous callers could spend
 * LLM budget, read any tenant's plans and memory, and overwrite any tenant's
 * blueprints, ROI reports and day plans. Each route now authenticates first
 * and binds every request-supplied id to the caller.
 *
 * The real guard chain runs; only the database, the identity provider and the
 * paid/heavy services are fake. Every denial asserts the service was NOT called.
 */
import {
  seed, invoke, writeCalls, sinkCalls, leaksB,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, USER_A, USER_B, CANARY_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

// ── paid / heavy services (the sinks) ──
const mockBlueprint = jest.fn(async (id: string) => ({ weeks: [{ week: 1, theme: id === 'camp-b-00-0000-0000-00000000000b' ? 'CANARY-COMPANY-B-CONFIDENTIAL' : 'Theme A' }] }));
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: (...a: any[]) => mockBlueprint(...(a as [string])) }));
jest.mock('../../utils/refineUserFacingResponse', () => ({ refineUserFacingResponse: async (x: unknown) => x }));

const mockCalcRoi = jest.fn((input: any) => ({ campaignId: input.campaignId, roi: 1.5 }));
const mockSaveRoi = jest.fn(async () => undefined);
jest.mock('../../services/roiService', () => ({ calculateROI: (...a: any[]) => mockCalcRoi(...(a as [any])) }));
jest.mock('../../db/forecastStore', () => ({ saveRoiReport: (...a: any[]) => mockSaveRoi(...(a as [])) }));

const mockFromStructured = jest.fn((x: any) => ({ campaign_id: x.campaign_id, weeks: x.weeks }));
const mockFromRecommendation = jest.fn((weeks: any[], campaignId: string) => ({ campaign_id: campaignId, weeks }));
jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromStructuredPlan: (...a: any[]) => mockFromStructured(...(a as [any])),
  fromRecommendationPlan: (...a: any[]) => mockFromRecommendation(...(a as [any[], string])),
  blueprintWeekToLegacyWeekPlan: (w: any) => w,
}));
const mockUpdateEditedCommitted = jest.fn(async () => undefined);
const mockSaveBlueprintFromRec = jest.fn(async () => undefined);
jest.mock('../../db/campaignPlanStore', () => ({
  updateToEditedCommitted: (...a: any[]) => mockUpdateEditedCommitted(...(a as [])),
  saveCampaignBlueprintFromRecommendation: (...a: any[]) => mockSaveBlueprintFromRec(...(a as [])),
}));

const mockUpdateActivity = jest.fn(async () => undefined);
jest.mock('../../services/executionPlannerService', () => ({ updateActivity: (...a: any[]) => mockUpdateActivity(...(a as [])) }));

const mockGetMemory = jest.fn(async () => ({ pastThemes: ['t'] }));
jest.mock('../../services/campaignMemoryService', () => ({ getCampaignMemory: (...a: any[]) => mockGetMemory(...(a as [])) }));

const mockGenerateStrategy = jest.fn(async () => ({ status: 'ready', campaign: { name: 'x' }, weekly_plan: [{ week: 1 }], daily_plan: [], trend_alerts: null }));
jest.mock('../../services/campaignRecommendationService', () => ({ generateCampaignStrategy: (...a: any[]) => mockGenerateStrategy(...(a as [])) }));
const mockSaveVersion = jest.fn(async () => undefined);
const mockSaveWeekVersions = jest.fn(async () => undefined);
const mockSaveTrend = jest.fn(async () => undefined);
const mockSaveOptHistory = jest.fn(async () => undefined);
jest.mock('../../db/campaignVersionStore', () => ({
  saveCampaignVersion: (...a: any[]) => mockSaveVersion(...(a as [])),
  saveWeekVersions: (...a: any[]) => mockSaveWeekVersions(...(a as [])),
  saveTrendSnapshot: (...a: any[]) => mockSaveTrend(...(a as [])),
  saveOptimizationHistory: (...a: any[]) => mockSaveOptHistory(...(a as [])),
}));
jest.mock('../../services/capacityFrequencyValidationGateway', () => ({ validateCapacityAndFrequency: () => ({ status: 'valid' }) }));
jest.mock('../../services/campaignPlanningInputsService', () => ({ getCampaignPlanningInputs: async () => null }));

const mockGetProfile = jest.fn(async () => ({ geography: 'US' }));
const mockOptimizeWeek = jest.fn(async () => ({ confidence: 0.9, changes: [] }));
const mockFetchTrends = jest.fn(async () => []);
const mockSendSnapshot = jest.fn(async () => undefined);
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: (...a: any[]) => mockGetProfile(...(a as [])) }));
jest.mock('../../services/campaignOptimizationService', () => ({ optimizeWeekPlan: (...a: any[]) => mockOptimizeWeek(...(a as [])) }));
jest.mock('../../services/externalApiService', () => ({ fetchTrendsFromApis: (...a: any[]) => mockFetchTrends(...(a as [])) }));
jest.mock('../../services/omnivyraFeedbackService', () => ({ sendLearningSnapshot: (...a: any[]) => mockSendSnapshot(...(a as [])) }));

const mockParsePlan = jest.fn(async () => ({ weeks: [{ week: 1, theme: 'W1' }] }));
jest.mock('../../services/campaignPlanParser', () => ({ parseAiPlanToWeeks: (...a: any[]) => mockParsePlan(...(a as [])) }));

const mockDetectConflicts = jest.fn(async () => []);
const mockSuggestRange = jest.fn(async () => null);
jest.mock('../../services/schedulingService', () => ({
  detectCampaignConflicts: (...a: any[]) => mockDetectConflicts(...(a as [])),
  suggestAvailableDateRange: (...a: any[]) => mockSuggestRange(...(a as [])),
}));

const mockRunAutopilot = jest.fn(async (week: any) => ({ week, summary: { total_items: 1 } }));
const mockPersistAutopilot = jest.fn(async () => ({ persisted: 1 }));
jest.mock('../../services/autopilotExecutionPipeline', () => ({
  runAutopilotForWeek: (...a: any[]) => mockRunAutopilot(...(a as [any])),
  persistAutopilotSchedule: (...a: any[]) => mockPersistAutopilot(...(a as [])),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/campaigns/${p}`).default;
const retrievePlan = route('retrieve-plan');
const roiReport = route('roi-report');
const updateEditedCommitted = route('update-edited-committed');
const updatePlatforms = route('update-platforms');
const memory = route('memory');
const recommendations = route('recommendations');
const optimizeWeek = route('recommendations/optimize-week');
const parseSavedPlan = route('parse-saved-plan');
const conflicts = route('conflicts');
const autopilotWeek = route('autopilot-week');
const stageAvailability = route('stage-availability-batch');
/* eslint-enable @typescript-eslint/no-var-requires */

const allServiceMocks = [
  mockBlueprint, mockCalcRoi, mockSaveRoi, mockFromStructured, mockFromRecommendation, mockUpdateEditedCommitted,
  mockSaveBlueprintFromRec, mockUpdateActivity, mockGetMemory, mockGenerateStrategy, mockSaveVersion, mockSaveWeekVersions,
  mockSaveTrend, mockSaveOptHistory, mockGetProfile, mockOptimizeWeek, mockFetchTrends, mockSendSnapshot, mockParsePlan,
  mockDetectConflicts, mockSuggestRange, mockRunAutopilot, mockPersistAutopilot,
];

beforeEach(() => {
  seed({
    content_plans: [
      { campaign_id: CAMPAIGN_A, content_type: 'ai_generated_plan', description: 'Plan A', created_at: '2026-01-02' },
      { campaign_id: CAMPAIGN_B, content_type: 'ai_generated_plan', description: CANARY_B, created_at: '2026-01-02' },
    ],
    daily_content_plans: [
      { id: 'day-a', campaign_id: CAMPAIGN_A, week_number: 1, platforms: ['LinkedIn'] },
      { id: 'day-b', campaign_id: CAMPAIGN_B, week_number: 1, platforms: ['LinkedIn'], content: CANARY_B },
    ],
  });
  allServiceMocks.forEach((m) => m.mockClear());
});

// ─────────────────────────────────────────── retrieve-plan (GET campaignId) ──
describe('retrieve-plan', () => {
  const sink = ['content_plans', 'ai_threads', 'campaign_week_plan'];
  it('unauthenticated → 401, nothing read', async () => {
    const r = await invoke(retrievePlan, { method: 'GET', as: null, query: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(sinkCalls(sink)).toHaveLength(0);
    expect(mockBlueprint).not.toHaveBeenCalled();
  });
  it('member of A cannot read B\'s plans → 403/404, no leak', async () => {
    const r = await invoke(retrievePlan, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(sink)).toHaveLength(0);
    expect(mockBlueprint).not.toHaveBeenCalled();
  });
  it('unknown campaign → 404', async () => {
    const r = await invoke(retrievePlan, { method: 'GET', as: 'A', query: { campaignId: UNKNOWN_ID } });
    expect(r.status).toBe(404);
    expect(mockBlueprint).not.toHaveBeenCalled();
  });
  it('member of A reads A\'s plans only', async () => {
    const r = await invoke(retrievePlan, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(r.body.savedPlan.content).toBe('Plan A');
    expect(leaksB(r.body)).toBe(false);
    expect(mockBlueprint).toHaveBeenCalledWith(CAMPAIGN_A);
  });
});

// ──────────────────────────────────────────────── roi-report (POST campaignId) ──
describe('roi-report', () => {
  it('unauthenticated → 401, ROI never computed or saved', async () => {
    const r = await invoke(roiReport, { method: 'POST', as: null, body: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(mockCalcRoi).not.toHaveBeenCalled();
    expect(mockSaveRoi).not.toHaveBeenCalled();
  });
  it('member of A cannot write an ROI report onto B\'s campaign → 403/404', async () => {
    const r = await invoke(roiReport, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_B, costInputs: {} } });
    expect([403, 404]).toContain(r.status);
    expect(mockSaveRoi).not.toHaveBeenCalled();
  });
  it('member of A → 200, saved against A\'s campaign', async () => {
    const r = await invoke(roiReport, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_A, costInputs: {} } });
    expect(r.status).toBe(200);
    expect(mockSaveRoi).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMPAIGN_A }));
  });
});

// ──────────────────────────────────── update-edited-committed (POST campaignId) ──
describe('update-edited-committed', () => {
  const plan = { weeks: [{ week: 1, theme: 'edited' }] };
  it('unauthenticated → 401, blueprint never written', async () => {
    const r = await invoke(updateEditedCommitted, { method: 'POST', as: null, body: { campaignId: CAMPAIGN_A, structuredPlan: plan } });
    expect(r.status).toBe(401);
    expect(mockUpdateEditedCommitted).not.toHaveBeenCalled();
  });
  it('member of A cannot overwrite B\'s committed plan → 403/404', async () => {
    const r = await invoke(updateEditedCommitted, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_B, structuredPlan: plan } });
    expect([403, 404]).toContain(r.status);
    expect(mockUpdateEditedCommitted).not.toHaveBeenCalled();
  });
  it('member of A → 200, writes A\'s blueprint', async () => {
    const r = await invoke(updateEditedCommitted, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_A, structuredPlan: plan } });
    expect(r.status).toBe(200);
    expect(mockUpdateEditedCommitted).toHaveBeenCalledWith(expect.objectContaining({ campaignId: CAMPAIGN_A }));
  });
});

// ─────────────────────────── update-platforms (PUT dayPlanId → owning campaign) ──
describe('update-platforms', () => {
  it('unauthenticated → 401 before the day plan is looked up', async () => {
    const r = await invoke(updatePlatforms, { method: 'PUT', as: null, body: { dayPlanId: 'day-a', platforms: ['X'] } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['daily_content_plans'])).toHaveLength(0);
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });
  it('member of A cannot modify B\'s day plan → 403/404, no leak', async () => {
    const r = await invoke(updatePlatforms, { method: 'PUT', as: 'A', body: { dayPlanId: 'day-b', platforms: ['X'] } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(mockUpdateActivity).not.toHaveBeenCalled();
    expect(writeCalls()).toHaveLength(0);
  });
  it('unknown day plan → 404', async () => {
    const r = await invoke(updatePlatforms, { method: 'PUT', as: 'A', body: { dayPlanId: UNKNOWN_ID, platforms: ['X'] } });
    expect(r.status).toBe(404);
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });
  it('member of A updates A\'s day plan', async () => {
    const r = await invoke(updatePlatforms, { method: 'PUT', as: 'A', body: { dayPlanId: 'day-a', platforms: ['X'], contentType: 'Case Study' } });
    expect(r.status).toBe(200);
    expect(mockUpdateActivity).toHaveBeenCalledWith('day-a', expect.anything(), 'board');
    expect(r.body.updatedPlan.id).toBe('day-a');
  });
});

// ───────────────────────────────────── memory (POST companyId [+ campaignId]) ──
describe('memory', () => {
  it('unauthenticated → 401, memory never loaded', async () => {
    const r = await invoke(memory, { method: 'POST', as: null, body: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(mockGetMemory).not.toHaveBeenCalled();
  });
  it('member of A naming company B → 403', async () => {
    const r = await invoke(memory, { method: 'POST', as: 'A', body: { companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(mockGetMemory).not.toHaveBeenCalled();
  });
  it('client companyId=A cannot unlock B\'s campaign → 404', async () => {
    const r = await invoke(memory, { method: 'POST', as: 'A', body: { companyId: CO_A, campaignId: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(mockGetMemory).not.toHaveBeenCalled();
  });
  it('client companyId=B with A\'s campaign cannot override the bound tenant → 403', async () => {
    const r = await invoke(memory, { method: 'POST', as: 'A', body: { companyId: CO_B, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(403);
    expect(mockGetMemory).not.toHaveBeenCalled();
  });
  it('member of A with A\'s company + campaign → 200', async () => {
    const r = await invoke(memory, { method: 'POST', as: 'A', body: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockGetMemory).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A }));
  });
});

// ──────────────────────────── recommendations (POST companyId + campaignId, LLM) ──
describe('recommendations', () => {
  it('unauthenticated → 401, no LLM spend, nothing saved', async () => {
    const r = await invoke(recommendations, { method: 'POST', as: null, body: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(mockGenerateStrategy).not.toHaveBeenCalled();
    expect(mockSaveBlueprintFromRec).not.toHaveBeenCalled();
  });
  it('client companyId=A cannot write a blueprint onto B\'s campaign → 404', async () => {
    const r = await invoke(recommendations, { method: 'POST', as: 'A', body: { companyId: CO_A, campaignId: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(mockGenerateStrategy).not.toHaveBeenCalled();
    expect(mockSaveBlueprintFromRec).not.toHaveBeenCalled();
    expect(mockSaveVersion).not.toHaveBeenCalled();
  });
  it('member of A naming company B → 403', async () => {
    const r = await invoke(recommendations, { method: 'POST', as: 'A', body: { companyId: CO_B, campaignId: CAMPAIGN_B } });
    expect(r.status).toBe(403);
    expect(mockGenerateStrategy).not.toHaveBeenCalled();
  });
  it('member of A → 200, persisted under A only', async () => {
    const r = await invoke(recommendations, { method: 'POST', as: 'A', body: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockSaveBlueprintFromRec).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A }));
    expect(mockSaveVersion).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A }));
  });
});

// ──────────────────────────── recommendations/optimize-week (POST companyId, LLM) ──
describe('recommendations/optimize-week', () => {
  const body = (companyId: string) => ({ companyId, weekNumber: 1, weeklyPlan: [{ week_number: 1 }] });
  it('unauthenticated → 401, profile/trends/LLM never touched', async () => {
    const r = await invoke(optimizeWeek, { method: 'POST', as: null, body: body(CO_A) });
    expect(r.status).toBe(401);
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockFetchTrends).not.toHaveBeenCalled();
    expect(mockOptimizeWeek).not.toHaveBeenCalled();
  });
  it('member of A cannot run against company B → 403, B\'s profile never read', async () => {
    const r = await invoke(optimizeWeek, { method: 'POST', as: 'A', body: body(CO_B) });
    expect(r.status).toBe(403);
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockSaveOptHistory).not.toHaveBeenCalled();
  });
  it('member of A → 200 for company A', async () => {
    const r = await invoke(optimizeWeek, { method: 'POST', as: 'A', body: body(CO_A) });
    expect(r.status).toBe(200);
    expect(mockGetProfile).toHaveBeenCalledWith(CO_A, expect.anything());
  });
});

// ──────────────────────────────────── parse-saved-plan (POST text, LLM only) ──
describe('parse-saved-plan', () => {
  it('unauthenticated → 401, no LLM spend', async () => {
    const r = await invoke(parseSavedPlan, { method: 'POST', as: null, body: { content: 'Week 1: ...' } });
    expect(r.status).toBe(401);
    expect(mockParsePlan).not.toHaveBeenCalled();
  });
  it('authenticated caller → 200', async () => {
    const r = await invoke(parseSavedPlan, { method: 'POST', as: 'A', body: { content: 'Week 1: ...' } });
    expect(r.status).toBe(200);
    expect(r.body.weeks).toHaveLength(1);
  });
});

// ─────────────────────────────── conflicts (GET, caller-scoped: user_id ignored) ──
describe('conflicts', () => {
  const q = { start_date: '2026-02-01', end_date: '2026-02-10' };
  it('unauthenticated → 401, scheduler never queried', async () => {
    const r = await invoke(conflicts, { method: 'GET', as: null, query: { ...q, user_id: USER_B } });
    expect(r.status).toBe(401);
    expect(mockDetectConflicts).not.toHaveBeenCalled();
  });
  it('member of A cannot query user B\'s campaigns via user_id → 403', async () => {
    const r = await invoke(conflicts, { method: 'GET', as: 'A', query: { ...q, user_id: USER_B, suggest_duration: '7' } });
    expect(r.status).toBe(403);
    expect(mockDetectConflicts).not.toHaveBeenCalled();
    expect(mockSuggestRange).not.toHaveBeenCalled();
  });
  it('exclude_campaign_id of another tenant → 403/404', async () => {
    const r = await invoke(conflicts, { method: 'GET', as: 'A', query: { ...q, exclude_campaign_id: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(mockDetectConflicts).not.toHaveBeenCalled();
  });
  it('authenticated caller → scoped to the caller\'s own id (user_id optional)', async () => {
    const r = await invoke(conflicts, { method: 'GET', as: 'A', query: { ...q, exclude_campaign_id: CAMPAIGN_A, suggest_duration: '7' } });
    expect(r.status).toBe(200);
    expect(mockDetectConflicts).toHaveBeenCalledWith(USER_A, expect.any(Date), expect.any(Date), CAMPAIGN_A);
    expect(mockSuggestRange).toHaveBeenCalledWith(USER_A, 7, expect.any(Date));
  });
  it('legacy caller passing its own user_id keeps working', async () => {
    const r = await invoke(conflicts, { method: 'GET', as: 'A', query: { ...q, user_id: USER_A } });
    expect(r.status).toBe(200);
    expect(mockDetectConflicts).toHaveBeenCalledWith(USER_A, expect.any(Date), expect.any(Date), undefined);
  });
});

// ─────────────────────────────── autopilot-week (POST week payload, LLM + write) ──
describe('autopilot-week', () => {
  const week = (campaignId?: string) => ({
    weekNumber: 1,
    daily_execution_items: [{ execution_id: 'e1', campaign_id: campaignId, week_number: 1 }],
  });
  it('unauthenticated → 401, no generation, nothing persisted', async () => {
    const r = await invoke(autopilotWeek, { method: 'POST', as: null, body: { week: week(CAMPAIGN_A) } });
    expect(r.status).toBe(401);
    expect(mockRunAutopilot).not.toHaveBeenCalled();
    expect(mockPersistAutopilot).not.toHaveBeenCalled();
  });
  it('member of A cannot run/persist against B\'s campaign → 403/404', async () => {
    const r = await invoke(autopilotWeek, { method: 'POST', as: 'A', body: { week: { ...week(CAMPAIGN_B), campaignId: CAMPAIGN_B } } });
    expect([403, 404]).toContain(r.status);
    expect(mockRunAutopilot).not.toHaveBeenCalled();
    expect(mockPersistAutopilot).not.toHaveBeenCalled();
  });
  it('B\'s campaign named only on the items is still bound → 403/404', async () => {
    const r = await invoke(autopilotWeek, { method: 'POST', as: 'A', body: { week: week(CAMPAIGN_B) } });
    expect([403, 404]).toContain(r.status);
    expect(mockPersistAutopilot).not.toHaveBeenCalled();
  });
  it('member of A → 200, persisted against A\'s bound campaign', async () => {
    const r = await invoke(autopilotWeek, { method: 'POST', as: 'A', body: { week: week(CAMPAIGN_A) } });
    expect(r.status).toBe(200);
    expect(mockPersistAutopilot).toHaveBeenCalledWith(expect.anything(), { campaignId: CAMPAIGN_A, weekNumber: 1 });
  });
  it('payload naming no campaign → compute-only (persist gets no campaign)', async () => {
    const r = await invoke(autopilotWeek, { method: 'POST', as: 'A', body: { week: week(undefined) } });
    expect(r.status).toBe(200);
    expect(mockPersistAutopilot).toHaveBeenCalledWith(expect.anything(), { campaignId: null, weekNumber: 1 });
  });
});

// ─────────────────────────── stage-availability-batch (GET campaignIds=a,b,c) ──
describe('stage-availability-batch', () => {
  const sink = ['weekly_content_refinements', 'daily_content_plans', 'scheduled_posts'];
  it('unauthenticated → 401, no campaign read', async () => {
    const r = await invoke(stageAvailability, { method: 'GET', as: null, query: { campaignIds: `${CAMPAIGN_A},${CAMPAIGN_B}` } });
    expect(r.status).toBe(401);
    expect(sinkCalls(sink)).toHaveLength(0);
    expect(sinkCalls(['campaign_versions'])).toHaveLength(0);
    expect(mockBlueprint).not.toHaveBeenCalled();
  });
  it('member of A asking for A and B gets A only — B is never computed', async () => {
    const r = await invoke(stageAvailability, { method: 'GET', as: 'A', query: { campaignIds: `${CAMPAIGN_A},${CAMPAIGN_B},${UNKNOWN_ID}` } });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.availability)).toEqual([CAMPAIGN_A]);
    expect(leaksB(r.body)).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain(CAMPAIGN_B);
    expect(sinkCalls(sink).every((c) => c.filters.campaign_id === CAMPAIGN_A)).toBe(true);
    expect(mockBlueprint).not.toHaveBeenCalledWith(CAMPAIGN_B);
    expect(r.body.availability[CAMPAIGN_A].counts.dailyPlans).toBe(1);
  });
  it('member of A asking only for B → empty availability, nothing computed', async () => {
    const r = await invoke(stageAvailability, { method: 'GET', as: 'A', query: { campaignIds: CAMPAIGN_B } });
    expect(r.status).toBe(200);
    expect(r.body.availability).toEqual({});
    expect(sinkCalls(sink)).toHaveLength(0);
  });
  it('super admin still sees any tenant\'s campaign (decided by requireCampaignAccess)', async () => {
    const r = await invoke(stageAvailability, { method: 'GET', as: 'SUPER', query: { campaignIds: CAMPAIGN_B } });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.availability)).toEqual([CAMPAIGN_B]);
  });
});
