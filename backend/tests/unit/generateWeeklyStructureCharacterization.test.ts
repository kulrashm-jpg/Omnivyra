/**
 * CHARACTERIZATION SUITE — pages/api/campaigns/generate-weekly-structure.ts
 * (generateWeeklyStructure + the Next handler).
 *
 * Locks CURRENT observable behavior of the BOLT-critical weekly planner so future
 * refactoring can be verified against a golden master. NOT a spec of desired behavior —
 * if a test fails after an intentional product change, update it deliberately.
 *
 * Seams mocked (external boundaries only):
 *   DB          → backend/db/supabaseClient (scripted chainable builder),
 *                 campaignVersionStore
 *   services    → campaignBlueprintService, platformExecutionValidator (identity),
 *                 campaignExecutionFeedbackService, platformIntelligenceService,
 *                 publishingOptimizationService, campaignWaveService,
 *                 campaignLearningService, contextCompressionService,
 *                 campaignStrategyMemoryService, strategyProfileCache,
 *                 plannerActivityCardService, orchestration/routing,
 *                 creatorTemplateRegistryService, campaignDesignSystemService,
 *                 boltRowFailureDiagnostics, executionPlannerService (dynamic),
 *                 orchestration index (dynamic), creator planning/adapter flags (OFF),
 *                 platformPostingTimes (deterministic rotation)
 *
 * Kept REAL (the business core under characterization): the route module itself,
 * weeklyStructureHelpersAlloc/Shape (deriveSubTopic, computeDayDate, buildCreatorCard,
 * the three mutation-guard asserts, …), lib/shared/bolt/* (BoltError, validateDailyPlanRow,
 * formatPlatformBinding), boltTextContentConfig, creatorGovernanceRegistry.
 */

// ── DB mock: chainable builder, scripted per table ──
type DbCall = { table: string; op: string; args: unknown[] };
const dbLog: DbCall[] = [];
let dbResponders: Record<string, (chain: DbCall[]) => unknown> = {};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const chain: DbCall[] = [];
      const record = (op: string, ...args: unknown[]) => {
        const c = { table, op, args };
        chain.push(c);
        dbLog.push(c);
      };
      const builder: any = {};
      for (const op of ['select', 'update', 'delete', 'insert', 'upsert', 'eq', 'neq', 'in', 'lt', 'gt', 'order', 'limit']) {
        builder[op] = (...args: unknown[]) => { record(op, ...args); return builder; };
      }
      builder.maybeSingle = () => { record('maybeSingle'); return builder; };
      builder.single = () => { record('single'); return builder; };
      builder.then = (resolve: any, reject: any) => {
        const responder = dbResponders[table];
        const out = responder ? responder(chain) : { data: null, error: null };
        return Promise.resolve(out).then(resolve, reject);
      };
      return builder;
    },
  },
}));

jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(async () => null),
}));

// ── Service boundaries ──
jest.mock('../../services/campaignBlueprintService', () => ({
  getUnifiedCampaignBlueprint: jest.fn(async () => null),
}));
jest.mock('../../services/platformExecutionValidator', () => ({
  // Identity validator/enricher: the REAL mutation-guard asserts in the route verify
  // that identity/intent/progression survive these stages unchanged.
  validateDailyItemAgainstPlatformRules: jest.fn(async (item: any) => ({
    dailyItem: { ...item },
    validation_status: 'valid',
  })),
  enrichDailyItemWithPlatformRequirements: jest.fn(async (item: any) => ({ ...item })),
}));
jest.mock('../../services/campaignExecutionFeedbackService', () => ({
  analyzeValidationResults: jest.fn((items: any[]) => ({ total_items: items.length, invalid: 0 })),
  generatePlanningFeedback: jest.fn(() => ['looks good']),
}));
jest.mock('../../services/platformIntelligenceService', () => ({
  getPlatformRules: jest.fn(async () => ({ content_rules: [{ content_type: 'post' }] })),
}));
jest.mock('../../services/publishingOptimizationService', () => ({
  analyzeExecutionFeedback: jest.fn(() => ({ stable_platforms: [], unstable_platforms: [] })),
  suggestPublishingStrategy: jest.fn(() => ({ reduced_platforms: [], preferred_platforms: [] })),
}));
jest.mock('../../services/campaignWaveService', () => ({
  generatePlatformWaveSchedule: jest.fn(() => new Map()),
}));
jest.mock('../../services/campaignLearningService', () => ({
  getCompanyPerformanceInsights: jest.fn(async () => ({
    company_high_performing_platforms: [],
    company_high_performing_content_types: [],
  })),
}));
jest.mock('../../services/contextCompressionService', () => ({
  getCampaignContext: jest.fn(() => null),
  setCampaignContext: jest.fn(),
  buildCampaignContext: jest.fn((input: any) => ({
    topic: input?.topic ?? 'Campaign',
    target_audience: input?.target_audience ?? 'retail marketers',
  })),
}));
jest.mock('../../services/campaignStrategyMemoryService', () => ({
  getStrategyMemory: jest.fn(async () => null),
}));
jest.mock('../../services/strategyProfileCache', () => ({
  getCachedStrategyProfile: jest.fn(async () => ({ profile: null })),
}));
jest.mock('../../services/plannerActivityCardService', () => ({
  getExecutionCategoryForContentType: jest.fn((ct: string) =>
    ['image', 'carousel'].includes(String(ct).toLowerCase()) ? 'creator_visual' : 'bolt_text'
  ),
  executionCategoryToAiGenerated: jest.fn((cat: string) => cat === 'bolt_text'),
}));
jest.mock('../../services/orchestration/routing', () => ({
  // Mirror of the documented byte-equivalent media-intent list.
  routeRequiresMediaIntent: jest.fn((ct: string) =>
    ['carousel', 'image', 'story', 'banner', 'infographic', 'pdf', 'slider'].includes(String(ct).toLowerCase())
  ),
}));
jest.mock('../../services/creatorTemplateRegistryService', () => ({
  deriveCreatorAssetTypeFromIntent: jest.fn(({ contentType }: any) =>
    contentType === 'carousel' ? 'carousel' : contentType === 'image' ? 'image' : null
  ),
}));
jest.mock('../../../lib/creator-templates', () => ({
  familyForCreatorType: jest.fn(() => null),
}));
jest.mock('../../services/creator/campaignDesignSystemService', () => ({
  loadCampaignTemplatePool: jest.fn(async () => null),
  selectTemplateFromPool: jest.fn(() => null),
}));
jest.mock('../../services/boltRowFailureDiagnostics', () => ({
  recordRowFailureBatch: jest.fn(async () => {}),
}));
jest.mock('../../services/creator/intelligence/applyCreatorBlueprint', () => ({
  applyCreatorBlueprint: jest.fn(() => false),
  isCreatorBlueprintAdapterEnabled: jest.fn(() => false),
}));
jest.mock('../../services/creator/intelligence/planning/applyCreatorPlanningFlow', () => ({
  applyCreatorPlanningFlow: jest.fn(() => false),
}));
jest.mock('../../utils/platformPostingTimes', () => ({
  getPlatformBestTime: jest.fn(async () => '09:00:00'),
  // Deterministic per-platform rotation: nth post → day (nth % 7) + 1.
  pickPlatformDayIndex: jest.fn(async (_platform: string, nth: number) => (nth % 7) + 1),
}));
// Dynamic imports inside the route:
jest.mock('../../services/executionPlannerService', () => ({
  saveWeekPlans: jest.fn(async () => {}),
}));
jest.mock('../../services/orchestration', () => ({
  resolveWeeklyRowsForPersistence: jest.fn(async (_cid: string, rows: unknown[]) => rows),
  reconcileExecution: jest.fn(async () => {}),
  runAuthoritativeGenerationGate: jest.fn(async () => {}),
  evaluateAuthoritativeDaily: jest.fn(async () => {}),
}));
/*
 * CAMPAIGN-RESOURCE-AUTHZ-SEC-001 — the handler now authenticates and
 * authorizes the campaign before generating. This suite characterizes
 * GENERATION, so the caller is stubbed as an authorized member of the fixture
 * campaign's company; the authorization boundary itself is proven separately in
 * campaignResourceAuthzSec001.test.ts against the real chain.
 */
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: jest.fn(async () => ({
    userId: 'user-1', role: 'admin', companyIds: ['co-1'],
    defaultCompanyId: 'co-1', authenticated: true, authError: null,
  })),
}));
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: jest.fn(async (_req: unknown, _res: unknown, campaignId: string) => (
    campaignId ? { userId: 'user-1', companyId: 'co-1', campaignId } : null
  )),
}));

import generateWeeklyStructureHandler, {
  generateWeeklyStructure,
} from '../../../pages/api/campaigns/generate-weekly-structure';
import { getUnifiedCampaignBlueprint } from '../../services/campaignBlueprintService';
import { saveWeekPlans } from '../../services/executionPlannerService';
import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

const CAMPAIGN = {
  id: 'camp-1',
  start_date: '2026-07-06T00:00:00.000Z', // a Monday
  name: 'Summer Push',
  company_id: 'co-1',
};

/** Synth-path blueprint: no execution_items → the route synthesizes them. */
const SYNTH_BLUEPRINT = {
  weeks: [
    {
      week_number: 1,
      phase_label: 'Launch',
      primary_objective: 'Build awareness',
      topics_to_cover: ['Topic Alpha', 'Topic Beta'],
      platform_allocation: { linkedin: 2, x: 1 },
      content_type_mix: ['post'],
      cta_type: 'Engage',
      weekly_kpi_focus: 'Reach growth',
    },
  ],
};

const intentSlot = (topic: string, idx: number) => ({
  topic,
  global_progression_index: idx,
  intent: {
    objective: 'Build awareness',
    cta_type: 'Engage',
    target_audience: 'retail marketers',
    brief_summary: `${topic}: build awareness`,
  },
});

/** AI-path blueprint: explicit execution_items with deterministic intent slots. */
const AI_BLUEPRINT = {
  weeks: [
    {
      ...SYNTH_BLUEPRINT.weeks[0],
      execution_items: [
        {
          content_type: 'post',
          selected_platforms: ['linkedin'],
          count_per_week: 2,
          topic_slots: [intentSlot('Topic Alpha', 1), intentSlot('Topic Beta', 2)],
        },
      ],
    },
  ],
};

function setDefaultDbResponders(overrides: Partial<typeof dbResponders> = {}) {
  dbResponders = {
    campaigns: (chain) => {
      if (chain.some((c) => c.op === 'neq')) return { data: [], error: null }; // sibling lookup
      if (chain.some((c) => c.op === 'update')) return { data: null, error: null };
      return { data: { ...CAMPAIGN }, error: null };
    },
    campaign_versions: () => ({ data: { version: 2 }, error: null }),
    daily_content_plans: (chain) => {
      if (chain.some((c) => c.op === 'delete')) return { data: null, error: null };
      return { data: [], error: null }; // sibling schedule lookup
    },
    weekly_content_refinements: (chain) => {
      if (chain.some((c) => c.op === 'update')) return { data: null, error: null };
      if (chain.some((c) => c.op === 'lt')) return { data: [], error: null }; // history
      return { data: null, error: null }; // refinement maybeSingle
    },
    ...overrides,
  };
}

/** Rows captured by the saveWeekPlans mock, with content JSON parsed for readability. */
function capturedRows(): any[] {
  return (saveWeekPlans as jest.Mock).mock.calls.flatMap((call) =>
    (call[2] as any[]).map((row) => ({ ...row, content: JSON.parse(row.content) }))
  );
}

beforeEach(() => {
  dbLog.length = 0;
  setDefaultDbResponders();
  (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue(
    JSON.parse(JSON.stringify(SYNTH_BLUEPRINT))
  );
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('input validation and preconditions', () => {
  it('rejects a missing campaignId / week with WEEK_STRUCTURE_VALIDATION_FAILED', async () => {
    await expect(generateWeeklyStructure({} as any)).rejects.toMatchObject({
      code: BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED,
    });
  });

  it('rejects when the campaign has no start_date and none is supplied', async () => {
    setDefaultDbResponders({
      campaigns: (chain) =>
        chain.some((c) => c.op === 'neq')
          ? { data: [], error: null }
          : { data: { ...CAMPAIGN, start_date: null }, error: null },
    });
    await expect(
      generateWeeklyStructure({ campaignId: 'camp-1', week: 1 } as any)
    ).rejects.toMatchObject({ code: BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED });
  });

  it('backfills start_date from the input when the campaign row lacks one', async () => {
    setDefaultDbResponders({
      campaigns: (chain) =>
        chain.some((c) => c.op === 'neq')
          ? { data: [], error: null }
          : chain.some((c) => c.op === 'update')
            ? { data: null, error: null }
            : { data: { ...CAMPAIGN, start_date: null }, error: null },
    });
    const result = await generateWeeklyStructure({
      campaignId: 'camp-1',
      week: 1,
      campaign_start_date: '2026-07-06',
    } as any);
    expect(result.success).toBe(true);
    const update = dbLog.find((c) => c.table === 'campaigns' && c.op === 'update');
    expect(update?.args[0]).toEqual({ start_date: '2026-07-06T00:00:00.000Z' });
  });

  it('throws BLUEPRINT_NOT_FOUND when no committed blueprint exists', async () => {
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue(null);
    await expect(
      generateWeeklyStructure({ campaignId: 'camp-1', week: 1 } as any)
    ).rejects.toMatchObject({ code: BOLT_ERROR_CODES.BLUEPRINT_NOT_FOUND });
  });

  it('throws WEEK_NOT_FOUND when a requested week is missing from the blueprint', async () => {
    await expect(
      generateWeeklyStructure({ campaignId: 'camp-1', weeks: [1, 5] } as any)
    ).rejects.toMatchObject({ code: BOLT_ERROR_CODES.WEEK_NOT_FOUND });
  });
});

describe('synth path (no AI execution_items) — golden master', () => {
  const input = {
    campaignId: 'camp-1',
    companyId: 'co-1',
    week: 1,
    eligible_platforms: ['linkedin', 'x'],
    format_frequency: { post: 2, image: 2 },
    cross_platform_sharing: true,
  } as any;

  it('produces a deterministic result envelope and persisted rows', async () => {
    const result = await generateWeeklyStructure(input);

    expect(result.success).toBe(true);
    expect(result.week).toBe(1);
    expect(result.message).toBe('Generated topic-aligned daily plan skeleton for Week 1');
    // Delete-then-insert ordering: the week's old plans are deleted before save.
    const deleteIdx = dbLog.findIndex((c) => c.table === 'daily_content_plans' && c.op === 'delete');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(saveWeekPlans).toHaveBeenCalledTimes(1);
    expect((saveWeekPlans as jest.Mock).mock.calls[0][0]).toBe('camp-1');
    expect((saveWeekPlans as jest.Mock).mock.calls[0][1]).toBe(1);
    expect((saveWeekPlans as jest.Mock).mock.calls[0][3]).toBe('blueprint');

    const rows = capturedRows();
    // BOLT "frequency is total": 2 post + 2 image = exactly 4 scheduled rows.
    expect(rows).toHaveLength(4);
    // Scheduling integrity: at most one piece per platform per day.
    const platformDays = rows.map((r) => `${r.platform}::${r.date}`);
    expect(new Set(platformDays).size).toBe(platformDays.length);
    // No duplicate content on a platform.
    const platformContent = rows.map((r) => `${r.platform}::${r.content_type}::${r.title.toLowerCase()}`);
    expect(new Set(platformContent).size).toBe(platformContent.length);
    // Frequency split round-robins platforms: each format lands once per platform.
    const byTypePlatform = rows.map((r) => `${r.content_type}::${r.platform}`).sort();
    expect(byTypePlatform).toEqual(['image::linkedin', 'image::x', 'post::linkedin', 'post::x']);
    // Creator lane: image rows are creator-intent with image asset; post rows are text.
    for (const r of rows) {
      if (r.content_type === 'image') {
        expect(r.intent_type).toBe('creator');
        expect(r.asset_type).toBe('image');
        expect(r.content.packaging).toMatchObject({ cta: expect.any(String) });
        expect(r.content.asset_payload).toHaveProperty('visual_descriptor');
      } else {
        expect(r.intent_type).toBe('text');
        expect(r.asset_type).toBeNull();
      }
      expect(r.plan_version).toBe(2);
      expect(r.status).toBe('planned');
      expect(r.scheduled_time).toBe('09:00:00');
    }
    // Full golden master of the persisted rows + result envelope.
    expect(rows).toMatchSnapshot('persisted-rows');
    expect({ ...result, dailyPlan: result.dailyPlan.length }).toMatchSnapshot('result-envelope');
  });

  it('drops a format entirely when no candidate platform is eligible for it', async () => {
    // OWNER POLICY 2026-07-10: the user's explicit platform selection is the
    // authority (previously blueprint platform_allocation keys won). A
    // linkedin-only USER selection leaves X-exclusive `tweet` nowhere to go —
    // even though the blueprint allocation includes X.
    const result = await generateWeeklyStructure({
      ...input,
      eligible_platforms: ['linkedin'],
      format_frequency: { post: 1, tweet: 2 },
    });
    expect(result.success).toBe(true);
    const rows = capturedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.content_type === 'post')).toBe(true);
  });

  it("OWNER POLICY: the user's platform selection beats the blueprint allocation (synth path)", async () => {
    // The incident scenario: user selects linkedin+facebook; the AI blueprint
    // allocates linkedin+instagram. Content must land ONLY on the user's picks.
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue({
      weeks: [{ ...SYNTH_BLUEPRINT.weeks[0], platform_allocation: { linkedin: 2, instagram: 1 } }],
    });
    await generateWeeklyStructure({
      ...input,
      eligible_platforms: ['linkedin', 'facebook'],
      format_frequency: { post: 2 },
    });
    const rows = capturedRows();
    expect(rows.length).toBeGreaterThan(0);
    const platforms = new Set(rows.map((r) => r.platform));
    expect(platforms.has('instagram')).toBe(false);
    expect([...platforms].every((p) => ['linkedin', 'facebook'].includes(p as string))).toBe(true);
  });

  it('no user selection → blueprint allocation still drives platforms (fallback preserved)', async () => {
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue({
      weeks: [{ ...SYNTH_BLUEPRINT.weeks[0], platform_allocation: { instagram: 2 } }],
    });
    // The allocated platform must NOT be `linkedin`: that is also the hardcoded
    // last-resort default, so a linkedin allocation would still pass even if the
    // platform_allocation fallback were deleted. instagram proves the fallback
    // ran — and therefore the format must be one instagram can actually publish
    // (supportedContent: image|video|carousel|creator; media required).
    await generateWeeklyStructure({
      campaignId: 'camp-1',
      week: 1,
      format_frequency: { image: 2 },
    } as any);
    const rows = capturedRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.platform === 'instagram')).toBe(true);
  });
});

describe('AI execution_items path — format_frequency reconciliation', () => {
  beforeEach(() => {
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue(
      JSON.parse(JSON.stringify(AI_BLUEPRINT))
    );
  });

  it('pads AI slots up to the user-selected count with synthesized slots', async () => {
    await generateWeeklyStructure({
      campaignId: 'camp-1',
      week: 1,
      format_frequency: { post: 3 },
    } as any);
    const rows = capturedRows();
    expect(rows).toHaveLength(3); // AI provided 2 → padded to the user's 3
    expect(rows.filter((r) => r.title === 'Topic Alpha' || r.title === 'Topic Beta')).toHaveLength(2);
  });

  it('trims AI slots down to the user-selected count', async () => {
    await generateWeeklyStructure({
      campaignId: 'camp-1',
      week: 1,
      format_frequency: { post: 1 },
    } as any);
    const rows = capturedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Topic Alpha'); // first AI slot wins the trim
  });

  it('drops AI content types the user did not select', async () => {
    await generateWeeklyStructure({
      campaignId: 'camp-1',
      week: 1,
      format_frequency: { short_story: 1 }, // 'post' from AI is not selected
    } as any);
    const rows = capturedRows();
    expect(rows.every((r) => r.content_type === 'short_story')).toBe(true);
  });

  it('without format_frequency, AI execution_items pass through as-authored', async () => {
    await generateWeeklyStructure({ campaignId: 'camp-1', week: 1 } as any);
    const rows = capturedRows();
    expect(rows.map((r) => r.title).sort()).toEqual(['Topic Alpha', 'Topic Beta']);
    expect(rows.every((r) => r.platform === 'linkedin')).toBe(true);
  });

  it("OWNER POLICY: AI execution_items' platforms are reassigned to the user's selection when disjoint", async () => {
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue({
      weeks: [
        {
          ...SYNTH_BLUEPRINT.weeks[0],
          execution_items: [
            {
              content_type: 'post',
              selected_platforms: ['instagram'], // AI picked a platform the user did not
              count_per_week: 2,
              topic_slots: [intentSlot('Topic Alpha', 1), intentSlot('Topic Beta', 2)],
            },
          ],
        },
      ],
    });
    await generateWeeklyStructure({
      campaignId: 'camp-1',
      week: 1,
      eligible_platforms: ['linkedin', 'facebook'],
    } as any);
    const rows = capturedRows();
    expect(rows.length).toBeGreaterThan(0);
    const platforms = new Set(rows.map((r) => r.platform));
    expect(platforms.has('instagram')).toBe(false);
    expect([...platforms].every((p) => ['linkedin', 'facebook'].includes(p as string))).toBe(true);
  });
});

describe('cross-campaign conflict policy', () => {
  const week1Dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12'];

  function occupyAllLinkedinDays() {
    // Blueprint allocation drives synth platforms — pin it to linkedin only so
    // every generated piece competes with the occupied linkedin days.
    (getUnifiedCampaignBlueprint as jest.Mock).mockResolvedValue({
      weeks: [{ ...SYNTH_BLUEPRINT.weeks[0], platform_allocation: { linkedin: 2 } }],
    });
    setDefaultDbResponders({
      campaigns: (chain) =>
        chain.some((c) => c.op === 'neq')
          ? { data: [{ id: 'sibling-1' }], error: null }
          : { data: { ...CAMPAIGN }, error: null },
      daily_content_plans: (chain) => {
        if (chain.some((c) => c.op === 'delete')) return { data: null, error: null };
        return {
          data: week1Dates.map((date) => ({ platforms: ['linkedin'], date })),
          error: null,
        };
      },
    });
  }

  const input = {
    campaignId: 'camp-1',
    week: 1,
    eligible_platforms: ['linkedin'],
    format_frequency: { post: 2 },
  } as any;

  it("'skip' drops pieces when the platform has no free day left in the week", async () => {
    occupyAllLinkedinDays();
    await generateWeeklyStructure({ ...input, conflict_policy: 'skip' });
    expect(capturedRows()).toHaveLength(0 + 0); // every linkedin day occupied → all dropped
    expect(saveWeekPlans).not.toHaveBeenCalled();
  });

  it("'override' ignores sibling-campaign occupancy and schedules anyway", async () => {
    occupyAllLinkedinDays();
    await generateWeeklyStructure({ ...input, conflict_policy: 'override' });
    expect(capturedRows()).toHaveLength(2);
  });
});

describe('Next handler adapter', () => {
  function mockRes() {
    const res: any = { statusCode: 0, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (payload: unknown) => { res.body = payload; return res; };
    return res;
  }

  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await generateWeeklyStructureHandler({ method: 'GET' } as any, res);
    expect(res.statusCode).toBe(405);
  });

  it('maps WEEK_EXECUTION_LOCKED to 423', async () => {
    (saveWeekPlans as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('locked'), { code: 'WEEK_EXECUTION_LOCKED' })
    );
    const res = mockRes();
    await generateWeeklyStructureHandler(
      { method: 'POST', body: { campaignId: 'camp-1', week: 1, format_frequency: { post: 1 } } } as any,
      res
    );
    expect(res.statusCode).toBe(423);
    expect(res.body).toMatchObject({ error: 'WEEK_EXECUTION_LOCKED' });
  });

  it('maps other errors to 500 with the error message', async () => {
    /*
     * Body was `{}` before CAMPAIGN-RESOURCE-AUTHZ-SEC-001. That now stops at
     * the authorization gate (a missing campaignId cannot be authorized), which
     * is the correct new behaviour but no longer reaches the generator. A
     * campaignId with no week still reaches it and raises the same validation
     * error, so this keeps characterizing the 500 mapping rather than the gate.
     */
    const res = mockRes();
    await generateWeeklyStructureHandler({ method: 'POST', body: { campaignId: 'camp-1' } } as any, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'campaignId and week (or weeks array) are required' });
  });
});
