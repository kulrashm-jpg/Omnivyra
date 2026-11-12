/**
 * S2 tenant seam - recommendationCampaignBuilder (e1). buildCampaignFromRecommendation takes the caller's
 * TenantContext: the recommendation is read UNDER the tenant, the campaign is stamped with the tenant's
 * company_id, and the link-back update is pinned to the tenant.
 *
 * Cross-tenant negative: company B owns a recommendation; A naming B's id gets 'Recommendation not found' and
 * creates / modifies nothing. The fake applies every filter and records every write's filters.
 */
type Row = Record<string, unknown>;
const mockWrites: Array<{ table: string; op: string; filters: Array<[string, string, unknown]> }> = [];
function mockRecordingTable(table: string) {
  const { fakeTable } = require('../helpers/fakeWhatsappDb');
  const b = fakeTable(table);
  const rec = { table, op: 'select', filters: [] as Array<[string, string, unknown]> };
  for (const op of ['insert', 'update', 'upsert']) {
    const orig = b[op];
    b[op] = (...a: unknown[]) => { rec.op = op; return orig(...a); };
  }
  for (const f of ['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte']) {
    const orig = b[f];
    b[f] = (col: string, v: unknown) => { rec.filters.push([f, col, v]); return orig(col, v); };
  }
  const then = b.then;
  b.then = (res: any, rej: any) => { if (rec.op !== 'select') mockWrites.push(rec); return then(res, rej); };
  return b;
}
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockRecordingTable(t),
  ownedDbRpc: async () => ({ data: null, error: null }),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockRecordingTable(t) } }));
const mockGetProfile = jest.fn(async (_companyId: string, _o?: unknown) => ({ name: 'Co' }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: (c: string, o: unknown) => mockGetProfile(c, o) }));
jest.mock('../../services/campaignAiOrchestrator', () => ({ runCampaignAiPlan: async () => ({ plan: { weeks: [] } }) }));
jest.mock('../../services/campaignPlanningInputsService', () => ({ getCampaignPlanningInputs: async () => null }));
jest.mock('../../../lib/content/companyStrategyPerspective', () => ({ buildStrategyInstructions: () => '', extractStrategyProfile: () => null }));

import { fakeDb, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { tenantContextFor } from '../../db/tenantTable';
import { buildCampaignFromRecommendation } from '../../services/recommendationCampaignBuilder';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REC_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const REC_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const tenantA = tenantContextFor({ userId: 'user-a' }, A);
const recB: Row = { id: REC_B, company_id: B, trend_topic: 'B topic', campaign_id: null };

beforeEach(() => {
  mockWrites.length = 0;
  mockGetProfile.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  resetFakeDb({
    recommendation_snapshots: [{ id: REC_A, company_id: A, trend_topic: 'A topic', campaign_id: null }, { ...recB }],
    campaigns: [],
  });
});

it('A building from its own recommendation creates a campaign stamped with A and links only A\'s recommendation', async () => {
  const out = await buildCampaignFromRecommendation({ tenant: tenantA, recommendationId: REC_A });
  const campaigns = fakeDb.tables.campaigns;
  expect(campaigns).toHaveLength(1);
  expect(campaigns[0].company_id).toBe(A);
  expect(out.campaign_id).toBe(campaigns[0].id);
  expect(mockGetProfile).toHaveBeenCalledWith(A, expect.anything());
  const recs = fakeDb.tables.recommendation_snapshots;
  expect(recs.find((r) => r.id === REC_A)!.campaign_id).toBe(campaigns[0].id);
  expect(recs.find((r) => r.id === REC_B)).toEqual(recB);
  const link = mockWrites.find((w) => w.table === 'recommendation_snapshots' && w.op === 'update')!;
  expect(link.filters).toEqual(expect.arrayContaining([['eq', 'company_id', A]]));
});

it('A naming B\'s recommendation id is refused as not found and writes nothing', async () => {
  await expect(buildCampaignFromRecommendation({ tenant: tenantA, recommendationId: REC_B })).rejects.toThrow('Recommendation not found');
  expect(fakeDb.tables.campaigns).toEqual([]);
  expect(fakeDb.tables.recommendation_snapshots.find((r) => r.id === REC_B)).toEqual(recB);
  expect(mockWrites).toEqual([]);
  expect(mockGetProfile).not.toHaveBeenCalled();
});
