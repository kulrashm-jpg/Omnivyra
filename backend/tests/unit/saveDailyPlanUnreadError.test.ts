/**
 * unread-error pkg 2: POST /api/campaigns/save-daily-plan. PostgREST returns an error, never throws.
 *   - the existing-slot lookup (maybeSingle): a failed read was "no existing row", so the route
 *     INSERTED a duplicate; PGRST116 (more than one row) did the same to an already-duplicated slot;
 *   - the read-back after the write (single), on the update path and on the insert path: a failure
 *     answered data:null as if that were the row.
 *
 * Hostile fake: any terminal this suite does not configure THROWS. One fault per case.
 */
type Result = { data: unknown; error: { message: string; code?: string } | null };

let lookup: Result;
let readBack: Result | undefined;

function makeBuilder(table: string) {
  const b: any = {
    select: () => b,
    eq: () => b,
    maybeSingle: async () => {
      if (table !== 'daily_content_plans') throw new Error(`hostile fake: unconfigured ${table}:maybeSingle`);
      return lookup;
    },
    single: async () => {
      if (table !== 'daily_content_plans' || !readBack) throw new Error(`hostile fake: unconfigured ${table}:single`);
      return readBack;
    },
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

const mockUpdateActivity = jest.fn(async (..._a: unknown[]) => undefined);
const mockInsertActivity = jest.fn(async (..._a: unknown[]) => ({ id: 'row-new' }));
jest.mock('../../services/executionPlannerService', () => ({
  updateActivity: (...a: unknown[]) => mockUpdateActivity(...a),
  insertActivity: (...a: unknown[]) => mockInsertActivity(...a),
}));

jest.mock('../../security/TenantGuard', () => ({
  requireCampaignTenantAccess: jest.fn(async () => ({ organizationId: 'co-1', userId: 'user-1' })),
}));

import handler from '../../../pages/api/campaigns/save-daily-plan';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}

const post = () => ({
  method: 'POST',
  url: '/api/campaigns/save-daily-plan',
  headers: {},
  query: {},
  body: {
    campaignId: 'camp-1',
    dailyPlan: { weekNumber: 1, dayOfWeek: 'Monday', date: '2026-01-05', platform: 'linkedin', contentType: 'post', title: 'T', content: 'C' },
  },
}) as any;

const ROW = { id: 'row-x', title: 'T' };

beforeEach(() => {
  mockUpdateActivity.mockClear();
  mockInsertActivity.mockClear();
  lookup = { data: null, error: null };
  readBack = { data: ROW, error: null };
});

describe('save-daily-plan fails closed on unread errors (unread-error pkg 2)', () => {
  it('CONTROL: no existing row inserts once and returns the read-back row', async () => {
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: ROW });
    expect(mockInsertActivity).toHaveBeenCalledTimes(1);
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });

  it('CONTROL: an existing row is updated, never inserted', async () => {
    lookup = { data: { id: 'row-old' }, error: null };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(mockUpdateActivity).toHaveBeenCalledWith('row-old', expect.any(Object), 'board');
    expect(mockInsertActivity).not.toHaveBeenCalled();
  });

  it('an UNREADABLE slot lookup is 503 and nothing is inserted (no duplicate)', async () => {
    lookup = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'DAILY_PLAN_SLOT_READ_FAILED' });
    expect(mockInsertActivity).not.toHaveBeenCalled();
    expect(mockUpdateActivity).not.toHaveBeenCalled();
  });

  it('an ALREADY-DUPLICATED slot (PGRST116) is 409, not a retryable 503, and no third row is inserted', async () => {
    lookup = { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'DAILY_PLAN_SLOT_AMBIGUOUS' });
    expect(mockInsertActivity).not.toHaveBeenCalled();
  });

  it('insert path: a failed read-back says saved + read_back failed, never data:null as the row', async () => {
    readBack = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ saved: true, read_back: 'failed', data: null });
    expect(mockInsertActivity).toHaveBeenCalledTimes(1);
  });

  it('update path: a failed read-back says saved + read_back failed', async () => {
    lookup = { data: { id: 'row-old' }, error: null };
    readBack = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ saved: true, read_back: 'failed', data: null });
    expect(mockUpdateActivity).toHaveBeenCalledTimes(1);
  });
});
