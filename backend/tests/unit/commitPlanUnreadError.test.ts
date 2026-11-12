/**
 * unread-error pkg 2: POST /api/campaigns/[id]/commit-plan fails closed on a PostgREST error
 * (returned in `error`, never thrown).
 *   - the company lookup: unread, the company was '' and access answered a misleading 403;
 *   - the activation write: unchecked, a failed write answered 200 while the campaign stayed inactive,
 *     and publishAuthorization refuses every post of an inactive campaign.
 *
 * The REAL activateScheduledCampaign runs (its retries included) over a hostile fake: any table/op
 * this suite does not configure THROWS. One fault per case.
 */
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};
let activationWrites = 0;

function makeBuilder(table: string) {
  let op = '';
  const settle = (): Result => {
    const key = `${table}:${op}`;
    const r = results[key];
    if (!r) throw new Error(`hostile fake: unconfigured ${key}`);
    if (key === 'campaigns:update') activationWrites += 1;
    return r;
  };
  const b: any = {
    select: () => { op = op || 'select'; return b; },
    update: () => { op = 'update'; return b; },
    eq: () => b,
    limit: () => b,
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

const mockAccess = jest.fn(async (..._a: unknown[]) => ({ userId: 'user-1' }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => mockAccess(...a),
}));
jest.mock('../../services/GovernanceLockdownService', () => ({ isGovernanceLocked: async () => false }));

const mockSaveBlueprint = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../db/campaignPlanStore', () => ({
  saveCampaignBlueprintFromLegacy: (...a: unknown[]) => mockSaveBlueprint(...a),
}));
jest.mock('../../services/campaignBlueprintAdapter', () => ({ fromStructuredPlan: jest.fn(() => ({ weeks: [] })) }));

const mockSyncStage = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: (...a: unknown[]) => mockSyncStage(...a),
}));
jest.mock('../../services/campaignBlueprintService', () => ({
  ...jest.requireActual('../../services/campaignBlueprintService'),
  assertBlueprintMutable: jest.fn(async () => undefined),
}));

const mockOpsEvent = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/monetizationOpsService', () => ({
  recordMonetizationOperationalEvent: (...a: unknown[]) => mockOpsEvent(...a),
}));

import handler from '../../../pages/api/campaigns/[id]/commit-plan';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}

/** No companyId in the body: the route resolves it from campaign_versions. */
const post = () => ({
  method: 'POST',
  url: '/api/campaigns/camp-1/commit-plan',
  headers: {},
  query: { id: 'camp-1' },
  body: { plan: { weeks: [{ week: 1 }] } },
}) as any;

beforeEach(() => {
  activationWrites = 0;
  mockAccess.mockClear();
  mockSaveBlueprint.mockClear();
  mockSyncStage.mockClear();
  mockOpsEvent.mockClear();
  results = {
    'campaign_versions:select': { data: { company_id: 'co-1' }, error: null },
    'campaigns:select': { data: { id: 'camp-1', status: 'planning', current_stage: 'planning', blueprint_status: 'DRAFT' }, error: null },
    'campaigns:update': { data: null, error: null },
  };
});

describe('commit-plan fails closed on unread errors (unread-error pkg 2)', () => {
  it('CONTROL: a healthy commit resolves the company, saves, activates once, and syncs the stage', async () => {
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co-1', campaignId: 'camp-1' }));
    expect(mockSaveBlueprint).toHaveBeenCalledTimes(1);
    expect(activationWrites).toBe(1);
    expect(mockSyncStage).toHaveBeenCalledWith('camp-1', 'schedule', 'co-1');
    expect(mockOpsEvent).not.toHaveBeenCalled();
  });

  it('an UNREADABLE company is 503, never an access decision on an empty company, and nothing is saved', async () => {
    results['campaign_versions:select'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_COMPANY_READ_FAILED' });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockSaveBlueprint).not.toHaveBeenCalled();
    expect(activationWrites).toBe(0);
  });

  it('a FAILED activation (after its retries) is 503 saved:true, not a 200; the stage is not synced; ops is alerted', async () => {
    results['campaigns:update'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_ACTIVATION_FAILED', saved: true });
    expect(mockSaveBlueprint).toHaveBeenCalledTimes(1);
    expect(activationWrites).toBe(3);
    expect(mockSyncStage).not.toHaveBeenCalled();
    expect(mockOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'scheduling.campaign_activation_failed',
      metadata: expect.objectContaining({ campaign_id: 'camp-1', source: 'commit-plan' }),
    }));
  });
});
