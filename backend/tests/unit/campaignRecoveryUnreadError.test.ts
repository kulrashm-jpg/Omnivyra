/**
 * unread-error pkg 2: campaignRecoveryService.generateRecoveryCampaign (no production caller since the
 * suggest-only monitor, fbea17a88). A failed read or write is never a silent "nothing to recover":
 *   - the campaign read THROWS (it was "no campaign" -> a normal empty result);
 *   - the pending-campaign insert THROWS (its failure was swallowed by the catch, so a caller saw a
 *     normal result and counted the campaign as recovered);
 *   - the notification after the pending row exists is logged, and the stored recovery is still returned.
 *
 * Hostile fake: an unconfigured table/op THROWS.
 */
type Result = { data: unknown; error: { message: string } | null };

let results: Record<string, Result> = {};
const writes: string[] = [];

function makeBuilder(table: string) {
  let op = 'select';
  const settle = (): Result => {
    const k = `${table}:${op}`;
    if (op !== 'select') writes.push(k);
    const r = results[k];
    if (!r) throw new Error(`hostile fake: unconfigured ${k}`);
    return r;
  };
  const b: any = {
    select: () => b, eq: () => b,
    insert: () => { op = 'insert'; return b; },
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('direct supabase not expected'); } } }));
jest.mock('../../services/campaignLearningsStore', () => ({ getTopLearnings: jest.fn(async () => []) }));
jest.mock('../../services/platformPerformanceRanker', () => ({ rankPlatformsByPerformance: jest.fn(async () => []) }));
const mockLogDecision = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/autonomousDecisionLogger', () => ({ logDecision: (...a: unknown[]) => mockLogDecision(...a) }));

import { generateRecoveryCampaign } from '../../services/campaignRecoveryService';

const ok = (data: unknown): Result => ({ data, error: null });
const boom = (): Result => ({ data: null, error: { message: 'boom' } });

beforeEach(() => {
  writes.length = 0;
  mockLogDecision.mockClear();
  results = {
    'campaigns:select': ok({ company_id: 'co-1', name: 'C1' }),
    'pending_campaigns:insert': ok({ id: 'pending-1' }),
    'notifications:insert': ok(null),
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('generateRecoveryCampaign (unread-error pkg 2)', () => {
  it('CONTROL: stores the pending recovery, notifies, logs the decision, and returns its id', async () => {
    const r = await generateRecoveryCampaign('camp-1', 'low engagement');
    expect(r.recovery_pending_id).toBe('pending-1');
    expect(writes).toEqual(['pending_campaigns:insert', 'notifications:insert']);
    expect(mockLogDecision).toHaveBeenCalledTimes(1);
  });

  it('an UNREADABLE campaign throws, never a normal empty result', async () => {
    results['campaigns:select'] = boom();
    await expect(generateRecoveryCampaign('camp-1', 'r')).rejects.toThrow(/campaign unreadable: boom/);
    expect(writes).toEqual([]);
  });

  it('a FAILED pending insert throws (it was swallowed into a normal result)', async () => {
    results['pending_campaigns:insert'] = boom();
    await expect(generateRecoveryCampaign('camp-1', 'r')).rejects.toThrow(/boom/);
    expect(writes).toEqual(['pending_campaigns:insert']);
    expect(mockLogDecision).not.toHaveBeenCalled();
  });

  it('a FAILED notification is logged; the stored recovery is still returned', async () => {
    results['notifications:insert'] = boom();
    const r = await generateRecoveryCampaign('camp-1', 'r');
    expect(r.recovery_pending_id).toBe('pending-1');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('was not notified'), expect.objectContaining({ pendingId: 'pending-1' }));
  });
});
