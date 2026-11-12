/**
 * unread-error pkg 2: the start-date conflict check.
 *   - schedulingService.detectCampaignConflicts answered [] ("no conflicts") on a failed campaigns read;
 *     suggestAvailableDateRange answered "start now" over real campaigns. Both now throw
 *     ConflictCheckReadError (PostgREST returns the error, never throws).
 *   - buildStartDateConflictWarning (ai/plan's advisory warning) stays non-blocking, but a check that
 *     could not run now SAYS so instead of looking like "no conflicts".
 *
 * Hostile fakes: an unconfigured table throws. One fault per case.
 */
type Result = { data: unknown; error: { message: string } | null };

let owned: Record<string, Result> = {};
let direct: Record<string, Result> = {};

function builder(store: () => Record<string, Result>, table: string) {
  const settle = (): Result => {
    const r = store()[table];
    if (!r) throw new Error(`hostile fake: unconfigured ${table}`);
    return r;
  };
  const b: any = {
    select: () => b, eq: () => b, not: () => b, neq: () => b, order: () => b,
    maybeSingle: async () => settle(),
    then: (ok: (v: Result) => unknown, ko?: (e: unknown) => unknown) => {
      try { return Promise.resolve(settle()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(() => owned, t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(() => direct, t) } }));
jest.mock('../../services/activityLogger', () => ({ logActivity: jest.fn() }));

import { ConflictCheckReadError, detectCampaignConflicts, suggestAvailableDateRange } from '../../services/schedulingService';
import { buildStartDateConflictWarning, CONFLICT_UNCHECKED_NOTE } from '../../services/startDateConflictWarning';

const OTHER = { id: 'camp-2', name: 'Spring push', start_date: '2026-03-01', end_date: '2026-04-30' };

beforeEach(() => {
  owned = { campaigns: { data: [OTHER], error: null } };
  direct = { campaigns: { data: { user_id: 'user-1' }, error: null } };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('schedulingService conflict reads', () => {
  it('CONTROL: detect finds the overlapping campaign', async () => {
    const c = await detectCampaignConflicts('user-1', new Date('2026-03-10'), new Date('2026-03-20'));
    expect(c.map((x) => x.campaign_id)).toEqual(['camp-2']);
  });

  it('detect: an UNREADABLE campaigns list throws ConflictCheckReadError, never [] ("no conflicts")', async () => {
    owned.campaigns = { data: null, error: { message: 'boom' } };
    await expect(detectCampaignConflicts('user-1', new Date('2026-03-10'), new Date('2026-03-20')))
      .rejects.toMatchObject({ name: 'ConflictCheckReadError', code: 'CONFLICT_CHECK_READ_FAILED', operation: 'detect' });
  });

  it('CONTROL: suggest places the range after the existing campaign', async () => {
    const s = await suggestAvailableDateRange('user-1', 7, new Date('2026-03-10'));
    expect(s).not.toBeNull();
    expect(s!.start_date.getTime()).toBeGreaterThanOrEqual(new Date('2026-04-30').getTime());
  });

  it('suggest: an UNREADABLE campaigns list throws, never "start now" over real campaigns', async () => {
    owned.campaigns = { data: null, error: { message: 'boom' } };
    await expect(suggestAvailableDateRange('user-1', 7, new Date('2026-03-10')))
      .rejects.toBeInstanceOf(ConflictCheckReadError);
  });
});

describe('buildStartDateConflictWarning (ai/plan, advisory)', () => {
  it('no valid tentative start: nothing to check, nothing read', async () => {
    direct = {};
    owned = {};
    await expect(buildStartDateConflictWarning('camp-1', null)).resolves.toBeNull();
    await expect(buildStartDateConflictWarning('camp-1', 'soon')).resolves.toBeNull();
  });

  it('CONTROL: no overlap is null (checked, clear)', async () => {
    await expect(buildStartDateConflictWarning('camp-1', '2026-06-01')).resolves.toBeNull();
  });

  it('CONTROL: an overlap is a conflict warning with a suggestion, and no "unavailable" note', async () => {
    const w = await buildStartDateConflictWarning('camp-1', '2026-02-15');
    expect(w).toContain('Date conflict');
    expect(w).toContain('Spring push');
    expect(w).toContain('Suggested alternative');
    expect(w).not.toContain('Date check unavailable');
  });

  it('an UNREADABLE campaign owner (the route\'s own read) says the check did not run', async () => {
    direct.campaigns = { data: null, error: { message: 'boom' } };
    await expect(buildStartDateConflictWarning('camp-1', '2026-02-15')).resolves.toBe(CONFLICT_UNCHECKED_NOTE);
  });

  it('an UNREADABLE conflicts read (detect throws) says the check did not run', async () => {
    owned.campaigns = { data: null, error: { message: 'boom' } };
    await expect(buildStartDateConflictWarning('camp-1', '2026-02-15')).resolves.toBe(CONFLICT_UNCHECKED_NOTE);
  });

  it('a failed suggestion KEEPS the conflict already found and adds the note', async () => {
    const w = await buildStartDateConflictWarning('camp-1', '2026-02-15', {
      suggest: async () => { throw new ConflictCheckReadError('suggest', { message: 'boom' }); },
    });
    expect(w).toContain('Spring push');
    expect(w).toContain(CONFLICT_UNCHECKED_NOTE);
    expect(w).not.toContain('Suggested alternative');
  });
});
