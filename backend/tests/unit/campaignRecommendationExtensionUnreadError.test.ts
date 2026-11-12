/**
 * unread-error pkg 2: campaignRecommendationExtensionService. Every PostgREST result in it was unread
 * (errors are returned, never thrown): a failed read became "no campaign" / "no recommendations" /
 * "nothing to merge" (merged: 0 as a success) / "no committed plan" (the fallback merged into an older
 * row); a failed write still returned the week, or reported success. Each now throws.
 *
 * Hostile fake keyed by table + operation (+ ':committed' for the plan read filtered by status); an
 * unconfigured key THROWS. One fault per case. The AI call rejects, so generation takes its
 * deterministic heuristic path.
 */
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};
let writes: string[] = [];

function makeBuilder(table: string) {
  let op = '';
  let committed = false;
  const settle = (): Result => {
    const k = `${table}:${op}${committed ? ':committed' : ''}`;
    if (op !== 'select') writes.push(k);
    const r = results[k];
    if (!r) throw new Error(`hostile fake: unconfigured ${k}`);
    return r;
  };
  const b: any = {
    select: () => { op = op || 'select'; return b; },
    insert: () => { op = 'insert'; return b; },
    update: () => { op = 'update'; return b; },
    delete: () => { op = 'delete'; return b; },
    eq: () => b, order: () => b, limit: () => b,
    in: (col: string) => { if (table === 'campaign_week_plan' && col === 'status') committed = true; return b; },
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('direct supabase not expected'); } } }));
const BLUEPRINT = { weeks: [{ week_number: 1, topics_to_cover: ['a'] }, { week_number: 2, topics_to_cover: ['b'] }] };
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn(async () => BLUEPRINT) }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn(async () => ({ category: 'x' })) }));
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: jest.fn(async () => { throw new Error('no AI in this suite'); }) }));

import {
  generateCampaignRecommendations,
  fetchRecommendationWeeks,
  markWeeksAgreed,
  mergeRecommendationsIntoPlan,
} from '../../services/campaignRecommendationExtensionService';

const ok = (data: unknown): Result => ({ data, error: null });
const boom = (): Result => ({ data: null, error: { message: 'boom' } });
const REC = { week_number: 1, status: 'agreed', topics_to_cover: ['new'] };
const merge = () => mergeRecommendationsIntoPlan({ campaignId: 'c1', sessionId: 's1', weekNumbers: [1] });

beforeEach(() => {
  writes = [];
  results = {
    'campaigns:select': ok({ id: 'c1', name: 'C1', current_stage: 'x', duration_weeks: 2 }),
    'campaign_recommendation_weeks:delete': ok(null),
    'campaign_recommendation_weeks:insert': ok(null),
    'campaign_recommendation_weeks:select': ok([REC]),
    'campaign_recommendation_weeks:update': ok(null),
    'campaign_week_plan:select:committed': ok({ id: 'plan-committed' }),
    'campaign_week_plan:update': ok(null),
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('generateCampaignRecommendations', () => {
  it('CONTROL: saves one row per week and returns them', async () => {
    const r = await generateCampaignRecommendations({ campaignId: 'c1', companyId: 'co-1' });
    expect(r.weeks).toHaveLength(2);
    expect(writes).toEqual(['campaign_recommendation_weeks:delete', 'campaign_recommendation_weeks:insert', 'campaign_recommendation_weeks:insert']);
  });
  it('an UNREADABLE campaign throws (never a plan built on "no campaign")', async () => {
    results['campaigns:select'] = boom();
    await expect(generateCampaignRecommendations({ campaignId: 'c1', companyId: 'co-1' })).rejects.toThrow(/campaign unreadable: boom/);
  });
  it('a FAILED session clear throws before any week is saved', async () => {
    results['campaign_recommendation_weeks:delete'] = boom();
    await expect(generateCampaignRecommendations({ campaignId: 'c1', companyId: 'co-1' })).rejects.toThrow(/session could not be cleared: boom/);
    expect(writes).toEqual(['campaign_recommendation_weeks:delete']);
  });
  it('a week that was NOT saved is never returned as part of the session', async () => {
    results['campaign_recommendation_weeks:insert'] = boom();
    await expect(generateCampaignRecommendations({ campaignId: 'c1', companyId: 'co-1' })).rejects.toThrow(/week 1 not saved: boom/);
  });
});

describe('fetch / agree', () => {
  it('CONTROL: fetch returns the rows', async () => {
    await expect(fetchRecommendationWeeks({ campaignId: 'c1' })).resolves.toEqual([REC]);
  });
  it('an UNREADABLE fetch throws, never [] ("no recommendations")', async () => {
    results['campaign_recommendation_weeks:select'] = boom();
    await expect(fetchRecommendationWeeks({ campaignId: 'c1' })).rejects.toThrow(/weeks unreadable: boom/);
  });
  it('a FAILED agree throws, never a silent success', async () => {
    results['campaign_recommendation_weeks:update'] = boom();
    await expect(markWeeksAgreed({ campaignId: 'c1', sessionId: 's1', weekNumbers: [1] })).rejects.toThrow(/not marked agreed: boom/);
  });
});

describe('mergeRecommendationsIntoPlan', () => {
  it('CONTROL: merges into the COMMITTED plan row and marks the weeks applied', async () => {
    await expect(merge()).resolves.toEqual({ merged: 1 });
    expect(writes).toEqual(['campaign_week_plan:update', 'campaign_recommendation_weeks:update']);
  });
  it('UNREADABLE recommendations throw, never merged: 0 as a success', async () => {
    results['campaign_recommendation_weeks:select'] = boom();
    await expect(merge()).rejects.toThrow(/weeks to merge unreadable: boom/);
    expect(writes).toEqual([]);
  });
  it('an UNREADABLE committed plan throws, never a merge into the fallback row', async () => {
    results['campaign_week_plan:select:committed'] = boom();
    results['campaign_week_plan:select'] = ok({ id: 'plan-older' });
    await expect(merge()).rejects.toThrow(/committed plan unreadable: boom/);
    expect(writes).toEqual([]);
  });
  it('an UNREADABLE fallback plan throws, never "No plan row found"', async () => {
    results['campaign_week_plan:select:committed'] = ok(null);
    results['campaign_week_plan:select'] = boom();
    await expect(merge()).rejects.toThrow(/plan unreadable: boom/);
  });
  it('a FAILED "applied" mark says the plan WAS merged and a retry is safe', async () => {
    results['campaign_recommendation_weeks:update'] = boom();
    await expect(merge()).rejects.toThrow(/merged into the plan, but could not be marked applied \(boom\)\. Applying them again is safe\./);
    expect(writes).toEqual(['campaign_week_plan:update', 'campaign_recommendation_weeks:update']);
  });
});
