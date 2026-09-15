/**
 * ROUTE-AUTH-001 (STEP 3AH-85) — campaign binding, family 2.
 *
 * Routes that AUTHENTICATED but never bound the request's campaign / company /
 * row ids to the caller's tenant (plus team/assignments, which had no auth at
 * all). Each case drives the real handler through the real guard chain
 * (requireCampaignAccess / enforceCompanyAccess / withRBAC); only the database,
 * the identity provider and paid/heavy services are faked. Denials assert the
 * SINK (table writes / mocked service) was never reached.
 *
 * Planner routes (planner-finalize, ai/plan, ai/plan-v2) live in
 * routeAuth001CampaignBinding2Planner.test.ts.
 */
import {
  seed, invoke, rows, writeCalls, sinkCalls, leaksB,
  CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID, USER_A, USER_B,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockSaveWeekPlans = jest.fn(async (..._a: any[]) => undefined);
const mockInsertActivity = jest.fn(async (..._a: any[]) => ({ id: 'new-row' }));
const mockUpdateActivity = jest.fn(async (..._a: any[]) => undefined);
const mockDeleteActivity = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../../services/executionPlannerService', () => ({
  saveWeekPlans: (...a: any[]) => mockSaveWeekPlans(...a),
  insertActivity: (...a: any[]) => mockInsertActivity(...a),
  updateActivity: (...a: any[]) => mockUpdateActivity(...a),
  deleteActivity: (...a: any[]) => mockDeleteActivity(...a),
}));
const mockGetCampaignMemory = jest.fn(async (..._a: any[]) => ({ pastThemes: [] }));
jest.mock('../../services/campaignMemoryService', () => ({ getCampaignMemory: (...a: any[]) => mockGetCampaignMemory(...a) }));
const mockDetectOverlap = jest.fn(async (..._a: any[]) => ({ similarityScore: 0.1, overlappingItems: [], recommendation: 'ok' }));
jest.mock('../../services/contentOverlapService', () => ({ detectContentOverlap: (...a: any[]) => mockDetectOverlap(...a) }));
jest.mock('../../utils/refineUserFacingResponse', () => ({ refineUserFacingResponse: async (d: unknown) => d }));
const mockAssignWeek = jest.fn(async (..._a: any[]) => undefined);
const mockUpdateWeekStatus = jest.fn(async (..._a: any[]) => undefined);
const mockGetUserAssignments = jest.fn(async (..._a: any[]) => []);
const mockGetCampaignTeam = jest.fn(async (..._a: any[]) => []);
jest.mock('../../services/teamService', () => ({
  assignWeek: (...a: any[]) => mockAssignWeek(...a),
  updateWeekStatus: (...a: any[]) => mockUpdateWeekStatus(...a),
  getUserAssignments: (...a: any[]) => mockGetUserAssignments(...a),
  getCampaignTeam: (...a: any[]) => mockGetCampaignTeam(...a),
}));
const mockAnalytics = jest.fn(async (..._a: any[]) => ({ totals: {} }));
jest.mock('../../services/recommendationAnalyticsService', () => ({ getRecommendationAnalytics: (...a: any[]) => mockAnalytics(...a) }));
const mockDecisionReport = jest.fn(async (..._a: any[]) => ({ sections: [] }));
jest.mock('../../services/decisionReportService', () => ({ getDecisionReportView: (...a: any[]) => mockDecisionReport(...a) }));
jest.mock('../../services/intelligenceExecutionContext', () => ({ runInApiReadContext: (_n: string, fn: () => unknown) => fn() }));

/* eslint-disable @typescript-eslint/no-var-requires */
const commitWeeklyPlan = require('../../../pages/api/campaigns/commit-weekly-plan').default;
const saveCampaign = require('../../../pages/api/campaigns/save').default;
const validateUniqueness = require('../../../pages/api/campaigns/validate-uniqueness').default;
const weeklyAlignments = require('../../../pages/api/campaigns/weekly-alignments').default;
const weeklyRefinement = require('../../../pages/api/campaigns/weekly-refinement').default;
const assignWeekRoute = require('../../../pages/api/team/assign-week').default;
const assignmentsRoute = require('../../../pages/api/team/assignments').default;
const analyticsRoute = require('../../../pages/api/recommendations/analytics').default;
const businessReport = require('../../../pages/api/campaigns/business-report').default;
const campaignsIndex = require('../../../pages/api/campaigns/index').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const B_SECRET = 'CANARY-COMPANY-B-CONFIDENTIAL';

beforeEach(() => {
  seed({
    weekly_content_refinements: [
      { id: 'ref-a', campaign_id: CAMPAIGN_A, week_number: 1, refinement_status: 'draft', theme: 'A theme' },
      { id: 'ref-b', campaign_id: CAMPAIGN_B, week_number: 1, refinement_status: 'draft', theme: B_SECRET },
    ],
    content_plans: [
      { id: 'plan-a', campaign_id: CAMPAIGN_A, week_number: 1, content: 'a', platform: 'linkedin', status: 'planned' },
      { id: 'plan-b', campaign_id: CAMPAIGN_B, week_number: 1, content: B_SECRET, platform: 'linkedin', status: 'planned' },
    ],
    daily_content_plans: [
      { id: 'dcp-a', campaign_id: CAMPAIGN_A, content: 'a', format_notes: 'content_plan_panel:true' },
      { id: 'dcp-b', campaign_id: CAMPAIGN_B, content: B_SECRET, format_notes: 'content_plan_panel:true' },
    ],
  });
  for (const m of [mockSaveWeekPlans, mockInsertActivity, mockUpdateActivity, mockDeleteActivity, mockGetCampaignMemory,
    mockDetectOverlap, mockAssignWeek, mockUpdateWeekStatus, mockGetUserAssignments, mockGetCampaignTeam, mockAnalytics,
    mockDecisionReport]) m.mockClear();
});

const row = (table: string, id: string) => rows(table).find((r) => r.id === id);

// ─────────────────────────────────────────────────────── commit-weekly-plan ──
describe('campaigns/commit-weekly-plan', () => {
  const body = (campaignId: string) => ({ campaignId, weekNumber: 1, weekData: { theme: 'T', focus_area: 'F' }, commitType: 'finalize' });

  it('unauthenticated → 401, nothing written, no daily plans generated', async () => {
    const r = await invoke(commitWeeklyPlan, { method: 'POST', as: null, body: body(CAMPAIGN_A) });
    expect(r.status).toBe(401);
    expect(writeCalls()).toHaveLength(0);
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();
  });
  it('member of A cannot finalize B\'s week → 403/404, B untouched', async () => {
    const r = await invoke(commitWeeklyPlan, { method: 'POST', as: 'A', body: body(CAMPAIGN_B) });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(writeCalls(['weekly_content_refinements'])).toHaveLength(0);
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();
    expect(row('weekly_content_refinements', 'ref-b')!.refinement_status).toBe('draft');
  });
  it('unknown campaign → 404, nothing written', async () => {
    const r = await invoke(commitWeeklyPlan, { method: 'POST', as: 'A', body: body(UNKNOWN_ID) });
    expect(r.status).toBe(404);
    expect(writeCalls()).toHaveLength(0);
  });
  it('member of A finalizes own week → 200', async () => {
    const r = await invoke(commitWeeklyPlan, { method: 'POST', as: 'A', body: body(CAMPAIGN_A) });
    expect(r.status).toBe(200);
    expect(row('weekly_content_refinements', 'ref-a')!.refinement_status).toBe('finalized');
    expect(row('weekly_content_refinements', 'ref-a')!.finalized_by).toBe(USER_A);
    expect(mockSaveWeekPlans).toHaveBeenCalledWith(CAMPAIGN_A, 1, expect.any(Array), 'blueprint');
  });
});

// ───────────────────────────────────────────────────────────── campaigns/save ──
describe('campaigns/save', () => {
  it('unauthenticated → 401, nothing written', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: null, body: { campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(writeCalls()).toHaveLength(0);
  });
  it('member of A cannot overwrite / take over B\'s campaign → 403/404, B untouched', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_B, name: 'pwned' } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(writeCalls(['campaigns'])).toHaveLength(0);
    const b = row('campaigns', CAMPAIGN_B)!;
    expect(b.user_id).toBe(USER_B);
    expect(b.name).toContain(B_SECRET);
  });
  it('an existing campaign with no owner record cannot be taken over → 404', async () => {
    seed({ campaigns: [{ id: 'camp-orphan', company_id: null, user_id: USER_B, name: 'orphan' }] });
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: 'camp-orphan' } });
    expect(r.status).toBe(404);
    expect(writeCalls(['campaigns'])).toHaveLength(0);
  });
  it('member of A saves own campaign → 200', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: CAMPAIGN_A, name: 'Renamed' } });
    expect(r.status).toBe(200);
    expect(writeCalls(['campaigns'])).toHaveLength(1);
  });
  it('a genuinely new id is still created → 200', async () => {
    const r = await invoke(saveCampaign, { method: 'POST', as: 'A', body: { campaignId: 'camp-brand-new', name: 'New' } });
    expect(r.status).toBe(200);
    expect(writeCalls(['campaigns'])[0].payload).toMatchObject({ id: 'camp-brand-new', user_id: USER_A });
  });
});

// ──────────────────────────────────────────────────── validate-uniqueness ──
describe('campaigns/validate-uniqueness', () => {
  const plan = { themes: ['x'] };
  it('unauthenticated → 401, memory never read', async () => {
    const r = await invoke(validateUniqueness, { method: 'POST', as: null, body: { companyId: CO_A, proposedPlan: plan } });
    expect(r.status).toBe(401);
    expect(mockGetCampaignMemory).not.toHaveBeenCalled();
  });
  it('member of A naming company B → 403, memory never read', async () => {
    const r = await invoke(validateUniqueness, { method: 'POST', as: 'A', body: { companyId: CO_B, proposedPlan: plan } });
    expect(r.status).toBe(403);
    expect(mockGetCampaignMemory).not.toHaveBeenCalled();
    expect(mockDetectOverlap).not.toHaveBeenCalled();
  });
  it('member of A pairing own company with B\'s campaign → 404, memory never read', async () => {
    const r = await invoke(validateUniqueness, { method: 'POST', as: 'A', body: { companyId: CO_A, campaignId: CAMPAIGN_B, proposedPlan: plan } });
    expect(r.status).toBe(404);
    expect(mockGetCampaignMemory).not.toHaveBeenCalled();
  });
  it('member of A with own company + campaign → 200', async () => {
    const r = await invoke(validateUniqueness, { method: 'POST', as: 'A', body: { companyId: CO_A, campaignId: CAMPAIGN_A, proposedPlan: plan } });
    expect(r.status).toBe(200);
    expect(mockGetCampaignMemory).toHaveBeenCalledWith({ companyId: CO_A, campaignId: CAMPAIGN_A });
  });
});

// ───────────────────────────────────────────────────── weekly-alignments ──
describe('campaigns/weekly-alignments', () => {
  const READ_SINKS = ['content_plans', 'ai_threads', 'weekly_alignment_summary', 'campaign_performance'];

  it('unauthenticated → 401, nothing read', async () => {
    const r = await invoke(weeklyAlignments, { method: 'GET', as: null, query: { campaignId: CAMPAIGN_A, action: 'weekly-alignments' } });
    expect(r.status).toBe(401);
    expect(sinkCalls(READ_SINKS)).toHaveLength(0);
  });
  it('member of A cannot read B\'s plan overview → 403/404, no leak', async () => {
    const r = await invoke(weeklyAlignments, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_B, action: 'plan-overview' } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(READ_SINKS)).toHaveLength(0);
  });
  it('member of A cannot align B\'s week → 403/404, nothing written', async () => {
    const r = await invoke(weeklyAlignments, {
      method: 'POST', as: 'A', query: { action: 'align-week' },
      body: { campaignId: CAMPAIGN_B, weekNumber: 1, status: 'aligned' },
    });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls()).toHaveLength(0);
  });
  it('query campaignId=A cannot unlock a POST whose body targets B', async () => {
    const r = await invoke(weeklyAlignments, {
      method: 'POST', as: 'A', query: { action: 'align-week', campaignId: CAMPAIGN_A },
      body: { campaignId: CAMPAIGN_B, weekNumber: 1, status: 'aligned' },
    });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls()).toHaveLength(0);
  });
  it('member of A cannot update B\'s alignment via the RPC → 403/404', async () => {
    const r = await invoke(weeklyAlignments, {
      method: 'PUT', as: 'A', query: { action: 'update-alignment' },
      body: { campaignId: CAMPAIGN_B, weekNumber: 1, status: 'aligned' },
    });
    expect([403, 404]).toContain(r.status);
    expect(sinkCalls(['rpc:update_weekly_alignment'])).toHaveLength(0);
  });
  it('member of A aligns own week; a spoofed reviewerId is replaced by the caller', async () => {
    const r = await invoke(weeklyAlignments, {
      method: 'POST', as: 'A', query: { action: 'align-week' },
      body: { campaignId: CAMPAIGN_A, weekNumber: 1, status: 'aligned', reviewerId: USER_B },
    });
    expect(r.status).toBe(200);
    expect(row('content_plans', 'plan-a')!.reviewed_by).toBe(USER_A);
    expect(row('content_plans', 'plan-b')!.reviewed_by).toBeUndefined();
  });
  it('member of A reads own alignments → 200', async () => {
    const r = await invoke(weeklyAlignments, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A, action: 'weekly-alignments' } });
    expect(r.status).toBe(200);
    expect(leaksB(r.body)).toBe(false);
  });
});

// ───────────────────────────────────────────────────── weekly-refinement ──
describe('campaigns/weekly-refinement', () => {
  it('unauthenticated → 401, nothing read', async () => {
    const r = await invoke(weeklyRefinement, { method: 'GET', as: null, query: { campaignId: CAMPAIGN_A, weekNumber: '1', action: 'weekly-refinement' } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['weekly_content_refinements', 'content_plans'])).toHaveLength(0);
  });
  it('member of A cannot read B\'s refinement → 403/404, no leak', async () => {
    const r = await invoke(weeklyRefinement, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_B, weekNumber: '1', action: 'weekly-refinement' } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
    expect(sinkCalls(['weekly_content_refinements', 'content_plans'])).toHaveLength(0);
  });
  it('member of A reads own refinement → 200', async () => {
    const r = await invoke(weeklyRefinement, { method: 'GET', as: 'A', query: { campaignId: CAMPAIGN_A, weekNumber: 1, action: 'weekly-refinement' } });
    expect(r.status).toBe(200);
    expect(leaksB(r.body)).toBe(false);
  });
  it('manual-edit on B\'s campaign → 403/404, nothing written', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'POST', as: 'A', query: { action: 'manual-edit' },
      body: { campaignId: CAMPAIGN_B, weekNumber: 1, editedContent: [{ id: 'plan-b', content: 'pwned' }] },
    });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls()).toHaveLength(0);
    expect(row('content_plans', 'plan-b')!.content).toBe(B_SECRET);
  });
  it('manual-edit on own campaign cannot reach B\'s content_plans row by item id; editor = caller', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'POST', as: 'A', query: { action: 'manual-edit' },
      body: {
        campaignId: CAMPAIGN_A, weekNumber: 1, userId: USER_B,
        editedContent: [{ id: 'plan-a', content: 'edited-a' }, { id: 'plan-b', content: 'pwned' }],
      },
    });
    expect(r.status).toBe(200);
    expect(row('content_plans', 'plan-b')!.content).toBe(B_SECRET);
    expect(row('content_plans', 'plan-a')!.content).toBe('edited-a');
    expect(row('content_plans', 'plan-a')!.manual_edits.edited_by).toBe(USER_A);
  });
  it('update-refinement with B\'s refinementId (no campaignId) → 403/404, B untouched', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'PUT', as: 'A', query: { action: 'update-refinement' },
      body: { refinementId: 'ref-b', updates: { refinement_status: 'pwned' } },
    });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls()).toHaveLength(0);
    expect(row('weekly_content_refinements', 'ref-b')!.refinement_status).toBe('draft');
  });
  it('update-refinement: own campaignId paired with B\'s refinementId cannot write B', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'PUT', as: 'A', query: { action: 'update-refinement' },
      body: { campaignId: CAMPAIGN_A, refinementId: 'ref-b', updates: { refinement_status: 'pwned' } },
    });
    expect(r.status).toBe(200);
    expect(row('weekly_content_refinements', 'ref-b')!.refinement_status).toBe('draft');
  });
  it('update-refinement cannot re-key an own row into B\'s campaign', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'PUT', as: 'A', query: { action: 'update-refinement' },
      body: { refinementId: 'ref-a', updates: { refinement_status: 'reviewed', campaign_id: CAMPAIGN_B, id: 'ref-x' } },
    });
    expect(r.status).toBe(200);
    const a = row('weekly_content_refinements', 'ref-a')!;
    expect(a.campaign_id).toBe(CAMPAIGN_A);
    expect(a.refinement_status).toBe('reviewed');
  });
  it('update-refinement with an unknown refinementId → 404', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'PUT', as: 'A', query: { action: 'update-refinement' },
      body: { refinementId: UNKNOWN_ID, updates: { refinement_status: 'x' } },
    });
    expect(r.status).toBe(404);
    expect(writeCalls()).toHaveLength(0);
  });
  it('finalize-week: finalized_by is the caller, never body.userId', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'POST', as: 'A', query: { action: 'finalize-week' },
      body: { campaignId: CAMPAIGN_A, weekNumber: 1, userId: USER_B },
    });
    expect(r.status).toBe(200);
    const rpc = sinkCalls(['rpc:finalize_weekly_content']);
    expect(rpc).toHaveLength(1);
    expect(rpc[0].payload).toMatchObject({ campaign_uuid: CAMPAIGN_A, finalized_by_uuid: USER_A });
  });
  it('populate-daily on B\'s campaign → 403/404, RPC never called', async () => {
    const r = await invoke(weeklyRefinement, {
      method: 'POST', as: 'A', query: { action: 'populate-daily' }, body: { campaignId: CAMPAIGN_B, weekNumber: 1 },
    });
    expect([403, 404]).toContain(r.status);
    expect(sinkCalls(['rpc:populate_daily_plans_from_weekly'])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────── team/assign-week ──
describe('team/assign-week', () => {
  const assign = (over: Record<string, unknown> = {}) => ({
    campaign_id: CAMPAIGN_A, week_number: 1, assigned_to_user_id: USER_A, assigned_by_user_id: USER_A, ...over,
  });
  it('unauthenticated → 401, nothing assigned', async () => {
    const r = await invoke(assignWeekRoute, { method: 'POST', as: null, body: assign() });
    expect(r.status).toBe(401);
    expect(mockAssignWeek).not.toHaveBeenCalled();
  });
  it('member of A cannot assign a week of B\'s campaign → 403/404', async () => {
    const r = await invoke(assignWeekRoute, { method: 'POST', as: 'A', body: assign({ campaign_id: CAMPAIGN_B }) });
    expect([403, 404]).toContain(r.status);
    expect(mockAssignWeek).not.toHaveBeenCalled();
  });
  it('a spoofed assigned_by_user_id is refused (actor = caller)', async () => {
    const r = await invoke(assignWeekRoute, { method: 'POST', as: 'A', body: assign({ assigned_by_user_id: USER_B }) });
    expect(r.status).toBe(403);
    expect(mockAssignWeek).not.toHaveBeenCalled();
  });
  it('the assignee must be a member of the campaign\'s company', async () => {
    const r = await invoke(assignWeekRoute, { method: 'POST', as: 'A', body: assign({ assigned_to_user_id: USER_B }) });
    expect(r.status).toBe(400);
    expect(mockAssignWeek).not.toHaveBeenCalled();
  });
  it('member of A assigns within own campaign → 200', async () => {
    const r = await invoke(assignWeekRoute, { method: 'POST', as: 'A', body: assign() });
    expect(r.status).toBe(200);
    expect(mockAssignWeek).toHaveBeenCalledWith(CAMPAIGN_A, 1, USER_A, USER_A);
  });
  it('PATCH on B\'s campaign → 403/404, status untouched', async () => {
    const r = await invoke(assignWeekRoute, { method: 'PATCH', as: 'A', body: { campaign_id: CAMPAIGN_B, week_number: 1, status: 'completed', user_id: USER_A } });
    expect([403, 404]).toContain(r.status);
    expect(mockUpdateWeekStatus).not.toHaveBeenCalled();
  });
  it('PATCH with a spoofed user_id is refused; own actor → 200', async () => {
    const spoof = await invoke(assignWeekRoute, { method: 'PATCH', as: 'A', body: { campaign_id: CAMPAIGN_A, week_number: 1, status: 'completed', user_id: USER_B } });
    expect(spoof.status).toBe(403);
    expect(mockUpdateWeekStatus).not.toHaveBeenCalled();
    const ok = await invoke(assignWeekRoute, { method: 'PATCH', as: 'A', body: { campaign_id: CAMPAIGN_A, week_number: 1, status: 'completed', user_id: USER_A } });
    expect(ok.status).toBe(200);
    expect(mockUpdateWeekStatus).toHaveBeenCalledWith(CAMPAIGN_A, 1, 'completed', USER_A, undefined);
  });
});

// ─────────────────────────────────────────────────────────── team/assignments ──
describe('team/assignments (was: no authentication)', () => {
  it('unauthenticated → 401, nothing read', async () => {
    const r = await invoke(assignmentsRoute, { method: 'GET', as: null, query: { user_id: USER_B } });
    expect(r.status).toBe(401);
    expect(mockGetUserAssignments).not.toHaveBeenCalled();
    expect(mockGetCampaignTeam).not.toHaveBeenCalled();
  });
  it('member of A cannot list B\'s campaign team → 403/404', async () => {
    const r = await invoke(assignmentsRoute, { method: 'GET', as: 'A', query: { user_id: USER_A, campaign_id: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(mockGetCampaignTeam).not.toHaveBeenCalled();
  });
  it('member of A lists own campaign team → 200', async () => {
    const r = await invoke(assignmentsRoute, { method: 'GET', as: 'A', query: { user_id: USER_A, campaign_id: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockGetCampaignTeam).toHaveBeenCalledWith(CAMPAIGN_A);
  });
  it('a caller cannot read another user\'s assignments → 403', async () => {
    const r = await invoke(assignmentsRoute, { method: 'GET', as: 'A', query: { user_id: USER_B } });
    expect(r.status).toBe(403);
    expect(mockGetUserAssignments).not.toHaveBeenCalled();
  });
  it('a caller reads own assignments → 200', async () => {
    const r = await invoke(assignmentsRoute, { method: 'GET', as: 'A', query: { user_id: USER_A, status: 'completed' } });
    expect(r.status).toBe(200);
    expect(mockGetUserAssignments).toHaveBeenCalledWith(USER_A, { status: 'completed' });
  });
});

// ─────────────────────────────────────────────────── recommendations/analytics ──
describe('recommendations/analytics', () => {
  it('unauthenticated → 401, analytics never computed', async () => {
    const r = await invoke(analyticsRoute, { method: 'GET', as: null, query: { companyId: CO_A } });
    expect(r.status).toBe(401);
    expect(mockAnalytics).not.toHaveBeenCalled();
  });
  it('member of A naming company B → 403', async () => {
    const r = await invoke(analyticsRoute, { method: 'GET', as: 'A', query: { companyId: CO_B } });
    expect(r.status).toBe(403);
    expect(mockAnalytics).not.toHaveBeenCalled();
  });
  it('member of A pairing own company with B\'s campaign → 404 (performance_feedback is campaign-keyed)', async () => {
    const r = await invoke(analyticsRoute, { method: 'GET', as: 'A', query: { companyId: CO_A, campaignId: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(mockAnalytics).not.toHaveBeenCalled();
  });
  it('member of A with own company + campaign → 200', async () => {
    const r = await invoke(analyticsRoute, { method: 'GET', as: 'A', query: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockAnalytics).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A }));
  });
  it('a body-authorized companyId is the one the query runs with (never an unfiltered read)', async () => {
    const r = await invoke(analyticsRoute, { method: 'GET', as: 'A', query: {}, body: { companyId: CO_A } });
    expect(r.status).toBe(200);
    expect(mockAnalytics).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A }));
  });
});

// ─────────────────────────────────────────────────────────── business-report ──
describe('campaigns/business-report (bound by the shared enforceCompanyAccess campaign binding)', () => {
  it('unauthenticated → 401', async () => {
    const r = await invoke(businessReport, { method: 'GET', as: null, query: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(mockDecisionReport).not.toHaveBeenCalled();
  });
  it('member of A pairing own company with B\'s campaign → 404, campaigns row never read', async () => {
    const r = await invoke(businessReport, { method: 'GET', as: 'A', query: { companyId: CO_A, campaignId: CAMPAIGN_B } });
    expect(r.status).toBe(404);
    expect(leaksB(r.body)).toBe(false);
    // Exactly one campaigns read: the binder's own ownership probe (company_id
    // only). The route's origin_source read never runs.
    expect(sinkCalls(['campaigns'])).toHaveLength(1);
    expect(mockDecisionReport).not.toHaveBeenCalled();
  });
  it('member of A with own campaign → 200', async () => {
    const r = await invoke(businessReport, { method: 'GET', as: 'A', query: { companyId: CO_A, campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(200);
    expect(mockDecisionReport).toHaveBeenCalledWith(expect.objectContaining({ companyId: CO_A, entityId: CAMPAIGN_A }));
  });
});

// ─────────────────────────────────────────────── campaigns (content-plan CRUD) ──
describe('campaigns/index content-plan CRUD', () => {
  it('unauthenticated GET → 401, nothing read', async () => {
    const r = await invoke(campaignsIndex, { method: 'GET', as: null, query: { type: 'content-plan', campaignId: CAMPAIGN_A } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['daily_content_plans'])).toHaveLength(0);
  });
  it('unauthenticated row-keyed DELETE → 401 before the row is looked up', async () => {
    const r = await invoke(campaignsIndex, { method: 'DELETE', as: null, body: { type: 'content-plan', id: 'dcp-b' } });
    expect(r.status).toBe(401);
    expect(sinkCalls(['daily_content_plans'])).toHaveLength(0);
    expect(mockDeleteActivity).not.toHaveBeenCalled();
  });
  it('member of A cannot list B\'s content plans → 403/404, no leak', async () => {
    const r = await invoke(campaignsIndex, { method: 'GET', as: 'A', query: { type: 'content-plan', campaignId: CAMPAIGN_B } });
    expect([403, 404]).toContain(r.status);
    expect(leaksB(r.body)).toBe(false);
  });
  it('own campaignId + B\'s row id on PUT → 404, row never updated (the defect)', async () => {
    const r = await invoke(campaignsIndex, {
      method: 'PUT', as: 'A', body: { type: 'content-plan', data: { campaignId: CAMPAIGN_A, id: 'dcp-b', content: 'pwned' } },
    });
    expect(r.status).toBe(404);
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });
  it('B\'s row id alone on DELETE → 403/404, row never deleted', async () => {
    const r = await invoke(campaignsIndex, { method: 'DELETE', as: 'A', body: { type: 'content-plan', id: 'dcp-b' } });
    expect([403, 404]).toContain(r.status);
    expect(mockDeleteActivity).not.toHaveBeenCalled();
  });
  it('member of A updates / deletes / lists own rows → 200', async () => {
    const put = await invoke(campaignsIndex, { method: 'PUT', as: 'A', body: { type: 'content-plan', data: { id: 'dcp-a', content: 'new' } } });
    expect(put.status).toBe(200);
    expect(mockUpdateActivity).toHaveBeenCalledWith('dcp-a', { content: 'new' }, 'board');
    const del = await invoke(campaignsIndex, { method: 'DELETE', as: 'A', body: { type: 'content-plan', id: 'dcp-a' } });
    expect(del.status).toBe(200);
    expect(mockDeleteActivity).toHaveBeenCalledWith('dcp-a');
    const list = await invoke(campaignsIndex, { method: 'GET', as: 'A', query: { type: 'content-plan', campaignId: CAMPAIGN_A } });
    expect(list.status).toBe(200);
    expect(leaksB(list.body)).toBe(false);
  });
});
