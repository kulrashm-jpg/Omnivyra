/**
 * Strategic Mix P4 — characterization of planner finalize + the planner→
 * execution adapter, written BEFORE the Execution Handoff touches them.
 *
 * Locks the pre-P4 execution contract:
 *  - finalize gates (method / auth / required inputs / confirmed handoff)
 *  - BOTH slot paths (adapter with source='planner', inline without) route
 *    through saveWeekPlans — the canonical execution engine seam — with
 *    placeholder content rows and status 'planned'
 *  - duplicate-slot protection (400 when daily_content_plans already exist)
 *  - the campaign advances to execution_ready
 *
 * P4 may only ADD to the row content JSON (creator_asset passthrough); every
 * assertion here must stay green afterwards.
 */

type Row = Record<string, unknown>;
let dailySlotRows: Row[] = [];
let campaignInserts: Row[] = [];
let campaignUpdates: Row[] = [];
let versionInserts: Row[] = [];
const saveWeekPlansCalls: Array<{ campaignId: string; week: number; rows: Row[]; source: string }> = [];
const savedStructuredPlans: Row[] = [];
const committedBlueprints: Row[] = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      for (const op of ['select', 'eq', 'order', 'limit', 'like']) {
        builder[op] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
      builder.single = () => Promise.resolve({ data: campaignInserts[campaignInserts.length - 1] ?? null, error: null });
      builder.insert = (payload: Row) => {
        if (table === 'campaigns') campaignInserts.push(payload);
        if (table === 'campaign_versions') versionInserts.push(payload);
        const ins: any = {
          select: () => ({ single: () => Promise.resolve({ data: payload, error: null }) }),
          then: (res: any) => Promise.resolve({ error: null }).then(res),
        };
        return ins;
      };
      builder.update = (payload: Row) => {
        if (table === 'campaigns') campaignUpdates.push(payload);
        const upd: any = { eq: () => upd, then: (res: any) => Promise.resolve({ error: null }).then(res) };
        return upd;
      };
      builder.then = (res: any) =>
        Promise.resolve({ data: table === 'daily_content_plans' ? dailySlotRows : [], error: null }).then(res);
      return builder;
    },
  },
}));

// ── R5 harness repair ────────────────────────────────────────────────────
// planner-finalize gained requireTenantAccess (B4.2) AFTER this
// characterization was written, and the suite never mocked it — so every
// authenticated case died at TenantGuard's own 401 before reaching a single
// route assertion. Mocking it restores the intended authenticated
// environment. Deliberately CONTROLLABLE rather than a blanket grant, so
// tenancy stays ASSERTED by this suite instead of bypassed by it.
let mockTenantAccessGranted = true;
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: jest.fn(async (_req: unknown, res: any) => {
    if (!mockTenantAccessGranted) {
      res.status(403).json({ error: 'Not a member of this organization', code: 'NOT_A_MEMBER' });
      return null;
    }
    return {
      userId: 'user-1', supabaseUid: 'uid-1', organizationId: 'co-1',
      role: 'COMPANY_ADMIN', bypass: false, isPlatformSuperAdmin: false,
    };
  }),
}));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async (req: { headers?: Record<string, string> }) =>
    req.headers?.authorization ? { user: { id: 'user-1' }, error: null } : { user: null, error: 'no auth' }),
}));
jest.mock('../../db/campaignStore', () => ({ getCampaignById: jest.fn(async () => null) }));
jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromStructuredPlan: jest.fn((input: unknown) => ({ blueprint: true, input })),
}));
jest.mock('../../db/campaignPlanStore', () => ({
  saveStructuredCampaignPlan: jest.fn(async (p: Row) => { savedStructuredPlans.push(p); }),
  commitDraftBlueprint: jest.fn(async (p: Row) => { committedBlueprints.push(p); }),
}));
jest.mock('../../services/executionPlannerService', () => ({
  generateFromManualPlanner: jest.fn(async () => undefined),
  saveWeekPlans: jest.fn(async (campaignId: string, week: number, rows: Row[], source: string) => {
    saveWeekPlansCalls.push({ campaignId, week, rows, source });
  }),
}));
jest.mock('../../db/campaignVersionStore', () => ({ syncCampaignVersionStage: jest.fn(async () => undefined) }));
jest.mock('../../services/campaignPlanningInputsService', () => ({ saveCampaignPlanningInputs: jest.fn(async () => undefined) }));
jest.mock('../../services/plannerIntegrityService', () => ({ validateCalendarPlan: jest.fn(() => ({ valid: true, errors: [] })) }));
jest.mock('../../services/campaignContextService', () => ({ saveCampaignContextSnapshot: jest.fn(async () => undefined) }));
jest.mock('../../services/creator/campaignPlanValidationService', () => ({
  plannedAssetsFromActivities: jest.fn(() => []),
  validateCampaignPlanAssets: jest.fn(async () => ({ ok: true, perAsset: [] })),
}));
jest.mock('../../services/orchestration', () => ({
  reconcileExecution: jest.fn(async () => undefined),
  runAuthoritativeGenerationGate: jest.fn(async () => undefined),
}));
jest.mock('../../services/strategy', () => ({ getOrCreateCampaignStrategy: jest.fn(async () => undefined) }));

import finalizeHandler from '../../../pages/api/campaigns/planner-finalize';
import { adaptPlannerOutputToExecutionFormat, AdapterValidationError } from '../../../lib/adapters/plannerToExecutionAdapter';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  return res;
}

const activity = (over: Row = {}): Row => ({
  execution_id: 'ex-1',
  week_number: 1,
  day: 'Monday',
  platform: 'linkedin',
  content_type: 'carousel',
  title: 'Kickoff deck',
  ...over,
});

function finalizeBody(over: Row = {}): Row {
  return {
    companyId: 'co-1',
    idea_spine: { title: 'Launch Q4', description: 'Big push' },
    strategy_context: { duration_weeks: 1, platforms: ['linkedin'], posting_frequency: { linkedin: 1 }, content_mix: ['carousel'], campaign_goal: 'awareness', target_audience: 'CTOs', planned_start_date: '2026-08-03' },
    execution_handoff: { skeleton_confirmed: true, strategy_confirmed: true },
    calendar_plan: { activities: [activity()] },
    ...over,
  };
}

const post = (body: Row, authed = true) =>
  ({ method: 'POST', body, headers: authed ? { authorization: 'Bearer t' } : {} }) as any;

beforeEach(() => {
  dailySlotRows = [];
  campaignInserts = [];
  campaignUpdates = [];
  versionInserts = [];
  saveWeekPlansCalls.length = 0;
  savedStructuredPlans.length = 0;
  committedBlueprints.length = 0;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('planner-finalize — gates (pre-P4 contract)', () => {
  it('rejects non-POST, unauthenticated, and incomplete requests', async () => {
    let res = mockRes();
    await finalizeHandler({ method: 'GET' } as any, res);
    expect(res.statusCode).toBe(405);

    res = mockRes();
    await finalizeHandler(post(finalizeBody(), false), res);
    expect(res.statusCode).toBe(401);

    res = mockRes();
    await finalizeHandler(post(finalizeBody({ companyId: undefined })), res);
    expect(res.statusCode).toBe(400);

    res = mockRes();
    await finalizeHandler(post(finalizeBody({ execution_handoff: { skeleton_confirmed: true, strategy_confirmed: false } })), res);
    expect(res.statusCode).toBe(400);
    expect(String((res.body as { error: string }).error)).toMatch(/confirmed/i);
  });

  it('rejects when slots already exist for the campaign (duplicate protection)', async () => {
    dailySlotRows = [{ id: 'slot-1' }];
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ source: 'planner' })), res);
    expect(res.statusCode).toBe(400);
    expect(String((res.body as { error: string }).error)).toMatch(/already exist/i);
  });
});

describe('planner-finalize — both slot paths route through saveWeekPlans (canonical engine)', () => {
  it('ADAPTER path (source=planner): placeholder rows, status planned, execution_ready', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ source: 'planner' })), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { campaign_id: string }).campaign_id).toBeTruthy();

    // Blueprint persisted via the canonical plan store
    expect(savedStructuredPlans).toHaveLength(1);
    expect(committedBlueprints).toHaveLength(1);

    // Slots via the execution engine seam — never direct inserts
    expect(saveWeekPlansCalls).toHaveLength(1);
    const row = saveWeekPlansCalls[0].rows[0];
    expect(row).toMatchObject({ week_number: 1, day_of_week: 'Monday', platform: 'linkedin', content_type: 'carousel', status: 'planned', execution_id: 'ex-1' });
    const content = JSON.parse(String(row.content));
    expect(content.placeholder).toBe(true);
    expect(content.is_planner_generated).toBe(true);

    // Campaign ends execution_ready
    expect(campaignUpdates.some((u) => u.current_stage === 'execution_ready')).toBe(true);
  });

  it('INLINE path (no source): placeholder rows through the same seam', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody()), res);
    expect(res.statusCode).toBe(200);
    expect(saveWeekPlansCalls).toHaveLength(1);
    const row = saveWeekPlansCalls[0].rows[0];
    expect(row).toMatchObject({ status: 'planned', platform: 'linkedin', content_type: 'carousel' });
    const content = JSON.parse(String(row.content));
    expect(content).toMatchObject({ placeholder: true, label: 'linkedin carousel' });
  });

  it('rejects activities missing required placement fields', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ calendar_plan: { activities: [activity({ platform: undefined })] } })), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('plannerToExecutionAdapter — pure mapping (pre-P4 contract)', () => {
  it('maps planner activities to execution rows with the placeholder gate intact', () => {
    const rows = adaptPlannerOutputToExecutionFormat({
      activities: [activity() as never],
      campaignId: 'camp-1',
      startDate: '2026-08-03',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      campaign_id: 'camp-1',
      week_number: 1,
      day_of_week: 'Monday',
      date: '2026-08-03',
      platform: 'linkedin',
      content_type: 'carousel',
      title: 'Kickoff deck',
      status: 'planned',
      ai_generated: false,
      generation_source: 'manual',
      execution_id: 'ex-1',
    });
    expect(JSON.parse(rows[0].content)).toMatchObject({ placeholder: true, is_planner_generated: true });
  });

  it('validates inputs strictly', () => {
    expect(() => adaptPlannerOutputToExecutionFormat({ activities: [], campaignId: 'c', startDate: '2026-08-03' })).toThrow(AdapterValidationError);
    expect(() => adaptPlannerOutputToExecutionFormat({ activities: [activity() as never], campaignId: 'c', startDate: 'nope' })).toThrow(AdapterValidationError);
  });
});

describe('P4 — Assignment materialization rides the SAME pipeline (no second path)', () => {
  const CREATOR_ASSET = {
    asset_id: 'car-1',
    asset_version: 2,
    creatorType: 'carousel',
    title: 'Framework deck',
    url: 'https://cdn/car1.png',
    assignment_id: 'asg-1',
  };
  const materializedActivity = () => activity({ creator_asset: CREATOR_ASSET, content_status: 'READY_FOR_PROMOTION' });

  it('ADAPTER path passes creator_asset + content_status through the content JSON', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ source: 'planner', calendar_plan: { activities: [materializedActivity()] } })), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content.placeholder).toBe(true); // the engine gate is intact
    expect(content.creator_asset).toEqual(CREATOR_ASSET);
    expect(content.content_status).toBe('READY_FOR_PROMOTION');
  });

  it('INLINE path passes creator_asset + content_status identically', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ calendar_plan: { activities: [materializedActivity()] } })), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content).toMatchObject({ placeholder: true, creator_asset: CREATOR_ASSET, content_status: 'READY_FOR_PROMOTION' });
  });

  it('activities WITHOUT assignments keep the exact pre-P4 placeholder shape', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody()), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content.creator_asset).toBeUndefined();
    expect(content.content_status).toBeUndefined();
  });

  it('records the assignment relationships in the version snapshot (audit/recovery)', async () => {
    const assignments = [{ id: 'asg-1', asset_id: 'car-1', structure_id: 'ex-1', status: 'materialized' }];
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({
      source: 'planner',
      execution_handoff: { skeleton_confirmed: true, strategy_confirmed: true, assignments },
    })), res);
    expect(res.statusCode).toBe(200);
    const snapshot = versionInserts[0]?.campaign_snapshot as { planning_context?: { assignments?: unknown } };
    expect(snapshot?.planning_context?.assignments).toEqual(assignments);
  });
});

describe('R3-P1 — Content Workspace copy rides the SAME pipeline (additive passthrough)', () => {
  const DRAFT = { body: 'Approved LinkedIn copy.\n\n#launch', source: 'ai', updated_at: '2026-07-12T09:00:00.000Z' };
  const draftedActivity = () => activity({ draft_content: DRAFT, content_planning_status: 'approved' });

  it('ADAPTER path passes draft_content + content_planning_status through the content JSON', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ source: 'planner', calendar_plan: { activities: [draftedActivity()] } })), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content.placeholder).toBe(true); // the engine gate is intact
    expect(content.draft_content).toEqual(DRAFT);
    expect(content.content_planning_status).toBe('approved');
  });

  it('INLINE path passes draft_content + content_planning_status identically', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({ calendar_plan: { activities: [draftedActivity()] } })), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content).toMatchObject({ placeholder: true, draft_content: DRAFT, content_planning_status: 'approved' });
  });

  it('activities WITHOUT workspace content keep the exact pre-R3 placeholder shape', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody()), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content.draft_content).toBeUndefined();
    expect(content.content_planning_status).toBeUndefined();
  });

  it('empty draft bodies are dropped, never persisted', async () => {
    const res = mockRes();
    await finalizeHandler(post(finalizeBody({
      calendar_plan: { activities: [activity({ draft_content: { body: '   ' }, content_planning_status: 'draft' })] },
    })), res);
    expect(res.statusCode).toBe(200);
    const content = JSON.parse(String(saveWeekPlansCalls[0].rows[0].content));
    expect(content.draft_content).toBeUndefined();
    expect(content.content_planning_status).toBe('draft');
  });
});
