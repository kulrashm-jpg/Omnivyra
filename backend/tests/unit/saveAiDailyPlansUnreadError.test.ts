/**
 * unread-error pkg 2: POST /api/campaigns/save-ai-daily-plans. Without a client start date, the stored
 * campaigns.start_date dates every row. The read's error was ignored (PostgREST returns it, never
 * throws), so a failed read became "no start date" and the fallback invented one from TODAY, dating the
 * whole week wrongly. Now 503 before anything is saved, and ONLY when the stored date is needed.
 *
 * Hostile fake: any table/operation this suite does not configure THROWS.
 */
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};

function makeBuilder(table: string) {
  let op = '';
  const settle = (): Result => {
    const r = results[`${table}:${op}`];
    if (!r) throw new Error(`hostile fake: unconfigured ${table}:${op}`);
    return r;
  };
  const b: any = {
    select: () => { op = op || 'select'; return b; },
    eq: () => b,
    maybeSingle: async () => settle(),
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

const mockSaveWeekPlans = jest.fn(async (..._a: unknown[]) => ({ rowsInserted: 1 }));
jest.mock('../../services/executionPlannerService', () => ({
  saveWeekPlans: (...a: unknown[]) => mockSaveWeekPlans(...a),
}));

jest.mock('../../security/TenantGuard', () => ({
  requireCampaignTenantAccess: jest.fn(async () => ({ organizationId: 'co-1', userId: 'user-1' })),
}));

import handler from '../../../pages/api/campaigns/save-ai-daily-plans';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}

const post = (extra: Record<string, unknown> = {}) => ({
  method: 'POST',
  url: '/api/campaigns/save-ai-daily-plans',
  headers: {},
  query: {},
  body: {
    campaignId: 'camp-1',
    weekNumber: 1,
    plans: [{ dayOfWeek: 'Monday', platform: 'linkedin', contentType: 'post', title: 'Monday post', content: 'c' }],
    ...extra,
  },
}) as any;

const savedDates = () => ((mockSaveWeekPlans.mock.calls[0]?.[2] ?? []) as Array<{ date?: string }>).map((r) => r.date);

beforeEach(() => {
  mockSaveWeekPlans.mockClear();
  results = { 'campaigns:select': { data: { id: 'camp-1', start_date: '2026-01-05' }, error: null } };
});

describe('save-ai-daily-plans fails closed on an unreadable start date (unread-error pkg 2)', () => {
  it('CONTROL: the stored start date dates the rows', async () => {
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(savedDates()).toEqual(['2026-01-05']);
  });

  it('an UNREADABLE start date (no client date) is 503 and nothing is saved, never a date invented from today', async () => {
    results['campaigns:select'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'CAMPAIGN_START_DATE_READ_FAILED' });
    expect(mockSaveWeekPlans).not.toHaveBeenCalled();
  });

  it('CONTROL: with a valid client start date the stored one is not needed, so the same read fault still saves', async () => {
    results['campaigns:select'] = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post({ campaignStartDate: '2026-02-02' }), res);
    expect(res.statusCode).toBe(200);
    expect(savedDates()).toEqual(['2026-02-02']);
  });
});
