/**
 * unread-error pkg 2: campaignBlueprintService.getResolvedCampaignPlanContext. PostgREST returns an
 * error, never throws.
 *   - :620 the duration read: a failure was "duration not initialized" -> PrePlanningRequiredError, which
 *     told the user to run pre-planning;
 *   - :645 the campaigns fallback read (no campaign version): a failure resolved the context with an
 *     EMPTY campaign ({}).
 * Both now throw BlueprintMutabilityReadError, which the routes map to 503 BLUEPRINT_STATE_READ_FAILED.
 *
 * Hostile fake: a campaigns read whose columns this suite does not configure THROWS, and so does any
 * other table (recorded first, so a control can prove the code went PAST the fallback read).
 */
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};
const reached: string[] = [];

function makeBuilder(table: string) {
  let cols = '';
  const settle = (): Result => {
    const k = `${table}:${cols}`;
    reached.push(k);
    const r = results[k];
    if (!r) throw new Error(`hostile fake: unconfigured ${k}`);
    return r;
  };
  const b: any = {
    select: (c: string) => { cols = c; return b; },
    eq: () => b, in: () => b, order: () => b, limit: () => b,
    maybeSingle: async () => settle(),
    single: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/campaignApprovedVersionStore', () => ({ getLatestApprovedCampaignVersion: jest.fn(async () => null) }));
jest.mock('../../db/campaignVersionStore', () => ({ getLatestCampaignVersion: jest.fn(async () => null) }));

import {
  getResolvedCampaignPlanContext,
  BlueprintMutabilityReadError,
  PrePlanningRequiredError,
} from '../../services/campaignBlueprintService';

const ok = (data: unknown): Result => ({ data, error: null });
const boom = (): Result => ({ data: null, error: { message: 'boom' } });

beforeEach(() => {
  reached.length = 0;
  results = {
    'campaigns:duration_weeks': ok({ duration_weeks: 6 }),
    'campaigns:*': ok({ id: 'camp-1', name: 'C1' }),
  };
});

describe('getResolvedCampaignPlanContext (unread-error pkg 2)', () => {
  it('CONTROL: a genuinely missing duration is still PrePlanningRequiredError', async () => {
    results['campaigns:duration_weeks'] = ok({ duration_weeks: null });
    await expect(getResolvedCampaignPlanContext('co-1', 'camp-1')).rejects.toBeInstanceOf(PrePlanningRequiredError);
  });

  it('an UNREADABLE duration is BlueprintMutabilityReadError (503), never "run pre-planning"', async () => {
    results['campaigns:duration_weeks'] = boom();
    const err = await getResolvedCampaignPlanContext('co-1', 'camp-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintMutabilityReadError);
    expect(err).not.toBeInstanceOf(PrePlanningRequiredError);
    expect((err as BlueprintMutabilityReadError).source).toBe('campaigns.duration_weeks');
  });

  it('CONTROL: a readable fallback campaign row lets resolution continue PAST the fallback read', async () => {
    const err = await getResolvedCampaignPlanContext('co-1', 'camp-1').catch((e) => e);
    // It went on to the blueprint reads (unconfigured here, so they throw): the fallback did not stop it.
    expect(reached.slice(0, 2)).toEqual(['campaigns:duration_weeks', 'campaigns:*']);
    expect(reached.length).toBeGreaterThan(2);
    expect((err as { source?: string } | undefined)?.source).not.toBe('campaigns');
  });

  it('an UNREADABLE fallback campaign row is BlueprintMutabilityReadError, never an empty campaign', async () => {
    results['campaigns:*'] = boom();
    const err = await getResolvedCampaignPlanContext('co-1', 'camp-1').catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintMutabilityReadError);
    expect((err as BlueprintMutabilityReadError).source).toBe('campaigns');
    expect(reached).toEqual(['campaigns:duration_weeks', 'campaigns:*']);
  });
});
