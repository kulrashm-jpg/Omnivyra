/**
 * unread-error pkg 2: campaignReadinessService.evaluateCampaignReadiness. PostgREST returns an error,
 * never throws.
 *   - the weekly fallback read (weekly_content_refinements): a failure was "no weeks", so a
 *     MISSING_WEEKLY_PLANS readiness was computed AND PERSISTED;
 *   - the campaign read: any error was reported as CAMPAIGN_NOT_FOUND ("does not exist").
 * Both now return a named *_UNAVAILABLE issue and persist nothing (the DAILY_PLANS_UNAVAILABLE precedent).
 *
 * Hostile fake: an unconfigured table/op THROWS. One fault per case.
 */
type Result = { data: unknown; error: { message: string; code?: string } | null };

let results: Record<string, Result> = {};
const writes: string[] = [];

function makeBuilder(table: string) {
  let op = '';
  const settle = (): Result => {
    const k = `${table}:${op}`;
    const r = results[k];
    if (!r) throw new Error(`hostile fake: unconfigured ${k}`);
    if (op !== 'select') writes.push(k);
    return r;
  };
  const b: any = {
    select: () => { op = op || 'select'; return b; },
    upsert: () => { op = 'upsert'; return b; },
    eq: () => b,
    single: async () => settle(),
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('direct supabase not expected'); } } }));
jest.mock('../../services/campaignBlueprintService', () => ({ getUnifiedCampaignBlueprint: jest.fn(async () => null) }));

import { evaluateCampaignReadiness } from '../../services/campaignReadinessService';

const ok = (data: unknown): Result => ({ data, error: null });
const boom = (code?: string): Result => ({ data: null, error: { message: 'boom', ...(code ? { code } : {}) } });

beforeEach(() => {
  writes.length = 0;
  results = {
    'campaigns:select': ok({ id: 'c1' }),
    // The weekly_content_plans read fails in this shape of the schema, so the fallback runs.
    'weekly_content_plans:select': boom('42P01'),
    'weekly_content_refinements:select': ok([{ week_number: 1 }]),
    'daily_content_plans:select': ok([]),
    'campaign_readiness:upsert': ok(null),
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const codes = (r: { blocking_issues: Array<{ code: string }> }) => r.blocking_issues.map((i) => i.code);

describe('evaluateCampaignReadiness (unread-error pkg 2)', () => {
  it('CONTROL: the weekly fallback read succeeds -> readiness is computed AND persisted', async () => {
    const r = await evaluateCampaignReadiness('c1');
    expect(codes(r)).not.toContain('WEEKLY_PLANS_UNAVAILABLE');
    expect(codes(r)).not.toContain('MISSING_WEEKLY_PLANS');
    expect(writes).toEqual(['campaign_readiness:upsert']);
  });

  it('an UNREADABLE weekly fallback is WEEKLY_PLANS_UNAVAILABLE and persists nothing (never MISSING_WEEKLY_PLANS)', async () => {
    results['weekly_content_refinements:select'] = boom();
    const r = await evaluateCampaignReadiness('c1');
    expect(codes(r)).toEqual(['WEEKLY_PLANS_UNAVAILABLE']);
    expect(writes).toEqual([]);
  });

  it('an UNREADABLE campaign is CAMPAIGN_UNAVAILABLE, never "does not exist", and nothing else is read', async () => {
    results['campaigns:select'] = boom();
    delete results['weekly_content_plans:select'];
    const r = await evaluateCampaignReadiness('c1');
    expect(codes(r)).toEqual(['CAMPAIGN_UNAVAILABLE']);
    expect(writes).toEqual([]);
  });

  it('CONTROL: a genuinely missing campaign (PGRST116) is still CAMPAIGN_NOT_FOUND', async () => {
    results['campaigns:select'] = boom('PGRST116');
    const r = await evaluateCampaignReadiness('c1');
    expect(codes(r)).toEqual(['CAMPAIGN_NOT_FOUND']);
  });
});
