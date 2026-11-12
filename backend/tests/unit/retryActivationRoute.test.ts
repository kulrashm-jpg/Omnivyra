/**
 * "Retry status update" (e9, 2026-11-12): POST /api/campaigns/[id]/retry-activation runs ONLY the
 * idempotent activation write; it NEVER schedules posts (a re-schedule would duplicate every post,
 * since scheduleStructuredPlan is not idempotent). And the client action calls only this route.
 *
 * REAL: the route handler, activateScheduledCampaign, makeActivationRetry. FAKED: access, governance
 * lock, and the tables. A per-chain double answers only declared tables; anything else throws.
 */
export {};

type Ans = { data?: unknown; error?: { message: string } | null; count?: number | null };
let campaignRead: Ans;
let postsCount: Ans;
let activationAnswers: Ans[];
const activationWrites: unknown[] = [];
let accessGranted = true;
let locked = false;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const ops: string[] = [];
      const b: any = {};
      for (const op of ['select', 'eq', 'limit']) b[op] = () => { ops.push(op); return b; };
      b.update = (payload: unknown) => {
        if (table !== 'campaigns') throw new Error(`undeclared update on ${table}`);
        ops.push('update');
        activationWrites.push(payload);
        return b;
      };
      b.maybeSingle = async () => {
        if (table !== 'campaigns') throw new Error(`undeclared maybeSingle on ${table}`);
        return { data: campaignRead.data ?? null, error: campaignRead.error ?? null };
      };
      b.then = (res: any, rej: any) => {
        let out: Ans;
        if (table === 'scheduled_posts') out = postsCount;
        else if (table === 'campaigns' && ops.includes('update')) out = activationAnswers.shift() ?? { error: null };
        else return Promise.reject(new Error(`undeclared read on ${table}`)).then(res, rej);
        return Promise.resolve({ data: out.data ?? null, error: out.error ?? null, count: out.count ?? null }).then(res, rej);
      };
      return b;
    },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: jest.fn(async (_req: unknown, res: any, campaignId: string) => {
    if (!accessGranted) { res.status(403).json({ error: 'FORBIDDEN' }); return null; }
    return { userId: 'u-1', companyId: 'co-1', campaignId };
  }),
}));
const mockRecordOpsEvent = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/monetizationOpsService', () => ({ recordMonetizationOperationalEvent: (...a: unknown[]) => mockRecordOpsEvent(...a) }));
jest.mock('../../services/GovernanceLockdownService', () => ({ isGovernanceLocked: jest.fn(async () => locked) }));
// The scheduler must never be reached from this route: make reaching it LOUD.
const scheduleStructuredPlan = jest.fn(async (..._args: unknown[]) => { throw new Error('retry-activation must never schedule'); });
jest.mock('../../services/structuredPlanScheduler', () => ({ scheduleStructuredPlan: (...a: unknown[]) => scheduleStructuredPlan(...a) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = require('../../../pages/api/campaigns/[id]/retry-activation').default;

const fail = { error: { message: 'boom' } };
const call = async () => {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.status = (n: number) => { res.statusCode = n; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  await handler({ method: 'POST', query: { id: 'camp-1' }, headers: {} }, res);
  return res;
};

beforeEach(() => {
  campaignRead = { data: { execution_status: 'ACTIVE' }, error: null };
  postsCount = { count: 3, error: null };
  activationAnswers = [];
  activationWrites.length = 0;
  accessGranted = true;
  locked = false;
  scheduleStructuredPlan.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  // The property this route exists for, asserted after EVERY case.
  expect(scheduleStructuredPlan).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

describe('POST /api/campaigns/[id]/retry-activation', () => {
  it('activates a scheduled campaign with ONLY the activation write, and records the RECOVERED marker', async () => {
    mockRecordOpsEvent.mockClear();
    const res = await call();
    expect(mockRecordOpsEvent.mock.calls.map((c) => (c[0] as { eventName: string }).eventName)).toEqual(['scheduling.campaign_activation_recovered']);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ activation: { ok: true }, scheduled_posts: 3 });
    expect(activationWrites).toHaveLength(1);
    expect(activationWrites[0]).toMatchObject({ status: 'active', current_stage: 'schedule', blueprint_status: 'ACTIVE' });
  });

  it('NOTHING_SCHEDULED: refuses to activate a campaign with no scheduled posts (not a scheduling bypass)', async () => {
    postsCount = { count: 0, error: null };
    const res = await call();
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'NOTHING_SCHEDULED' });
    expect(activationWrites).toHaveLength(0);
  });

  it('a failed scheduled-posts read is 503, never "nothing scheduled" and never "activate"', async () => {
    postsCount = fail;
    const res = await call();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'SCHEDULED_POSTS_READ_FAILED' });
    expect(activationWrites).toHaveLength(0);
  });

  it('a finalized campaign is 409 CAMPAIGN_FINALIZED, not activated', async () => {
    campaignRead = { data: { execution_status: 'COMPLETED' }, error: null };
    const res = await call();
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_FINALIZED' });
    expect(activationWrites).toHaveLength(0);
  });

  it('a failed campaign read is 503, not activated', async () => {
    campaignRead = fail;
    const res = await call();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_READ_FAILED' });
    expect(activationWrites).toHaveLength(0);
  });

  it('activation fails on all 3 attempts: 503 CAMPAIGN_ACTIVATION_FAILED (retryable), and the failure event', async () => {
    mockRecordOpsEvent.mockClear();
    activationAnswers = [fail, fail, fail];
    const res = await call();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_ACTIVATION_FAILED' });
    expect(activationWrites).toHaveLength(3);
    expect(mockRecordOpsEvent.mock.calls.map((c) => (c[0] as { eventName: string }).eventName)).toEqual(['scheduling.campaign_activation_failed']);
  });

  it('no access: refused by the access check, nothing read or written', async () => {
    accessGranted = false;
    const res = await call();
    expect(res.statusCode).toBe(403);
    expect(activationWrites).toHaveLength(0);
  });

  it('governance lockdown: 423, nothing written', async () => {
    locked = true;
    const res = await call();
    expect(res.statusCode).toBe(423);
    expect(activationWrites).toHaveLength(0);
  });
});

describe('client: makeActivationRetry calls ONLY retry-activation', () => {
  const fetchWithAuth = jest.fn();
  jest.doMock('../../../components/community-ai/fetchWithAuth', () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

  it('posts to retry-activation (never schedule-structured-plan) and clears the warning on success', async () => {
    let makeActivationRetry: any;
    let getActivationRetry: any;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      makeActivationRetry = require('../../../components/campaign-ai/useStructuredPlanScheduling').makeActivationRetry;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      getActivationRetry = require('../../../components/campaign-ai/activationRetryStore').getActivationRetry;
    });
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ activation: { ok: true } }) });
    const setErr = jest.fn();
    const setOk = jest.fn();
    await makeActivationRetry('camp-1', setErr, setOk)();
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth.mock.calls[0][0]).toBe('/api/campaigns/camp-1/retry-activation');
    expect(fetchWithAuth.mock.calls.some((c) => String(c[0]).includes('schedule-structured-plan'))).toBe(false);
    expect(setErr).toHaveBeenCalledWith(null);
    expect(setOk).toHaveBeenCalledWith(expect.stringContaining('none were re-scheduled'));
    expect(getActivationRetry('camp-1')).toBeNull();
  });
});
