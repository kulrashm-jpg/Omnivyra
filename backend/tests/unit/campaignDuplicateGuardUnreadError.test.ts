/**
 * unread-error pkg 2: campaignDuplicateGuardService.checkCampaignDuplicate answered { allowed: true } when
 * either of its reads failed (PostgREST returns the error, never throws), so a duplicate campaign was
 * created unchecked. It now throws DuplicateGuardReadError; POST /api/campaigns/create-from-opportunity
 * answers 503 and creates nothing.
 *
 * Hostile fakes: an unconfigured table, and ANY insert, THROW. One fault per case. The route cases run
 * the REAL generator and the REAL guard.
 */
type Result = { data: unknown; error: { message: string } | null };

let direct: Record<string, Result> = {};
const inserts: string[] = [];

function readBuilder(table: string) {
  const settle = (): Result => {
    const r = direct[table];
    if (!r) throw new Error(`hostile fake: unconfigured ${table}`);
    return r;
  };
  const b: any = {
    select: () => b, eq: () => b, gte: () => b, in: () => b,
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

const OPPORTUNITY = {
  id: 'opp-1', theme_id: 't', cluster_id: 'c', opportunity_title: 'Spring launch webinar series',
  opportunity_description: 'webinar series for the spring launch', opportunity_type: 'content_marketing', momentum_score: 1, keywords: [],
};

function ownedBuilder(table: string) {
  const b: any = {
    select: () => b, eq: () => b,
    maybeSingle: async () => {
      if (table !== 'campaign_opportunities') throw new Error(`hostile fake: unconfigured owned read ${table}`);
      return { data: OPPORTUNITY, error: null };
    },
    insert: () => { inserts.push(table); throw new Error(`hostile fake: insert into ${table} must not happen`); },
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => readBuilder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => ownedBuilder(t) }));
jest.mock('../../services/intelligenceEventService', () => ({ emitIntelligenceEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1' })) }));

import { checkCampaignDuplicate } from '../../services/campaignDuplicateGuardService';
import handler from '../../../pages/api/campaigns/create-from-opportunity';

const SIMILAR = { id: 'camp-9', name: 'Spring launch webinar', description: 'series', created_at: new Date().toISOString() };

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}
const post = () => ({
  method: 'POST', url: '/api/campaigns/create-from-opportunity', headers: {}, query: {},
  body: { opportunity_id: 'opp-1', company_id: 'co-1' },
}) as any;

beforeEach(() => {
  inserts.length = 0;
  direct = {
    campaign_versions: { data: [{ campaign_id: 'camp-9' }], error: null },
    campaigns: { data: [SIMILAR], error: null },
  };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('checkCampaignDuplicate', () => {
  it('CONTROL: a similar recent campaign is not allowed', async () => {
    await expect(checkCampaignDuplicate('co-1', 'Spring launch webinar series')).resolves.toMatchObject({ allowed: false, similar_campaign: { id: 'camp-9' } });
  });

  it('CONTROL: no recent campaigns is allowed', async () => {
    direct.campaign_versions = { data: [], error: null };
    await expect(checkCampaignDuplicate('co-1', 'Spring launch webinar series')).resolves.toEqual({ allowed: true });
  });

  it('an UNREADABLE campaign_versions throws, never { allowed: true }', async () => {
    direct.campaign_versions = { data: null, error: { message: 'boom' } };
    await expect(checkCampaignDuplicate('co-1', 'Spring launch webinar series'))
      .rejects.toMatchObject({ name: 'DuplicateGuardReadError', table: 'campaign_versions', code: 'DUPLICATE_CHECK_READ_FAILED' });
  });

  it('an UNREADABLE campaigns throws, never { allowed: true }', async () => {
    direct.campaigns = { data: null, error: { message: 'boom' } };
    await expect(checkCampaignDuplicate('co-1', 'Spring launch webinar series'))
      .rejects.toMatchObject({ name: 'DuplicateGuardReadError', table: 'campaigns' });
  });
});

describe('POST /api/campaigns/create-from-opportunity (real generator + guard)', () => {
  it('CONTROL: a similar campaign is still the 409 duplicate answer', async () => {
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ duplicate: true });
    expect(inserts).toEqual([]);
  });

  it('an unreadable duplicate check is 503 and NOTHING is created', async () => {
    direct.campaigns = { data: null, error: { message: 'boom' } };
    const res = mockRes();
    await handler(post(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 'DUPLICATE_CHECK_READ_FAILED' });
    expect(inserts).toEqual([]);
  });

});
