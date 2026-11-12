/**
 * GET /api/campaigns/[id]/ai-history.
 *
 * Repaired (S2, 2026-11-13): this suite predated the route's access check (requireCampaignAccess) and called the
 * handler with no headers, so it failed before reaching the code it meant to test. The access check is now mocked
 * to its REAL result shape ({ userId, companyId, campaignId }), and the Supabase fake is FAITHFUL: every eq filter
 * must match a row, so the tenant seam's parent check (campaigns.id + company_id) and the scheduled_posts read
 * (campaign_id) only see what the authorized company owns.
 */
import handler from '../../../pages/api/campaigns/[id]/ai-history';
import type { NextApiRequest, NextApiResponse } from 'next';

type Row = Record<string, unknown>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const CAMPAIGN = 'campaign-123';

let access: { userId: string; companyId: string; campaignId: string } | null = null;
const TABLES: Record<string, Row[]> = {};

jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: jest.fn(async (_req: unknown, res: NextApiResponse) => {
    if (!access) { res.status(404).json({ error: 'Campaign not found' }); return null; }
    return access;
  }),
}));

function query(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const q: any = {};
  q.select = () => q;
  q.eq = (c: string, v: unknown) => { eqs.push([c, v]); return q; };
  q.order = () => q;
  q.limit = () => q;
  const rows = () => (TABLES[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
  q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok, ko);
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));

const createMockRes = () => {
  const res: Partial<NextApiResponse> & { json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return res as NextApiResponse & { json: jest.Mock; status: jest.Mock };
};
const get = async () => {
  const res = createMockRes();
  await handler({ method: 'GET', query: { id: CAMPAIGN }, headers: {} } as unknown as NextApiRequest, res);
  return res;
};

beforeEach(() => {
  TABLES.campaigns = [{ id: CAMPAIGN, company_id: CO_A }];
  TABLES.campaign_week_plan = [{
    campaign_id: CAMPAIGN, snapshot_hash: 'snap-1', omnivyre_decision: { recommendation: 'GO' },
    weeks: [{ week: 1, theme: 'Week 1', daily: [] }], created_at: '2026-01-01T00:00:00Z',
  }];
  TABLES.scheduled_posts = [{
    id: 'post-1', campaign_id: CAMPAIGN, platform: 'linkedin', content: 'Test post',
    scheduled_for: '2026-01-02T09:00:00Z', status: 'scheduled', created_at: '2026-01-01T12:00:00Z',
  }];
  access = { userId: 'u-1', companyId: CO_A, campaignId: CAMPAIGN };
});

describe('Campaign AI history API', () => {
  it('returns ai history entries for campaign', async () => {
    const res = await get();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.history).toHaveLength(1);
    expect(payload.history[0].snapshot_hash).toBe('snap-1');
    expect(payload.history[0].scheduled_posts).toHaveLength(1);
  });

  it("CRITICAL: an access result naming ANOTHER company than the campaign's is refused by the seam (404), no posts", async () => {
    access = { userId: 'u-1', companyId: CO_B, campaignId: CAMPAIGN };
    const res = await get();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('Test post');
  });

  it("a campaign the caller cannot access is the access check's 404", async () => {
    access = null;
    const res = await get();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
