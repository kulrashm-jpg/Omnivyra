/**
 * B4.2 — campaign creation ownership integrity.
 *
 * The two campaign creation routes that accepted `companyId` from the request
 * body without verifying membership are create-12week-plan and planner-finalize.
 * That value lands in `campaign_versions.company_id` — the record campaign
 * authorization resolves ownership from — so an authenticated user could create
 * a campaign owned by a company they do not belong to.
 *
 * These tests drive the REAL handlers with `requireTenantAccess` mocked, and
 * assert the decision that matters: on a foreign company, NOTHING is written.
 * Brief §6 A–D.
 */

const mockRequireTenantAccess = jest.fn();
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => mockRequireTenantAccess(...a),
}));

const mockGetUser = jest.fn();
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: (...a: unknown[]) => mockGetUser(...a),
}));

const mockGetCampaignById = jest.fn();
jest.mock('../../db/campaignStore', () => ({
  getCampaignById: (...a: unknown[]) => mockGetCampaignById(...a),
}));

/** Records every table written to, so "no campaign created" is directly observable. */
const writes: Array<{ table: string; op: string; row: unknown }> = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const thenable = (result: unknown) => ({
        select: () => thenable(result),
        single: async () => result,
        maybeSingle: async () => result,
        eq: () => thenable(result),
        order: () => thenable(result),
        limit: () => thenable(result),
        then: (r: (v: unknown) => unknown) => r(result),
      });
      return {
        insert: (row: unknown) => {
          writes.push({ table, op: 'insert', row });
          return thenable({ data: { id: 'new-campaign-id' }, error: null });
        },
        update: (row: unknown) => {
          writes.push({ table, op: 'update', row });
          return thenable({ data: null, error: null });
        },
        upsert: (row: unknown) => {
          writes.push({ table, op: 'upsert', row });
          return thenable({ data: null, error: null });
        },
        select: () => thenable({ data: null, error: null }),
      };
    },
  },
}));

jest.mock('../../services/campaignBlueprintAdapter', () => ({
  fromLegacyRefinements: jest.fn(() => ({ weeks: [] })),
  fromStructuredPlan: jest.fn(() => ({ weeks: [] })),
  blueprintWeeksToLegacyRefinements: jest.fn(() => []),
}));
jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: jest.fn(async () => undefined),
  saveStructuredCampaignPlan: jest.fn(async () => undefined),
  commitDraftBlueprint: jest.fn(async () => undefined),
}));
jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: jest.fn(async () => undefined),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import createTwelveWeekPlan from '../../../pages/api/campaigns/create-12week-plan';

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';
const CAMPAIGN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const mkRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn(() => res as never);
  res.json = jest.fn(() => res as never);
  res.setHeader = jest.fn(() => res as never);
  return res;
};

/** requireTenantAccess grants for `org` and denies (403, responds itself) otherwise. */
function grantOnlyFor(org: string) {
  mockRequireTenantAccess.mockImplementation(
    async (_req: unknown, res: Record<string, jest.Mock>, requested: string) => {
      if (requested !== org) {
        res.status(403).json({ error: 'Tenant access denied', code: 'NOT_A_MEMBER' });
        return null;
      }
      return { userId: 'u1', supabaseUid: 's1', organizationId: requested, role: 'admin', bypass: false, isPlatformSuperAdmin: false };
    },
  );
}

const planBody = (extra: Record<string, unknown>) => ({
  campaignId: CAMPAIGN,
  startDate: '2026-09-01',
  aiContent: 'plan text',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  mockGetUser.mockResolvedValue({ user: { id: 'u1' }, error: null });
  mockGetCampaignById.mockResolvedValue(null); // campaign does not exist ⇒ creation path
  grantOnlyFor(COMPANY_A);
});

describe('B4.2 · B/C — create-12week-plan rejects a foreign companyId', () => {
  it('company A user + company B companyId ⇒ rejected, ZERO rows written', async () => {
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: COMPANY_B }) } as never,
      res as never,
    );

    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_B);
    expect(res.status).toHaveBeenCalledWith(403);
    // The decisive assertion: no campaign, no campaign_versions, nothing at all.
    expect(writes).toHaveLength(0);
  });

  it('the guard runs BEFORE any write, so a denial cannot leave a partial campaign', async () => {
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: COMPANY_B }) } as never,
      res as never,
    );
    expect(writes.map((w) => w.table)).not.toContain('campaigns');
    expect(writes.map((w) => w.table)).not.toContain('campaign_versions');
  });

  it('an unauthenticated caller never reaches the tenant guard', async () => {
    mockGetUser.mockResolvedValue({ user: null, error: 'no session' });
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: COMPANY_B }) } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('B4.2 · A — create-12week-plan allows the user\'s own company', () => {
  it('an authorized companyId is verified and the campaign is created', async () => {
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: COMPANY_A }) } as never,
      res as never,
    );

    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_A);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(writes.map((w) => w.table)).toContain('campaigns');
  });

  it('campaign_versions records the VERIFIED company, never the raw body value', async () => {
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: COMPANY_A }) } as never,
      res as never,
    );
    const versionWrite = writes.find((w) => w.table === 'campaign_versions');
    expect(versionWrite).toBeDefined();
    expect((versionWrite!.row as Record<string, unknown>).company_id).toBe(COMPANY_A);
  });
});

describe('B4.2 · C — companyId cannot be forged', () => {
  it('the persisted company is the guard\'s organizationId, not the body value', async () => {
    // The guard is the sole source of the accepted value: it echoes back the
    // organizationId it verified. If a route ever used the raw body value
    // instead, this test would catch the divergence.
    mockRequireTenantAccess.mockResolvedValue({
      userId: 'u1', supabaseUid: 's1', organizationId: COMPANY_A,
      role: 'admin', bypass: false, isPlatformSuperAdmin: false,
    });
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: `  ${COMPANY_A}  ` }) } as never,
      res as never,
    );
    const versionWrite = writes.find((w) => w.table === 'campaign_versions');
    expect((versionWrite!.row as Record<string, unknown>).company_id).toBe(COMPANY_A);
  });
});

describe('B4.2 · D — the optional-companyId contract is preserved', () => {
  it('omitted companyId ⇒ no tenant check, campaign still created, no version row', async () => {
    const res = mkRes();
    await createTwelveWeekPlan({ method: 'POST', body: planBody({}) } as never, res as never);

    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    expect(writes.map((w) => w.table)).toContain('campaigns');
    // Pre-existing behaviour: no companyId ⇒ no campaign_versions row.
    expect(writes.map((w) => w.table)).not.toContain('campaign_versions');
  });

  it('a blank companyId is treated as absent, and no company is invented', async () => {
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: planBody({ companyId: '   ' }) } as never,
      res as never,
    );
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    const versionWrite = writes.find((w) => w.table === 'campaign_versions');
    expect(versionWrite).toBeUndefined();
  });

  it('missing required fields still 400 before any ownership work', async () => {
    const res = mkRes();
    await createTwelveWeekPlan(
      { method: 'POST', body: { companyId: COMPANY_A } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * planner-finalize — the second defective route. Its companyId is REQUIRED
 * (400 when missing), so the guard runs unconditionally, immediately after that
 * check and before every downstream dependency. A foreign company must exit at
 * 403 without touching anything.
 * ──────────────────────────────────────────────────────────────────────────── */

jest.mock('../../services/executionPlannerService', () => ({
  generateFromManualPlanner: jest.fn(async () => ({ rowsInserted: 0 })),
}));
jest.mock('../../services/campaignPlanningInputsService', () => ({
  saveCampaignPlanningInputs: jest.fn(async () => undefined),
}));
jest.mock('../../services/plannerIntegrityService', () => ({
  validateCalendarPlan: jest.fn(() => ({ ok: true, errors: [] })),
}));
jest.mock('../../services/campaignContextService', () => ({
  saveCampaignContextSnapshot: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const plannerFinalize = require('../../../pages/api/campaigns/planner-finalize').default;

describe('B4.2 · B/C — planner-finalize rejects a foreign companyId', () => {
  const finalizeBody = (companyId: unknown) => ({
    companyId,
    strategy_context: { objective: 'x' },
    execution_handoff: { weeks: [] },
    calendar_plan: { activities: [] },
  });

  it('company A user + company B companyId ⇒ 403, ZERO rows written', async () => {
    const res = mkRes();
    await plannerFinalize({ method: 'POST', body: finalizeBody(COMPANY_B) } as never, res as never);

    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_B);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(writes).toHaveLength(0);
  });

  it('the guard precedes every downstream dependency', async () => {
    const res = mkRes();
    await plannerFinalize({ method: 'POST', body: finalizeBody(COMPANY_B) } as never, res as never);
    expect(writes.map((w) => w.table)).not.toContain('campaigns');
    expect(writes.map((w) => w.table)).not.toContain('campaign_versions');
  });

  it('a missing companyId still 400s before the guard (contract unchanged)', async () => {
    const res = mkRes();
    await plannerFinalize({ method: 'POST', body: finalizeBody(undefined) } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('an authorized companyId passes the guard and proceeds past it', async () => {
    const res = mkRes();
    await plannerFinalize({ method: 'POST', body: finalizeBody(COMPANY_A) } as never, res as never);

    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_A);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('an unauthenticated caller never reaches the tenant guard', async () => {
    mockGetUser.mockResolvedValue({ user: null, error: 'no session' });
    const res = mkRes();
    await plannerFinalize({ method: 'POST', body: finalizeBody(COMPANY_A) } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * create-campaign-from-group — a THIRD path, not in the brief's list, found
 * while auditing every `campaigns` insert.
 *
 * Its withRBAC wrapper resolves its subject from req.body.companyId (camelCase)
 * while the handler persists req.body.company_id (snake_case), so the role check
 * and the persisted owner could name two different companies. The guard added in
 * B4.2 binds verification to the value that is actually written.
 * ──────────────────────────────────────────────────────────────────────────── */

jest.mock('../../middleware/withRBAC', () => ({
  // Transparent: the point of these tests is what the HANDLER does, and the
  // divergence being closed is precisely that withRBAC checked a different key.
  withRBAC: (h: unknown) => h,
}));
jest.mock('../../services/campaignPlanningInputsService', () => ({
  getCampaignPlanningInputs: jest.fn(async () => null),
  saveCampaignPlanningInputs: jest.fn(async () => undefined),
}));
jest.mock('../../services/campaignContextConfig', () => ({
  DEFAULT_BUILD_MODE_RECOMMENDATION: 'recommendation',
  normalizeCampaignTypes: jest.fn(() => []),
  normalizeCampaignWeights: jest.fn(() => ({})),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createFromGroup = require('../../../pages/api/recommendations/create-campaign-from-group').default;

describe('B4.2 · B — create-campaign-from-group binds the check to the written company', () => {
  const groupBody = (companyIdKey: Record<string, unknown>) => ({
    ...companyIdKey,
    selected_recommendations: [{ snapshot_hash: 'h1' }],
    groups: [{ name: 'g1' }],
  });

  it('a foreign company_id is rejected and nothing is written', async () => {
    const res = mkRes();
    await createFromGroup(
      { method: 'POST', body: groupBody({ company_id: COMPANY_B }) } as never,
      res as never,
    );

    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_B);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(writes).toHaveLength(0);
  });

  it('the SNAKE_CASE key is what gets verified — a camelCase decoy cannot stand in', async () => {
    // The exact bypass shape: pass RBAC with your own company in `companyId`
    // while writing the victim's company via `company_id`.
    const res = mkRes();
    await createFromGroup(
      { method: 'POST', body: groupBody({ company_id: COMPANY_B, companyId: COMPANY_A }) } as never,
      res as never,
    );

    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_B);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(writes).toHaveLength(0);
  });

  it('an authorized company_id passes the guard', async () => {
    const res = mkRes();
    await createFromGroup(
      { method: 'POST', body: groupBody({ company_id: COMPANY_A }) } as never,
      res as never,
    );
    expect(mockRequireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, COMPANY_A);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it('a missing company_id still 400s before the guard', async () => {
    const res = mkRes();
    await createFromGroup({ method: 'POST', body: groupBody({}) } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
