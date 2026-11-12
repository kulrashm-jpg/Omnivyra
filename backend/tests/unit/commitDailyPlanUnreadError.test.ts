/**
 * unread-error pkg 2: POST /api/campaigns/commit-daily-plan fails closed on a PostgREST error
 * (returned in `error`, never thrown). saveWeekPlans REPLACES the whole week, so a failed read of
 * the existing week taken as "empty" would DELETE every other day's plan.
 *
 * The fake is hostile: any table/operation this suite does not configure THROWS, and every read or
 * write resolves only through the terminal the route actually awaits. One fault per case.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};
let writes: Array<{ table: string; op: string; payload: unknown }> = [];

function makeBuilder(table: string) {
  let op = '';
  let payload: unknown;
  const settle = (): Result => {
    const key = `${table}:${op}`;
    const r = results[key];
    if (!r) throw new Error(`hostile fake: unconfigured ${key}`);
    if (op !== 'select') writes.push({ table, op, payload });
    return r;
  };
  const b: any = {
    select: () => { op = op || 'select'; return b; },
    update: (p: unknown) => { op = 'update'; payload = p; return b; },
    eq: () => b,
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

const mockSaveWeekPlans = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/executionPlannerService', () => ({
  saveWeekPlans: (...a: unknown[]) => mockSaveWeekPlans(...a),
}));

const mockSyncStage = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../db/campaignVersionStore', () => ({
  syncCampaignVersionStage: (...a: unknown[]) => mockSyncStage(...a),
}));

jest.mock('../../security/TenantGuard', () => ({
  requireCampaignTenantAccess: jest.fn(async () => ({ organizationId: 'co-1', userId: 'user-1' })),
}));

import handler from '../../../pages/api/campaigns/commit-daily-plan';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Row };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}

const post = () => ({
  method: 'POST',
  url: '/api/campaigns/commit-daily-plan',
  headers: {},
  query: {},
  body: {
    campaignId: 'camp-1',
    weekNumber: 2,
    day: 'Monday',
    commitType: 'finalize',
    activities: [{ title: 'New Monday post', platform: 'linkedin', contentType: 'post', time: '09:00' }],
  },
}) as any;

const TUESDAY = { id: 'row-tue', campaign_id: 'camp-1', week_number: 2, day_of_week: 'Tuesday', title: 'Kept Tuesday post' };
const OLD_MONDAY = { id: 'row-mon', campaign_id: 'camp-1', week_number: 2, day_of_week: 'Monday', title: 'Replaced Monday post' };

beforeEach(() => {
  writes = [];
  mockSaveWeekPlans.mockClear();
  mockSyncStage.mockClear();
  results = {
    'weekly_content_refinements:select': { data: { id: 'ref-2' }, error: null },
    'daily_content_plans:select': { data: [TUESDAY, OLD_MONDAY], error: null },
    'weekly_content_refinements:update': { data: null, error: null },
    'campaigns:update': { data: null, error: null },
  };
});

const savedRows = () => (mockSaveWeekPlans.mock.calls[0]?.[2] ?? []) as Row[];

describe('commit-daily-plan fails closed on unread errors (unread-error pkg 2)', () => {
  it('CONTROL: a healthy commit keeps the other days, replaces the day, and advances the stage', async () => {
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(mockSaveWeekPlans).toHaveBeenCalledTimes(1);
    const titles = savedRows().map((r) => r.title);
    expect(titles).toContain('Kept Tuesday post');
    expect(titles).not.toContain('Replaced Monday post');
    expect(savedRows().find((r) => r.title === 'New Monday post')).toMatchObject({ source_refinement_id: 'ref-2' });
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(['weekly_content_refinements:update', 'campaigns:update']);
    expect(mockSyncStage).toHaveBeenCalledWith('camp-1', 'daily_plan');
  });

  it('an UNREADABLE existing week is 503 and the week is NOT replaced (the other days survive)', async () => {
    results['daily_content_plans:select'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'WEEK_PLAN_READ_FAILED' });
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('an UNREADABLE weekly refinement is 503 before anything is saved (no rows without their FK link)', async () => {
    results['weekly_content_refinements:select'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'WEEK_REFINEMENT_READ_FAILED' });
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('a failed "populated" write after the save is 503 saved:true, not a 200', async () => {
    results['weekly_content_refinements:update'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'DAILY_PLAN_FOLLOWUP_FAILED', saved: true });
    expect(mockSaveWeekPlans).toHaveBeenCalledTimes(1);
    expect(writes.map((w) => `${w.table}:${w.op}`)).toEqual(['weekly_content_refinements:update']);
  });

  it('a failed stage advance after the save is 503 saved:true, and the version stage is not synced', async () => {
    results['campaigns:update'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'DAILY_PLAN_FOLLOWUP_FAILED', saved: true });
    expect(mockSaveWeekPlans).toHaveBeenCalledTimes(1);
    expect(mockSyncStage).not.toHaveBeenCalled();
  });
});
