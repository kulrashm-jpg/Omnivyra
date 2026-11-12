/**
 * POST /api/campaigns/[id]/adjust-dates is RETIRED (e9 ruling, 2026-11-12): 410 ROUTE_RETIRED and no
 * write of any kind. The service it called (schedulingService.adjustCampaignDates) re-shifted every
 * scheduled post on every call (it never updates campaigns.start_date), non-atomically, with its
 * PostgREST results unread.
 *
 * Hostile: every database entry point and the old service THROW if touched, so a write (or a read) is
 * a failure, not a silent pass. The removal itself is asserted by absence in the route source.
 */
import fs from 'fs';
import path from 'path';

const mockAdjust = jest.fn(async () => { throw new Error('adjustCampaignDates must not be called'); });
jest.mock('../../services/schedulingService', () => ({ adjustCampaignDates: (...a: unknown[]) => (mockAdjust as any)(...a) }));
const mockDbTouched = jest.fn((t: string) => { throw new Error(`database touched: ${t}`); });
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockDbTouched(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDbTouched(t) }));
const mockLog = jest.fn(async () => undefined);
jest.mock('../../services/activityLogger', () => ({ logActivity: (...a: unknown[]) => (mockLog as any)(...a) }));

import handler from '../../../pages/api/campaigns/[id]/adjust-dates';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}

describe('adjust-dates is retired', () => {
  it.each(['POST', 'GET'])('%s answers 410 ROUTE_RETIRED and touches nothing', async (method) => {
    const res = mockRes();
    await handler({
      method,
      url: '/api/campaigns/camp-1/adjust-dates',
      headers: {},
      query: { id: 'camp-1' },
      body: { new_start_date: '2026-03-01', user_id: 'user-1' },
    } as any, res);
    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ code: 'ROUTE_RETIRED' });
    expect(mockAdjust).not.toHaveBeenCalled();
    expect(mockDbTouched).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('the route no longer imports the shifting service or the body-attributed activity log (absence)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../pages/api/campaigns/[id]/adjust-dates.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/adjustCampaignDates/);
    expect(code).not.toMatch(/schedulingService/);
    expect(code).not.toMatch(/logActivity/);
    expect(code).not.toMatch(/user_id/);
  });
});
