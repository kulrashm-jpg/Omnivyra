/**
 * TENANT (NULL campaigns.company_id trace, e9 2026-11-12): every live path that creates a campaign row
 * writes the AUTHORIZED company into it, and a path with no company refuses before writing. In prod,
 * 7 of 28 campaigns had company_id NULL: these paths wrote the company only into campaign_versions (or
 * nowhere), and campaigns.company_id is nullable with no trigger.
 *
 * This suite covers the four paths with no existing route harness: proposals/convert (route), BOLT's
 * runSourceRecommendation, opportunityService.promoteToCampaign, and
 * opportunityCampaignGenerator.generateCampaignFromOpportunity. The other five paths are asserted in
 * their own suites (plannerFinalizeCharacterization, campaignsClusterTenantBinding,
 * wsfOrd007CampaignSaveRace / routeAuth001CampaignBinding2, recommendation_create_campaign,
 * recommendationsSec001TenantBinding).
 *
 * The fake records EVERY write; a read of a table this suite does not configure THROWS.
 */
type Result = { data: unknown; error: { message: string } | null };

let reads: Record<string, unknown> = {};
let writes: Array<{ table: string; op: string; payload: unknown }> = [];

function makeBuilder(table: string) {
  let op = 'select';
  const settle = (): Result => {
    if (op === 'select') {
      if (!(table in reads)) throw new Error(`hostile fake: unconfigured read ${table}`);
      return { data: reads[table], error: null };
    }
    return { data: { id: `new-${table}-id` }, error: null };
  };
  const b: any = {};
  for (const m of ['eq', 'neq', 'in', 'order', 'limit', 'gte', 'is', 'not']) b[m] = () => b;
  b.select = () => b;
  for (const w of ['insert', 'update', 'upsert', 'delete']) {
    b[w] = (payload: unknown) => { op = w; writes.push({ table, op: w, payload }); return b; };
  }
  b.maybeSingle = async () => settle();
  b.single = async () => settle();
  b.then = (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
    try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1' })) }));
jest.mock('../../db/campaignPlanStore', () => ({ saveCampaignBlueprintFromLegacy: jest.fn(async () => undefined) }));
jest.mock('../../db/campaignVersionStore', () => ({ syncCampaignVersionStage: jest.fn(async () => undefined) }));
jest.mock('../../services/campaignDuplicateGuardService', () => ({ checkCampaignDuplicate: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/intelligenceEventService', () => ({ emitIntelligenceEvent: jest.fn(async () => undefined) }));

import convertHandler from '../../../pages/api/campaigns/proposals/convert';
import { runSourceRecommendation } from '../../services/boltPipelineServiceModel';
import { promoteToCampaign } from '../../services/opportunityService';
import { generateCampaignFromOpportunity } from '../../services/opportunityCampaignGenerator';

const USER = '11111111-2222-4333-8444-555555555555';
const campaignInserts = () => writes.filter((w) => w.table === 'campaigns' && w.op === 'insert');
const insertedCompany = () => (campaignInserts()[0]?.payload as { company_id?: unknown } | undefined)?.company_id;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, unknown> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  res.getHeader = (k: string) => res.headers[k];
  return res;
}

beforeEach(() => {
  reads = {};
  writes = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('proposals/convert', () => {
  it('the new campaign row is owned by the proposal company (the one enforceCompanyAccess authorized)', async () => {
    reads.campaign_proposals = {
      id: 'prop-1', status: 'pending', organization_id: 'c0a00000-0000-4000-8000-00000000c0f0', opportunity_id: 'opp-1',
      proposal_title: 'P', proposal_data: { weekly_structure: [{ phase: 'A' }], recommended_platforms: ['linkedin'] },
    };
    const res = mockRes();
    await convertHandler({ method: 'POST', url: '/api/campaigns/proposals/convert', headers: {}, query: {}, body: { proposalId: 'prop-1' } } as any, res);
    expect(campaignInserts()).toHaveLength(1);
    expect(insertedCompany()).toBe('c0a00000-0000-4000-8000-00000000c0f0');
  });
});

describe('BOLT runSourceRecommendation (new campaign branch)', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    companyId: 'co-bolt', userId: USER, executionConfig: {}, title: 'From themes', ...over,
  }) as any;

  it('CONTROL: the new campaign row carries the payload company', async () => {
    await runSourceRecommendation('run-1', payload()).catch(() => undefined);
    expect(campaignInserts()).toHaveLength(1);
    expect(insertedCompany()).toBe('co-bolt');
  });

  it('no company is REFUSED (STRATEGY_MISSING_COMPANY_ID) and no campaign is written (was `companyId ?? null`)', async () => {
    const err = await runSourceRecommendation('run-1', payload({ companyId: undefined })).catch((e) => e);
    expect(err).toMatchObject({ name: 'BoltError', code: 'STRATEGY_MISSING_COMPANY_ID' });
    expect(campaignInserts()).toEqual([]);
  });

  it('a blank company is refused the same way', async () => {
    const err = await runSourceRecommendation('run-1', payload({ companyId: '   ' })).catch((e) => e);
    expect(err).toMatchObject({ code: 'STRATEGY_MISSING_COMPANY_ID' });
    expect(campaignInserts()).toEqual([]);
  });
});

describe('opportunityService.promoteToCampaign', () => {
  it('the new campaign row is owned by the company the opportunity was read under', async () => {
    reads.opportunity_items = { id: 'opp-1', title: 'T', summary: 'S', region_tags: [], payload: {} };
    await promoteToCampaign('opp-1', 'co-opp', USER).catch(() => undefined);
    expect(campaignInserts()).toHaveLength(1);
    expect(insertedCompany()).toBe('co-opp');
  });
});

describe('opportunityCampaignGenerator.generateCampaignFromOpportunity', () => {
  it('the new campaign row is owned by the company the route authorized', async () => {
    reads.campaign_opportunities = {
      id: 'opp-2', theme_id: 't', cluster_id: 'c', opportunity_title: 'Title', opportunity_description: 'D',
      opportunity_type: 'content_marketing', momentum_score: 1, keywords: [],
    };
    await generateCampaignFromOpportunity('opp-2', 'co-gen', USER).catch(() => undefined);
    expect(campaignInserts()).toHaveLength(1);
    expect(insertedCompany()).toBe('co-gen');
  });
});
