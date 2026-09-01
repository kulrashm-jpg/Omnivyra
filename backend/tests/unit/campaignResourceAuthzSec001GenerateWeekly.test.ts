/**
 * CAMPAIGN-RESOURCE-AUTHZ-SEC-001 — generate-weekly-structure.
 *
 * The worst of the three D1 routes: no authentication at all, against the
 * service-role client, on a handler that DELETEs and re-INSERTs a campaign's
 * week plans and UPDATEs campaigns.start_date — all keyed on a body-supplied
 * campaignId. It also carried a caller-controlled tenant fallback,
 *
 *     const cid = campaign?.company_id ?? companyId;   // companyId = req.body
 *
 * so when the campaign row was missing or its company_id was null — true of 7
 * of 27 campaigns in production — an anonymous caller's body value became the
 * predicate for `.eq('company_id', cid)`, enumerating that company's campaigns.
 *
 * The company-override matrix below is mandatory for exactly that reason: it is
 * not enough that a foreign campaign is refused, the body value must be unable
 * to influence the tenant even when the campaign IS authorized.
 *
 * The authorization chain is REAL (requireCampaignAccess -> userContext ->
 * rbac). Only the database, the identity provider and the generation services
 * are faked. The mock set mirrors generateWeeklyStructureCharacterization so the
 * module loads identically.
 */

export {};

const CO_A = 'co-a-0000-0000-0000-00000000000a';
const CO_B = 'co-b-0000-0000-0000-00000000000b';
const CAMPAIGN_A = 'camp-a-00-0000-0000-00000000000a';
const CAMPAIGN_B = 'camp-b-00-0000-0000-00000000000b';
const UNKNOWN_CAMPAIGN = 'camp-x-00-0000-0000-00000000000x';
const USER_A = 'user-a-00-0000-0000-00000000000a';
/** A company the caller has no relationship with whatsoever. */
const ATTACKER_CLAIMED_CO = 'co-evil-0-0000-0000-00000000000e';

/**
 * campaigns.company_id deliberately DIVERGES from campaign_versions.company_id.
 *
 * campaign_versions is the authoritative owner record — requireCampaignAccess
 * resolves through it, and campaigns.company_id is null for 7 of 27 campaigns
 * in production, which is why. Making the two distinguishable is what gives the
 * `cid` ordering a testable meaning: the authorized company must win over any
 * value re-read from the campaign row. With both set to CO_A, the original
 * insecure ordering and the fixed one produce identical output and the test
 * proves nothing.
 */
const STALE_CAMPAIGN_CO = 'co-stale-0-0000-0000-00000000000s';
const CAMPAIGN_ROWS = [
  { id: CAMPAIGN_A, company_id: STALE_CAMPAIGN_CO, name: 'A', start_date: '2026-07-06T00:00:00.000Z' },
  { id: CAMPAIGN_B, company_id: CO_B, name: 'B', start_date: '2026-07-06T00:00:00.000Z' },
];
const VERSION_ROWS = [
  { campaign_id: CAMPAIGN_A, company_id: CO_A, version: 1, created_at: '2026-01-01' },
  { campaign_id: CAMPAIGN_B, company_id: CO_B, version: 1, created_at: '2026-01-01' },
];
const ROLE_ROWS = [{ user_id: USER_A, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' }];

type Call = { table: string; op: string; filters: Record<string, unknown> };
let calls: Call[] = [];
let authUser: { id: string; email: string } | null = null;

const SENSITIVE = ['campaigns', 'daily_content_plans', 'weekly_content_refinements'];
const sensitiveCalls = () => calls.filter((c) => SENSITIVE.includes(c.table));
const writes = () => calls.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c.op));
/*
 * Every company_id predicate that reached a DATA table.
 *
 * user_company_roles is excluded deliberately: the guard MUST query it with the
 * foreign company's id — asking "does this caller hold a role in the company
 * that owns this campaign?" is precisely how the denial is decided. Counting
 * that as a leak would make the assertion fail on correct code. What must never
 * happen is a foreign company id reaching a query for campaign CONTENT.
 */
const AUTHZ_TABLES = ['user_company_roles'];
const companyPredicates = () =>
  calls
    .filter((c) => !AUTHZ_TABLES.includes(c.table))
    .map((c) => c.filters.company_id)
    .filter((v) => v !== undefined);

function rowsFor(table: string): any[] {
  if (table === 'campaigns') return CAMPAIGN_ROWS;
  if (table === 'campaign_versions') return VERSION_ROWS;
  if (table === 'user_company_roles') return ROLE_ROWS;
  return [];
}

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  let op = 'select';
  const b: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'lt', 'gt', 'neq']) b[m] = () => b;
  for (const m of ['insert', 'update', 'upsert', 'delete']) {
    b[m] = (p: unknown) => { op = m; filters.__payload = p; return b; };
  }
  b.eq = (col: string, val: unknown) => { filters[col] = val; return b; };
  const resolve = () => {
    calls.push({ table, op, filters: { ...filters } });
    if (op !== 'select') return { data: null, error: null };
    const matched = rowsFor(table).filter((r) =>
      Object.entries(filters).every(([k, v]) => k.startsWith('__') ? true : (r as any)[k] === v));
    return { data: matched, error: null };
  };
  b.maybeSingle = async () => ({ data: resolve().data?.[0] ?? null, error: null });
  b.single = async () => ({ data: resolve().data?.[0] ?? null, error: null });
  b.then = (ok: any, err: any) => Promise.resolve(resolve()).then(ok, err);
  return b;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    (authUser ? { user: authUser, error: null } : { user: null, error: 'MISSING_AUTH' })),
}));

/* ── generation-side mocks: mirror of the characterization suite ──────────── */
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(async () => null),
}));
jest.mock('../../services/campaignBlueprintService', () => ({
  getUnifiedCampaignBlueprint: jest.fn(async () => ({
    duration_weeks: 4,
    weeks: [{ week_number: 1, phase_label: 'W1', primary_objective: 'o', topics_to_cover: ['t'] }],
  })),
}));
jest.mock('../../services/platformExecutionValidator', () => ({
  validateDailyItemAgainstPlatformRules: jest.fn(async (i: any) => ({ dailyItem: { ...i }, validation_status: 'valid' })),
  enrichDailyItemWithPlatformRequirements: jest.fn(async (i: any) => ({ ...i })),
}));
jest.mock('../../services/campaignExecutionFeedbackService', () => ({
  analyzeValidationResults: jest.fn((i: any[]) => ({ total_items: i.length, invalid: 0 })),
  generatePlanningFeedback: jest.fn(() => []),
}));
jest.mock('../../services/platformIntelligenceService', () => ({
  getPlatformRules: jest.fn(async () => ({ content_rules: [{ content_type: 'post' }] })),
}));
jest.mock('../../services/publishingOptimizationService', () => ({
  analyzeExecutionFeedback: jest.fn(() => ({ stable_platforms: [], unstable_platforms: [] })),
  suggestPublishingStrategy: jest.fn(() => ({ reduced_platforms: [], preferred_platforms: [] })),
}));
jest.mock('../../services/campaignWaveService', () => ({ generatePlatformWaveSchedule: jest.fn(() => new Map()) }));
jest.mock('../../services/campaignLearningService', () => ({
  getCompanyPerformanceInsights: jest.fn(async () => ({
    company_high_performing_platforms: [], company_high_performing_content_types: [],
  })),
}));
jest.mock('../../services/contextCompressionService', () => ({
  getCampaignContext: jest.fn(() => null),
  setCampaignContext: jest.fn(),
  buildCampaignContext: jest.fn(() => ({ topic: 'c', target_audience: 'a' })),
}));
jest.mock('../../services/campaignStrategyMemoryService', () => ({ getStrategyMemory: jest.fn(async () => null) }));
jest.mock('../../services/strategyProfileCache', () => ({ getCachedStrategyProfile: jest.fn(async () => ({ profile: null })) }));
jest.mock('../../services/plannerActivityCardService', () => ({
  getExecutionCategoryForContentType: jest.fn(() => 'bolt_text'),
  executionCategoryToAiGenerated: jest.fn(() => true),
}));
jest.mock('../../services/orchestration/routing', () => ({ routeRequiresMediaIntent: jest.fn(() => false) }));
jest.mock('../../services/creatorTemplateRegistryService', () => ({ deriveCreatorAssetTypeFromIntent: jest.fn(() => null) }));
jest.mock('../../../lib/creator-templates', () => ({ familyForCreatorType: jest.fn(() => null) }));
jest.mock('../../services/creator/campaignDesignSystemService', () => ({
  loadCampaignTemplatePool: jest.fn(async () => null), selectTemplateFromPool: jest.fn(() => null),
}));
jest.mock('../../services/boltRowFailureDiagnostics', () => ({ recordRowFailureBatch: jest.fn(async () => {}) }));
jest.mock('../../services/creator/intelligence/applyCreatorBlueprint', () => ({
  applyCreatorBlueprint: jest.fn(() => false), isCreatorBlueprintAdapterEnabled: jest.fn(() => false),
}));
jest.mock('../../services/creator/intelligence/planning/applyCreatorPlanningFlow', () => ({
  applyCreatorPlanningFlow: jest.fn(() => false),
}));
jest.mock('../../utils/platformPostingTimes', () => ({
  getPlatformBestTime: jest.fn(async () => '09:00:00'),
  pickPlatformDayIndex: jest.fn(async (_p: string, n: number) => (n % 7) + 1),
}));
jest.mock('../../services/executionPlannerService', () => ({ saveWeekPlans: jest.fn(async () => {}) }));
jest.mock('../../services/orchestration', () => ({
  resolveWeeklyRowsForPersistence: jest.fn(async (_c: string, r: unknown[]) => r),
  reconcileExecution: jest.fn(async () => {}),
  runAuthoritativeGenerationGate: jest.fn(async () => {}),
  evaluateAuthoritativeDaily: jest.fn(async () => {}),
}));

import handler from '../../../pages/api/campaigns/generate-weekly-structure';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
const post = async (body: Record<string, unknown>) => {
  const res = mockRes();
  await handler({ method: 'POST', body, query: {}, headers: {} } as any, res);
  return res;
};

beforeEach(() => { calls = []; authUser = { id: USER_A, email: 'a@example.com' }; });

describe('authentication', () => {
  it('CRITICAL anonymous is rejected and NOTHING is read or written', async () => {
    authUser = null;
    const res = await post({ campaignId: CAMPAIGN_B, week: 1 });
    expect(res.statusCode).toBe(401);
    expect(sensitiveCalls()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('CRITICAL anonymous cannot distinguish a real campaign from an invented one', async () => {
    authUser = null;
    const real = await post({ campaignId: CAMPAIGN_B, week: 1 });
    const fake = await post({ campaignId: UNKNOWN_CAMPAIGN, week: 1 });
    expect(real.statusCode).toBe(fake.statusCode);
    expect(real.body).toEqual(fake.body);
  });

  it('CRITICAL anonymous cannot reach the campaigns.start_date UPDATE', async () => {
    // That write fired before any validation, so an anonymous caller could
    // mutate a foreign campaign and then bail out on a later error.
    authUser = null;
    await post({ campaignId: CAMPAIGN_B, week: 1, campaign_start_date: '2027-01-01' });
    expect(writes()).toEqual([]);
  });
});

describe('resource ownership', () => {
  it('CRITICAL a member of A is denied campaign B, with no reads or writes', async () => {
    const res = await post({ campaignId: CAMPAIGN_B, week: 1 });
    expect(res.statusCode).toBe(403);
    expect(sensitiveCalls()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('a nonexistent campaign is refused', async () => {
    const res = await post({ campaignId: UNKNOWN_CAMPAIGN, week: 1 });
    expect(res.statusCode).toBe(404);
    expect(sensitiveCalls()).toEqual([]);
  });

  it('a missing campaign id is refused before anything runs', async () => {
    const res = await post({ week: 1 });
    expect(res.statusCode).toBe(400);
    expect(sensitiveCalls()).toEqual([]);
  });

  it('a malformed campaign id is refused', async () => {
    const res = await post({ campaignId: { nested: true }, week: 1 });
    expect([400, 404]).toContain(res.statusCode);
    expect(writes()).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * The company-override matrix — the exact defect class.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('body companyId can never influence the tenant', () => {
  it('CRITICAL own campaign + FOREIGN body company → only the authorized company is used', async () => {
    /*
     * The heart of the fix. The caller is authorized for campaign A, and claims
     * company "evil" in the body. Every company_id predicate that reaches the
     * database must be CO_A. Before the fix, the body value could become `cid`
     * and therefore the predicate for sibling-campaign enumeration.
     */
    await post({ campaignId: CAMPAIGN_A, week: 1, companyId: ATTACKER_CLAIMED_CO });
    const seen = companyPredicates();
    expect(seen).not.toContain(ATTACKER_CLAIMED_CO);
    expect(seen.filter((v) => v === CO_A).length).toBeGreaterThan(0);
    // Nor the company re-read from the campaign row: the authorization
    // boundary is the single source of tenant identity.
    expect(seen).not.toContain(STALE_CAMPAIGN_CO);
  });

  it('CRITICAL the authorized company wins over the campaign row', async () => {
    /*
     * Directly pins the `cid` ordering. campaigns.company_id is stale here,
     * while campaign_versions — what requireCampaignAccess authorized — says
     * CO_A. Reverting to `campaign?.company_id ?? companyId` scopes the
     * sibling-campaign enumeration to the stale company and fails here.
     */
    await post({ campaignId: CAMPAIGN_A, week: 1 });
    expect(companyPredicates()).toContain(CO_A);
    expect(companyPredicates()).not.toContain(STALE_CAMPAIGN_CO);
  });

  it('CRITICAL foreign campaign + own body company → denied', async () => {
    const res = await post({ campaignId: CAMPAIGN_B, week: 1, companyId: CO_A });
    expect(res.statusCode).toBe(403);
    expect(sensitiveCalls()).toEqual([]);
  });

  it('CRITICAL foreign campaign + foreign body company → denied', async () => {
    const res = await post({ campaignId: CAMPAIGN_B, week: 1, companyId: CO_B });
    expect(res.statusCode).toBe(403);
    expect(companyPredicates()).not.toContain(CO_B);
  });

  it('CRITICAL foreign campaign + attacker-invented company → denied', async () => {
    const res = await post({ campaignId: CAMPAIGN_B, week: 1, companyId: ATTACKER_CLAIMED_CO });
    expect(res.statusCode).toBe(403);
    expect(companyPredicates()).not.toContain(ATTACKER_CLAIMED_CO);
  });

  it('own campaign + own body company behaves identically to omitting it', async () => {
    await post({ campaignId: CAMPAIGN_A, week: 1, companyId: CO_A });
    const withBody = companyPredicates();
    calls = [];
    await post({ campaignId: CAMPAIGN_A, week: 1 });
    expect(companyPredicates()).toEqual(withBody);
  });

  it('CRITICAL snake_case and org aliases cannot smuggle a tenant in', async () => {
    // The input type carries no such fields, so they must be inert. If someone
    // later widens the type, this fails rather than silently reopening the hole.
    await post({
      campaignId: CAMPAIGN_A, week: 1,
      company_id: ATTACKER_CLAIMED_CO, organizationId: ATTACKER_CLAIMED_CO,
      org_id: ATTACKER_CLAIMED_CO, tenantId: ATTACKER_CLAIMED_CO,
    });
    expect(companyPredicates()).not.toContain(ATTACKER_CLAIMED_CO);
  });
});
